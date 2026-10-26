// Offline verification for the PostHog product-analytics integration.
//
// These tests drive the real handlers in src/lib/analytics.ts — the same
// functions the instrumented screens call — through an in-memory client and an
// in-memory consent store. No network, no posthog-js runtime, no real token:
// the synthetic configuration is injected by posthog-analytics.verify.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANALYTICS_CONSENT_KEY,
  ANALYTICS_EVENTS,
  analyticsConfigured,
  captureEvent,
  identifySession,
  initAnalytics,
  installAnalyticsClient,
  readConsentDecision,
  resetAnalyticsIdentity,
  sanitizeProperties,
  scrubEvent,
  setConsentDecision,
  trackGoLiveApproved,
  trackKnowledgeIngested,
  trackSandboxMessageSent,
  trackSetupGuideOpened,
} from "./src/lib/analytics.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ?? "";
const SYNTHETIC_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "";

// ---- in-memory consent storage (stands in for window.localStorage) --------
const consentStore = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (consentStore.has(key) ? consentStore.get(key) : null),
    setItem: (key, value) => consentStore.set(key, String(value)),
    removeItem: (key) => consentStore.delete(key),
  },
};

// ---- in-memory analytics client (stands in for the posthog-js transport) --
function makeClient({ failCapture = false, failInit = false } = {}) {
  const calls = { init: [], capture: [], identify: [], reset: 0, optIn: 0, optOut: 0 };
  return {
    calls,
    init(token, config) {
      if (failInit) throw new Error("init failed");
      calls.init.push({ token, config });
    },
    capture(event, properties) {
      if (failCapture) throw new Error("transport unavailable");
      calls.capture.push({ event, properties });
      return {};
    },
    identify(id) {
      calls.identify.push(id);
    },
    reset() {
      calls.reset += 1;
    },
    opt_in_capturing() {
      calls.optIn += 1;
    },
    opt_out_capturing() {
      calls.optOut += 1;
    },
  };
}

function freshClient(options) {
  resetAnalyticsIdentity();
  consentStore.clear();
  const client = makeClient(options);
  installAnalyticsClient(client);
  return client;
}

function grantConsent() {
  consentStore.set(ANALYTICS_CONSENT_KEY, "granted");
}

const ENV_KEYS = ["NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "NEXT_PUBLIC_POSTHOG_HOST"];

function withEnv(overrides, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ---- 1. manifest + lock evidence (read-only) ------------------------------
test("manifest and lock resolve posthog-js 1.438.13 with npm only", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));

  assert.equal(pkg.dependencies["posthog-js"], "1.438.13");
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages["node_modules/posthog-js"].version, "1.438.13");
  assert.equal(lock.packages[""].dependencies["posthog-js"], "1.438.13");

  for (const vetoed of ["yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock"]) {
    assert.equal(existsSync(join(ROOT, vetoed)), false, `${vetoed} must not exist`);
  }
  assert.equal(existsSync(join(ROOT, "src/instrumentation-client.ts")), true);
});

// ---- 2. consent gate ------------------------------------------------------
test("no consent decision: nothing is initialized or captured", () => {
  const client = freshClient();
  assert.equal(readConsentDecision(), null);
  assert.equal(trackSetupGuideOpened({ hasProfile: true, knowledgeDocCount: 2 }), false);
  assert.equal(client.calls.init.length, 0);
  assert.equal(client.calls.capture.length, 0);
});

test("denied consent: nothing is initialized or captured", () => {
  const client = freshClient();
  setConsentDecision("denied");
  assert.equal(readConsentDecision(), "denied");
  assert.equal(trackGoLiveApproved({ hasProfile: true, knowledgeDocCount: 1, sandboxMessages: 1 }), false);
  assert.equal(client.calls.init.length, 0);
  assert.equal(client.calls.capture.length, 0);
});

// ---- 3. configuration gate ------------------------------------------------
test("missing project token or host is a no-op even with consent", () => {
  assert.equal(analyticsConfigured(), true, "runner must inject synthetic configuration");
  assert.match(SYNTHETIC_TOKEN, /^(?!ph[cx]_)[\w-]+$/, "runner must inject a synthetic, non-PostHog token");

  const client = freshClient();
  grantConsent();

  withEnv({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: undefined }, () => {
    assert.equal(analyticsConfigured(), false);
    assert.equal(trackSetupGuideOpened({ hasProfile: false, knowledgeDocCount: 0 }), false);
  });

  withEnv({ NEXT_PUBLIC_POSTHOG_HOST: undefined }, () => {
    assert.equal(analyticsConfigured(), false);
    assert.equal(trackKnowledgeIngested({ sourceKind: "pdf", topicCount: 1, docCount: 1 }), false);
  });

  assert.equal(client.calls.init.length, 0);
  assert.equal(client.calls.capture.length, 0);
});

// ---- 4. privacy defaults at the init boundary ----------------------------
test("consent grant initializes one client with privacy defaults", () => {
  const client = freshClient();
  setConsentDecision("granted");

  assert.equal(readConsentDecision(), "granted");
  assert.equal(client.calls.init.length, 1);
  const { token, config } = client.calls.init[0];
  assert.equal(token, SYNTHETIC_TOKEN);
  assert.equal(config.api_host, SYNTHETIC_HOST);
  assert.equal(config.autocapture, false);
  assert.equal(config.capture_pageview, false);
  assert.equal(config.capture_pageleave, false);
  assert.equal(config.capture_dead_clicks, false);
  assert.equal(config.disable_session_recording, true);
  assert.equal(config.opt_out_capturing_by_default, true);
  assert.equal(config.person_profiles, "identified_only");
  assert.equal(config.respect_dnt, true);
  assert.equal(typeof config.before_send, "function");
  assert.equal(client.calls.optIn, 1);
});

// ---- 5. the instrumented actions ----------------------------------------
test("each instrumented action emits exactly once with allowlisted properties", () => {
  const client = freshClient();
  grantConsent();

  assert.equal(trackSetupGuideOpened({ hasProfile: true, knowledgeDocCount: 3 }), true);
  assert.equal(trackKnowledgeIngested({ sourceKind: "pdf", topicCount: 2, docCount: 4 }), true);
  assert.equal(trackSandboxMessageSent({ isFirstMessage: true, answerGrounded: true, handoff: false }), true);
  assert.equal(trackGoLiveApproved({ hasProfile: true, knowledgeDocCount: 3, sandboxMessages: 1 }), true);

  assert.equal(client.calls.init.length, 1, "the client is initialized once");
  assert.equal(client.calls.capture.length, 4);
  assert.deepEqual(
    client.calls.capture.map((call) => call.event),
    [
      ANALYTICS_EVENTS.setupGuideOpened,
      ANALYTICS_EVENTS.knowledgeIngested,
      ANALYTICS_EVENTS.sandboxMessageSent,
      ANALYTICS_EVENTS.goLiveApproved,
    ],
  );
  assert.deepEqual(client.calls.capture[0].properties, { has_profile: true, knowledge_doc_count: 3 });
  assert.deepEqual(client.calls.capture[1].properties, {
    source_kind: "pdf",
    topic_count: 2,
    doc_count: 4,
  });
  assert.deepEqual(client.calls.capture[2].properties, {
    is_first_message: true,
    answer_grounded: true,
    handoff: false,
  });
  assert.deepEqual(client.calls.capture[3].properties, {
    has_profile: true,
    knowledge_doc_count: 3,
    sandbox_messages: 1,
  });

  // One call per action, not one per render.
  trackSetupGuideOpened({ hasProfile: false, knowledgeDocCount: 0 });
  assert.equal(client.calls.capture.length, 5);
});

// ---- 6. sensitive data ---------------------------------------------------
test("email, password, token, card and URL sentinels never reach the client", () => {
  const client = freshClient();
  grantConsent();

  const accepted = captureEvent(ANALYTICS_EVENTS.setupGuideOpened, {
    has_profile: true,
    knowledge_doc_count: 2,
    email: "parent.leak@example.com",
    password: "S3ntinelPass!",
    api_key: "tok_sentinel_123",
    card: "4111111111111111",
    $current_url: "https://app.admitflow.test/console?email=parent.leak%40example.com",
    $referrer: "https://mail.example.com/inbox",
  });

  assert.equal(accepted, true);
  assert.equal(client.calls.capture.length, 1);
  assert.deepEqual(client.calls.capture[0].properties, { has_profile: true, knowledge_doc_count: 2 });

  const wire = JSON.stringify(client.calls.capture);
  for (const sentinel of [
    "parent.leak@example.com",
    "S3ntinelPass!",
    "tok_sentinel_123",
    "4111111111111111",
    "mail.example.com",
    "app.admitflow.test",
  ]) {
    assert.equal(wire.includes(sentinel), false, `leaked ${sentinel}`);
  }

  // Events outside the contract are refused outright.
  assert.equal(captureEvent("$pageview", { $current_url: "https://app.admitflow.test/" }), false);
  assert.equal(client.calls.capture.length, 1);
  assert.deepEqual(sanitizeProperties("setup_guide_opened", { has_profile: true, email: "a@b.c" }), {
    has_profile: true,
  });
});

test("before_send scrubs URLs, referrers and person metadata", () => {
  const client = freshClient();
  setConsentDecision("granted");

  assert.equal(client.calls.init.length, 1);
  const config = client.calls.init[0].config;
  const cleaned = config.before_send({
    uuid: "test-uuid",
    event: ANALYTICS_EVENTS.goLiveApproved,
    properties: {
      has_profile: true,
      knowledge_doc_count: 1,
      sandbox_messages: 2,
      $current_url: "https://app.admitflow.test/console?email=parent.leak%40example.com",
      $pathname: "/console",
      $referrer: "https://mail.example.com/inbox",
      $browser: "Chrome",
      token: "tok_sentinel_123",
    },
    $set: { email: "parent.leak@example.com" },
    $set_once: { initial_referrer: "https://mail.example.com/inbox" },
  });

  assert.ok(cleaned, "contract events survive before_send");
  assert.equal(cleaned.event, ANALYTICS_EVENTS.goLiveApproved);
  assert.deepEqual(cleaned.properties, {
    has_profile: true,
    knowledge_doc_count: 1,
    sandbox_messages: 2,
  });
  assert.equal(cleaned.$set, undefined);
  assert.equal(cleaned.$set_once, undefined);
  const wire = JSON.stringify(cleaned);
  for (const sentinel of ["parent.leak@example.com", "mail.example.com", "app.admitflow.test", "tok_sentinel_123", "Chrome"]) {
    assert.equal(wire.includes(sentinel), false, `before_send leaked ${sentinel}`);
  }

  // Automatic SDK events are dropped entirely.
  assert.equal(scrubEvent({ uuid: "x", event: "$autocapture", properties: { $event_type: "click" } }), null);
  assert.equal(config.before_send({ uuid: "y", event: "$pageview", properties: {} }), null);
});

// ---- 7. harmless failures ----------------------------------------------
test("transport and init failures never break the calling screen", () => {
  const broken = freshClient({ failCapture: true });
  grantConsent();
  assert.equal(initAnalytics(), true);
  assert.equal(trackGoLiveApproved({ hasProfile: true, knowledgeDocCount: 0, sandboxMessages: 0 }), false);
  assert.equal(broken.calls.capture.length, 0);

  const unstartable = freshClient({ failInit: true });
  grantConsent();
  assert.equal(initAnalytics(), false);
  assert.equal(trackSetupGuideOpened({ hasProfile: false, knowledgeDocCount: 0 }), false);
  assert.equal(unstartable.calls.capture.length, 0);
});

// ---- 8. identity + reset ------------------------------------------------
test("identity uses the opaque auth id only, and reset detaches it", () => {
  const client = freshClient();
  grantConsent();

  assert.equal(identifySession("user_2c9fa1"), true);
  assert.deepEqual(client.calls.identify, ["user_2c9fa1"]);

  assert.equal(identifySession("parent.leak@example.com"), false);
  assert.equal(identifySession(""), false);
  assert.equal(identifySession("ab"), false);
  assert.deepEqual(client.calls.identify, ["user_2c9fa1"]);

  resetAnalyticsIdentity();
  assert.equal(client.calls.reset, 1);
  resetAnalyticsIdentity();
  assert.equal(client.calls.reset, 2);
});

test("identity waits for consent and then stays anonymous without it", () => {
  const client = freshClient();

  assert.equal(identifySession("user_demo_owner"), false);
  assert.deepEqual(client.calls.identify, []);

  setConsentDecision("granted");
  assert.deepEqual(client.calls.identify, ["user_demo_owner"], "pending id applies once consent lands");
  assert.equal(client.calls.init.length, 1);
});

// ---- 9. no network in the offline run ----------------------------------
test("the capture path performs no network requests", () => {
  const client = freshClient();
  grantConsent();

  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("network denied in offline verification");
  };
  try {
    trackSetupGuideOpened({ hasProfile: true, knowledgeDocCount: 1 });
    trackKnowledgeIngested({ sourceKind: "url", topicCount: 1, docCount: 2 });
    trackSandboxMessageSent({ isFirstMessage: false, answerGrounded: false, handoff: true });
    trackGoLiveApproved({ hasProfile: true, knowledgeDocCount: 1, sandboxMessages: 2 });
    identifySession("user_demo_owner");
    resetAnalyticsIdentity();
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(fetchCalls, 0);
  assert.equal(client.calls.capture.length, 4);
});

// ---- 10. wiring + no real token literals in the repo files we changed ---
test("instrumented source, example env and note carry no real token", () => {
  const files = [
    "src/lib/analytics.ts",
    "src/instrumentation-client.ts",
    "src/components/onboarding-wizard.tsx",
    "src/components/knowledge-client.tsx",
    "src/components/analytics-consent.tsx",
    "src/components/analytics-identity.tsx",
    "src/app/layout.tsx",
    ".env.example",
    "posthog-analytics.md",
  ];

  for (const file of files) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.equal(/ph[cx]_[A-Za-z0-9]{8,}/.test(source), false, `${file} contains a PostHog token literal`);
  }

  const bootstrap = readFileSync(join(ROOT, "src/instrumentation-client.ts"), "utf8");
  assert.match(bootstrap, /installAnalyticsClient\(posthog\)/, "bootstrap must install the singleton");
  assert.match(bootstrap, /initAnalytics\(\)/, "bootstrap must initialize at the Next.js boundary");

  const env = readFileSync(join(ROOT, ".env.example"), "utf8");
  assert.match(env, /^NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=$/m, "example env declares an empty project token");
  assert.match(env, /^NEXT_PUBLIC_POSTHOG_HOST=$/m, "example env declares an empty ingestion host");
  assert.match(env, /us\.i\.posthog\.com/, "example env names the regional hosts");

  const analyticsSource = readFileSync(join(ROOT, "src/lib/analytics.ts"), "utf8");
  assert.match(analyticsSource, /opt_out_capturing_by_default: true/);
  assert.match(analyticsSource, /before_send: scrubEvent/);
  assert.match(analyticsSource, /NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN/);
  assert.match(analyticsSource, /NEXT_PUBLIC_POSTHOG_HOST/);
});
