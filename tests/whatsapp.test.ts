// Unit tests for the WhatsApp Cloud client (src/lib/whatsapp.ts): payload
// shape, session-vs-template mode selection, and error classification.
// Every test stubs global fetch — nothing leaves the machine.
import "./env"; // must stay first: clears WhatsApp env before src/ loads

import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  isOpenServiceWindow,
  normalizeRecipient,
  sendNurtureMessage,
  sendSessionMessage,
  sendTemplateMessage,
  whatsappConfigured,
} from "@/lib/whatsapp";

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}
let sent: Recorded[] = [];
let replies: { status: number; json: unknown }[] = [];
let fallbackReply: { status: number; json: unknown } = { status: 200, json: {} };

after(() => {
  globalThis.fetch = realFetch;
});

function stub() {
  sent = [];
  replies = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    const r = replies.shift() ?? fallbackReply;
    return new Response(JSON.stringify(r.json), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function configure(opts: { token?: string; phoneId?: string; template?: string } = {}) {
  if (opts.token === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
  else process.env.WHATSAPP_ACCESS_TOKEN = opts.token;
  if (opts.phoneId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  else process.env.WHATSAPP_PHONE_NUMBER_ID = opts.phoneId;
  if (opts.template === undefined) delete process.env.WHATSAPP_TEMPLATE_NAME;
  else process.env.WHATSAPP_TEMPLATE_NAME = opts.template;
}

test("configuration is detected from the env", () => {
  configure({});
  assert.equal(whatsappConfigured(), false);
  configure({ token: "t", phoneId: "123" });
  assert.equal(whatsappConfigured(), true);
  configure({});
});

test("sends a session message with the right envelope", async () => {
  stub();
  configure({ token: "token-1", phoneId: "5550001111" });
  fallbackReply = { status: 200, json: { messages: [{ id: "wamid.ABC" }] } };

  const res = await sendSessionMessage("+91 98765 43210", "Your campus visit is confirmed.");
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.messageId, "wamid.ABC");
  assert.equal(res.ok && res.mode, "session");

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://graph.facebook.com/v26.0/5550001111/messages");
  assert.equal(sent[0].headers.Authorization, "Bearer token-1");
  assert.equal(sent[0].headers["Content-Type"], "application/json");
  assert.equal(sent[0].body.to, "919876543210", "E.164 without the + prefix");
  assert.equal(sent[0].body.messaging_product, "whatsapp");
  assert.equal(sent[0].body.type, "text");
  assert.equal(sent[0].body.text.body, "Your campus visit is confirmed.");
});

test("sends an approved template outside the service window", async () => {
  stub();
  configure({ token: "t", phoneId: "1", template: "nurture_day1" });
  process.env.WHATSAPP_TEMPLATE_LANG = "hi";
  fallbackReply = { status: 200, json: { messages: [{ id: "wamid.XYZ" }] } };

  const res = await sendTemplateMessage("9822011223", "Seats are filling fast");
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.mode, "template");

  const body = sent[0].body;
  assert.equal(body.type, "template");
  assert.equal(body.template.name, "nurture_day1");
  assert.equal(body.template.language.code, "hi");
  assert.equal(body.template.components[0].parameters[0].text, "Seats are filling fast");
  delete process.env.WHATSAPP_TEMPLATE_LANG;
});

test("retries a template without parameters when Meta rejects them", async () => {
  stub();
  configure({ token: "t", phoneId: "1", template: "no_vars_template" });
  replies = [
    { status: 400, json: { error: { code: 100, message: "Invalid template params" } } },
    { status: 200, json: { messages: [{ id: "wamid.OK" }] } },
  ];

  const res = await sendTemplateMessage("9822011223", "hello");
  assert.equal(res.ok, true);
  assert.equal(sent.length, 2, "first attempt failed, second succeeded");
  assert.equal("components" in sent[0].body.template, true);
  assert.equal("components" in sent[1].body.template, false);
});

test("a missing template outside the window is an explicit, non-retryable failure", async () => {
  stub();
  configure({ token: "t", phoneId: "1" });

  const res = await sendTemplateMessage("9822011223", "hello");
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.retryable, false);
  assert.match(res.ok === false ? res.error : "", /24-hour service window/);
  assert.equal(sent.length, 0, "nothing was sent");
});

test("classifies provider errors: 5xx retryable, 4xx not", async () => {
  stub();
  configure({ token: "t", phoneId: "1" });

  fallbackReply = { status: 500, json: { error: { code: 130429, message: "busy" } } };
  const busy = await sendSessionMessage("9822011223", "hi");
  assert.equal(busy.ok === false && busy.retryable, true);
  assert.match(busy.ok === false ? busy.error : "", /500\/130429/);

  fallbackReply = { status: 401, json: { error: { code: 190, message: "bad token" } } };
  const bad = await sendSessionMessage("9822011223", "hi");
  assert.equal(bad.ok === false && bad.retryable, false);
});

test("without credentials the client refuses to build a request", async () => {
  stub();
  configure({});

  const res = await sendSessionMessage("9822011223", "hi");
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.retryable, false);
  assert.equal(sent.length, 0);
});

test("picks session vs template from the service window", async () => {
  stub();
  configure({ token: "t", phoneId: "1", template: "nurture_day1" });
  fallbackReply = { status: 200, json: { messages: [{ id: "wamid.1" }] } };

  await sendNurtureMessage("9822011223", "msg", true);
  assert.equal(sent[0].body.type, "text", "open window → free-form session message");

  await sendNurtureMessage("9822011223", "msg", false);
  assert.equal(sent[0 + 1].body.type, "template", "closed window → template");

  configure({ token: "t", phoneId: "1" });
  const closed = await sendNurtureMessage("9822011223", "msg", false);
  assert.equal(closed.ok, false, "closed window without a template fails loudly");
});

test("service window arithmetic", () => {
  assert.equal(isOpenServiceWindow(undefined), false);
  assert.equal(isOpenServiceWindow("not-a-date"), false);
  assert.equal(isOpenServiceWindow(new Date(Date.now() - 60_000).toISOString()), true);
  assert.equal(isOpenServiceWindow(new Date(Date.now() - 25 * 3600_000).toISOString()), false);
  assert.equal(normalizeRecipient("+91 98765-43210"), "919876543210");
});
