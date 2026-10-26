// Product analytics (PostHog) for AdmitFlow.
//
// Privacy posture:
// - Nothing is initialized until the visitor grants analytics consent; a
//   missing decision means analytics stays off (no cookieless fallback).
// - Missing NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN or NEXT_PUBLIC_POSTHOG_HOST is a
//   no-op, so demo mode never phones home.
// - The browser client runs with autocapture, pageviews, pageleave, dead
//   clicks, session recording, surveys and feature flags off. Only the
//   contract events below leave the page, and only with allowlisted
//   properties; before_send scrubs everything else (URLs, referrers, person
//   metadata).
// - Analytics failures are swallowed: capture returns false, never throws.

import type { CaptureResult } from "posthog-js";
import type posthog from "posthog-js";

export type AnalyticsClient = Pick<
  typeof posthog,
  "init" | "capture" | "identify" | "reset" | "opt_in_capturing" | "opt_out_capturing"
>;

export const ANALYTICS_CONSENT_KEY = "admitflow.analytics-consent";

export type ConsentDecision = "granted" | "denied";

/** The activation funnel: setup guide → first knowledge doc → tested agent → go live. */
export const ANALYTICS_EVENTS = {
  setupGuideOpened: "setup_guide_opened",
  knowledgeIngested: "knowledge_document_ingested",
  sandboxMessageSent: "agent_sandbox_message_sent",
  goLiveApproved: "setup_go_live_approved",
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export type KnowledgeSourceKind = "pdf" | "docx" | "xlsx" | "url" | "template";

type SafeValue = boolean | number | string;

// The only properties any event may carry. Everything else is dropped before
// it reaches the SDK, and again in before_send.
const ALLOWED_PROPERTIES: Record<AnalyticsEvent, readonly string[]> = {
  setup_guide_opened: ["has_profile", "knowledge_doc_count"],
  knowledge_document_ingested: ["source_kind", "topic_count", "doc_count"],
  agent_sandbox_message_sent: ["is_first_message", "answer_grounded", "handoff"],
  setup_go_live_approved: ["has_profile", "knowledge_doc_count", "sandbox_messages"],
};

const SOURCE_KINDS: readonly KnowledgeSourceKind[] = ["pdf", "docx", "xlsx", "url", "template"];

function isAllowedEvent(event: string): event is AnalyticsEvent {
  return Object.prototype.hasOwnProperty.call(ALLOWED_PROPERTIES, event);
}

function isSourceKind(value: unknown): value is KnowledgeSourceKind {
  return typeof value === "string" && (SOURCE_KINDS as readonly string[]).includes(value);
}

/** Keep only boolean/number/enum values for the contract's own property names. */
export function sanitizeProperties(
  event: string,
  properties: Record<string, unknown> = {},
): Record<string, SafeValue> {
  const clean: Record<string, SafeValue> = {};
  if (!isAllowedEvent(event)) return clean;
  for (const key of ALLOWED_PROPERTIES[event]) {
    const value = properties[key];
    if (typeof value === "boolean") {
      clean[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = Math.trunc(value);
    } else if (key === "source_kind") {
      clean[key] = isSourceKind(value) ? value : "other";
    }
  }
  return clean;
}

/**
 * before_send hook: drops anything outside the event contract and strips the
 * automatically attached URL/referrer/person metadata the SDK would otherwise
 * send. Returning null tells posthog-js to discard the event.
 */
export function scrubEvent(payload: CaptureResult): CaptureResult | null {
  const event = typeof payload.event === "string" ? payload.event : "";
  if (!isAllowedEvent(event)) return null;
  return {
    ...payload,
    event,
    properties: sanitizeProperties(event, (payload.properties ?? {}) as Record<string, unknown>),
    $set: undefined,
    $set_once: undefined,
    $unset: undefined,
  };
}

export function analyticsConfig(): { token: string; host: string } {
  return {
    token: (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ?? "").trim(),
    // US: https://us.i.posthog.com · EU: https://eu.i.posthog.com · or self-hosted.
    host: (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "").trim().replace(/\/+$/, ""),
  };
}

export function analyticsConfigured(): boolean {
  const { token, host } = analyticsConfig();
  return token.length > 0 && host.length > 0;
}

let client: AnalyticsClient | null = null;
let initialized = false;
let pendingSubjectId: string | null = null;

/** Wire the single posthog-js singleton (called once from instrumentation-client). */
export function installAnalyticsClient(instance: AnalyticsClient): void {
  client = instance;
  initialized = false;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readConsentDecision(): ConsentDecision | null {
  const store = storage();
  if (!store) return null;
  try {
    const value = store.getItem(ANALYTICS_CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

/** Initialize the browser client once, and only with consent + configuration. */
export function initAnalytics(): boolean {
  if (initialized) return client !== null;
  if (!client) return false;
  if (!analyticsConfigured()) return false;
  if (readConsentDecision() !== "granted") return false;

  const { token, host } = analyticsConfig();
  try {
    client.init(token, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      person_profiles: "identified_only",
      persistence: "localStorage",
      opt_out_capturing_by_default: true,
      respect_dnt: true,
      before_send: scrubEvent,
    });
    initialized = true;
    client.opt_in_capturing();
    return true;
  } catch {
    initialized = false;
    return false;
  }
}

export function setConsentDecision(decision: ConsentDecision): void {
  try {
    storage()?.setItem(ANALYTICS_CONSENT_KEY, decision);
  } catch {
    // Storage blocked: the in-memory decision still applies for this page.
  }
  if (decision === "granted") {
    if (initAnalytics()) applyPendingIdentity();
    return;
  }
  if (!initialized) return;
  try {
    client?.opt_out_capturing();
    client?.reset();
  } catch {
    // ignore
  }
  initialized = false;
}

/** Emit one contract event. Returns true only when the SDK accepted it. */
export function captureEvent(
  event: string,
  properties: Record<string, unknown> = {},
): boolean {
  if (!isAllowedEvent(event)) return false;
  if (!initAnalytics()) return false;
  try {
    client!.capture(event, sanitizeProperties(event, properties));
    return true;
  } catch {
    return false;
  }
}

export function trackSetupGuideOpened(input: {
  hasProfile: boolean;
  knowledgeDocCount: number;
}): boolean {
  return captureEvent(ANALYTICS_EVENTS.setupGuideOpened, {
    has_profile: input.hasProfile,
    knowledge_doc_count: input.knowledgeDocCount,
  });
}

export function trackKnowledgeIngested(input: {
  sourceKind: KnowledgeSourceKind | string;
  topicCount: number;
  docCount: number;
}): boolean {
  return captureEvent(ANALYTICS_EVENTS.knowledgeIngested, {
    source_kind: input.sourceKind,
    topic_count: input.topicCount,
    doc_count: input.docCount,
  });
}

export function trackSandboxMessageSent(input: {
  isFirstMessage: boolean;
  answerGrounded: boolean;
  handoff: boolean;
}): boolean {
  return captureEvent(ANALYTICS_EVENTS.sandboxMessageSent, {
    is_first_message: input.isFirstMessage,
    answer_grounded: input.answerGrounded,
    handoff: input.handoff,
  });
}

export function trackGoLiveApproved(input: {
  hasProfile: boolean;
  knowledgeDocCount: number;
  sandboxMessages: number;
}): boolean {
  return captureEvent(ANALYTICS_EVENTS.goLiveApproved, {
    has_profile: input.hasProfile,
    knowledge_doc_count: input.knowledgeDocCount,
    sandbox_messages: input.sandboxMessages,
  });
}

// Opaque auth ids only (Clerk `user_…`, demo `user_demo_owner`); never an email.
const OPAQUE_SUBJECT_ID = /^[A-Za-z0-9_-]{6,64}$/;

function applyPendingIdentity(): void {
  if (!pendingSubjectId || !initialized || !client) return;
  const subjectId = pendingSubjectId;
  pendingSubjectId = null;
  try {
    client.identify(subjectId);
  } catch {
    // ignore
  }
}

/** Identify with the opaque auth id when consent allows it, else stay anonymous. */
export function identifySession(subjectId: string): boolean {
  const id = typeof subjectId === "string" ? subjectId.trim() : "";
  if (!OPAQUE_SUBJECT_ID.test(id)) return false;
  pendingSubjectId = id;
  if (!initAnalytics()) return false;
  if (!client) return false;
  try {
    client.identify(id);
    pendingSubjectId = null;
    return true;
  } catch {
    return false;
  }
}

/** Detach the browser from the signed-in institution on logout. */
export function resetAnalyticsIdentity(): void {
  pendingSubjectId = null;
  if (!client) return;
  try {
    client.reset();
  } catch {
    // ignore
  }
}
