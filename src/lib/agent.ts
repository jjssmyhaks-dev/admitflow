// Inquiry + Counseling agent engine (PRD §6, agents 1 & 2).
// Deterministic and grounded: answers only from retrieved knowledge chunks,
// enforces never-answer topics, captures lead slots, scores and tiers leads.
// If LLM_API_KEY is configured, the same context is sent to the LLM with a
// strict grounding prompt; otherwise a template engine composes the reply.
import { getRepo, uid } from "@/lib/repo";
import { llmConfigured } from "@/lib/env";
import type {
  AuditEvent,
  Conversation,
  Lead,
  Message,
} from "@/lib/types";

export interface ChatInput {
  tenantId: string;
  channel: Lead["source"];
  conversationId?: string;
  leadPhone?: string;
  text: string;
  /** Fields supplied by the channel itself (lead-form webhook). */
  predefined?: { name?: string; course?: string; city?: string };
}

export interface ChatResult {
  conversationId: string;
  reply: string;
  sources: string[];
  lead: Lead;
  handoff: boolean;
  tierChanged?: Lead["tier"];
}

const OPTOUT = /\b(stop|unsubscribe|opt\s*out)\b/i;
const PHONE_RE = /(\+?91[\s-]?)?[6-9]\d{9}\b/;
const VISIT_RE = /\b(visit|campus tour|call me|callback|talk to (a )?counsell?or|human)\b/i;
const GREET_RE = /\b(hi|hello|namaste|hey|namaskar)\b/i;

// Slot-filling plan: one question at a time (PRD 5.2)
type Slot = "name" | "phone" | "course" | "city" | "done";
const SLOT_ORDER: Slot[] = ["name", "phone", "course", "city"];

function nextSlot(lead: Lead): Slot {
  if (!lead.name) return "name";
  if (!lead.phone) return "phone";
  if (!lead.courseInterest) return "course";
  if (!lead.city) return "city";
  return "done";
}

function detectLanguage(text: string): string {
  if (/[\u0900-\u097f]/.test(text)) return "hi";
  if (/\b(kya|hai|karna|chahiye|bataiye|kitna|kab|kaise|haan|nahi|namaste)\b/i.test(text))
    return "hinglish";
  return "en";
}

/** Score a lead on the 4 qualification axes from the message history. */
function scoreLead(lead: Lead, allText: string): { score: number; tier: Lead["tier"] } {
  let score = lead.score;
  const t = allText.toLowerCase();
  if (lead.courseInterest) score += 8;
  if (lead.city) score += 6;
  if (/\b(admission|apply|entrance|form|registration)\b/.test(t)) score += 15;
  if (/\b(this (year|session)|urgent|asap|soon|november|january)\b/.test(t)) score += 10;
  if (VISIT_RE.test(t)) score += 12;
  if (/\b(fee|cost|price|scholarship|discount)\b/.test(t)) score += 5;
  if (/\b(just (looking|checking|curious)|later|next year|maybe)\b/.test(t)) score -= 12;
  score = Math.max(0, Math.min(100, score));
  return { score, tier: score >= 70 ? "hot" : score >= 40 ? "warm" : "cold" };
}

function neverAnswerHit(text: string, never: string[]): string | null {
  const t = text.toLowerCase();
  const checks: [RegExp, string][] = [
    [/\b(scholarship|stipend|fee waiver)\b/, "scholarship promises"],
    [/\b(guarantee|guaranteed|assured)\b/, "guarantees"],
    [/\b(discount|concession|reduce (the )?fee)\b/, "fee negotiation"],
  ];
  for (const [re, label] of checks) {
    if (re.test(t) && never.some((n) => n.toLowerCase().includes(label.split(" ")[0]))) return label;
  }
  return null;
}

function extractAnswer(chunks: { content: string; topics: string[] }[]): string | null {
  // Pick the sentences that best match: first chunk, first 2 sentences.
  const best = chunks[0]?.content;
  if (!best) return null;
  const sentences = best.match(/[^.!?]+[.!?]+/g) ?? [best];
  return sentences.slice(0, 3).join(" ").trim();
}

const FALLBACK =
  "I want to make sure I give you the accurate answer, so I am checking with our admissions counselor — they will reply shortly. Meanwhile, could you share your name and the course you are interested in?";

async function llmReply(
  question: string,
  context: string[],
  tone: string,
): Promise<string | null> {
  if (!llmConfigured) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              `You are an admissions assistant. Tone: ${tone} ` +
              "Answer ONLY from the CONTEXT. If the answer is not in the context, " +
              `reply exactly: "${FALLBACK}". Never invent fees, dates, or guarantees. ` +
              "Ask one question at a time. Reply in the same language as the user.",
          },
          {
            role: "user",
            content: `CONTEXT:\n${context.map((c, i) => `[${i + 1}] ${c}`).join("\n")}\n\nQUESTION: ${question}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

function slotQuestion(slot: Slot, tenantName: string): string {
  switch (slot) {
    case "name":
      return `Thanks for reaching out to ${tenantName}! Before we start — may I know your name?`;
    case "phone":
      return "Great! Could you share your mobile number so we can keep you updated?";
    case "course":
      return "Which class or course are you interested in?";
    case "city":
      return "Which city are you based in?";
    default:
      return FALLBACK;
  }
}

export async function handleInquiry(input: ChatInput): Promise<ChatResult> {
  const repo = await getRepo();
  const settings = await repo.getSettings(input.tenantId);
  const tenant = await repo.getTenant(input.tenantId);
  const now = new Date().toISOString();
  const language = detectLanguage(input.text);

  /* --------------------------- opt-out handling -------------------------- */
  if (OPTOUT.test(input.text)) {
    const lead = await upsertPartial(repo, input, {
      optedOut: true,
      status: "opted_out",
      updatedAt: now,
      language,
    });
    const conv = await ensureConversation(repo, input, lead.id, now);
    await commit(repo, conv, [
      { role: "lead", content: input.text, sources: [] },
      { role: "system", content: "You have been opted out. No further messages will be sent.", sources: [] },
    ], now);
    await audit(repo, {
      tenantId: input.tenantId, actor: "system", action: "consent.opt_out",
      detail: `Lead ${lead.phone} opted out via ${input.channel}`, sources: [], conversationId: conv.id,
    });
    return { conversationId: conv.id, reply: "You have been opted out. Reply START to rejoin.", sources: [], lead, handoff: false };
  }

  /* ------------------------------ load state ----------------------------- */
  const priorConv = input.conversationId
    ? await repo.getConversation(input.tenantId, input.conversationId)
    : null;
  const priorMsgs = priorConv ? await repo.listMessages(input.tenantId, priorConv.id) : [];
  const historyText = priorMsgs.map((m) => m.content).join(" \n ");

  // Resolve the lead by phone, else from the ongoing conversation.
  let existingLead: Lead | null = null;
  if (input.leadPhone) {
    existingLead =
      (await repo.listLeads(input.tenantId)).find((l) => l.phone === input.leadPhone) ?? null;
  }
  if (!existingLead && priorConv) {
    existingLead = await repo.getLead(input.tenantId, priorConv.leadId);
  }

  /* ---------------------------- guardrails ------------------------------- */
  const blocked = neverAnswerHit(input.text, settings.neverAnswer);
  const wantsHuman = VISIT_RE.test(input.text);
  const retrieval = blocked ? [] : await repo.searchChunks(input.tenantId, input.text, 4);

  /* --------------------------- capture slots ----------------------------- */
  // Capture FIRST so the reply can ask the *next* question (PRD 5.2: one
  // question at a time, never re-asking what the lead just told us).
  const base = existingLead ?? placeholderLead(input);
  const partial: Partial<Lead> = {
    language,
    updatedAt: now,
  };
  const lastAgentMsg = [...priorMsgs].reverse().find((m) => m.role === "ai");
  const askedName = /may i know your name|your name/i.test(lastAgentMsg?.content ?? "");
  const askedPhone = /mobile number|phone number/i.test(lastAgentMsg?.content ?? "");
  const askedCourse = /class or course|interested in/i.test(lastAgentMsg?.content ?? "");
  const askedCity = /which city|based in/i.test(lastAgentMsg?.content ?? "");
  const words = input.text.trim().split(/\s+/);

  const COURSE_RE = /\b((?:class\s?)?(?:b\.?tech|m\.?tech|mba|bba|bca|nursery|pg|xi{1,2}|11th|12th|class\s+\d{1,2}|\d{1,2}(?:th)?))\b/i;
  const STREAM_RE = /\b(science|commerce|humanities|pcm|pcb|medical|non-medical|it|cs|cse|ece|mech)\b/i;

  // Channel-provided fields (lead-form webhook) are authoritative.
  if (input.predefined?.name && !base.name) partial.name = input.predefined.name.trim();
  if (input.predefined?.city && !base.city) partial.city = input.predefined.city.trim();
  if (input.predefined?.course && (!base.courseInterest || askedCourse)) {
    partial.courseInterest = input.predefined.course.trim();
  }

  if (askedPhone && PHONE_RE.test(input.text)) {
    partial.phone = normalizePhone(input.text.match(PHONE_RE)![0]);
  } else if (!base.phone && PHONE_RE.test(input.text)) {
    partial.phone = normalizePhone(input.text.match(PHONE_RE)![0]);
  } else if (!base.phone && input.leadPhone) {
    partial.phone = input.leadPhone;
  }
  if (!base.name && askedName && words.length <= 6 && !PHONE_RE.test(input.text)) {
    partial.name = input.text.trim();
  }

  // City: an explicit "from <City>" always wins. Otherwise only accept a
  // capitalized word as the answer to our city question — and never when the
  // message is actually naming a course ("Class 11 Science").
  const explicitFrom = input.text.match(/\b(?:from|in|based in)\s+([A-Z][a-zA-Z]{2,20})\b/);
  if (explicitFrom) {
    partial.city = explicitFrom[1];
  } else if (askedCity && words.length <= 5 && !COURSE_RE.test(input.text)) {
    const m = input.text.match(/\b([A-Z][a-zA-Z]{2,20})\b/);
    if (m) partial.city = m[1];
  }

  if (!partial.courseInterest) {
    // Keep the stream when present: "Class 11 Science", "B.Tech CSE".
    const withStream = input.text.match(
      new RegExp(`${COURSE_RE.source}[^a-z0-9]{0,3}(?:${STREAM_RE.source})`, "i"),
    );
    const m = input.text.match(COURSE_RE);
    const captured = m
      ? withStream
        ? `${m[1].trim()} ${withStream[2] ?? ""}`.trim()
        : m[1].trim()
      : null;
    if (captured && (askedCourse || words.length <= 6)) {
      partial.courseInterest = captured;
    } else if (askedCourse && words.length <= 8) {
      partial.courseInterest = input.text.trim();
    }
  }

  const merged: Lead = {
    ...base,
    ...partial,
    name: partial.name ?? base.name,
    phone: partial.phone ?? base.phone,
  } as Lead;
  const slot = nextSlot(merged);
  const needsSlot = slot !== "done";
  const hasQuestion = words.length > 2;
  // Score before composing so the reply can announce a hot-lead handoff.
  const scored = scoreLead(merged, `${historyText} ${input.text}`);

  /* ---------------------------- compose reply ---------------------------- */
  let reply: string;
  let sources: string[] = [];
  let handoff = false;

  if (blocked) {
    reply = `I am not able to confirm that directly — let me connect you with our admissions counselor who can give you the correct information.${needsSlot ? ` ${slotQuestion(slot, tenant?.name ?? "us")}` : ""}`;
    handoff = true;
    sources = [];
  } else if (retrieval.length > 0) {
    // Grounded answer first — always answer what was asked, then keep
    // the one-question-at-a-time capture moving.
    const ctx = retrieval.map((c) => c.content);
    const llm = await llmReply(input.text, ctx, settings.tone);
    reply = llm ?? extractAnswer(retrieval) ?? FALLBACK;
    if (!llm && !reply.includes("?")) reply += "\n\nIs there anything else you would like to know?";
    const docs = await repo.listKnowledge(input.tenantId);
    for (const c of retrieval) {
      const doc = docs.find((d) => d.id === c.docId);
      if (doc && !sources.includes(doc.name)) sources.push(doc.name);
    }
    if (needsSlot && !wantsHuman) {
      reply += `\n\n${slotQuestion(slot, tenant?.name ?? "us")}`;
    }
  } else if (needsSlot && !hasQuestion) {
    // Short message (greeting or slot answer): keep capturing, one question at a time.
    reply = slotQuestion(slot, tenant?.name ?? "our institution");
  } else {
    reply = FALLBACK;
    handoff = hasQuestion; // no retrieval hit on a real question => escalate
  }
  if (wantsHuman) {
    handoff = true;
    reply += "\n\nI am alerting an admissions counselor right now.";
  }
  // Hot leads are handed to a counselor instantly (PRD 5.2 step 4).
  const newlyHot = scored.tier === "hot" && base.tier !== "hot";
  if (newlyHot && !handoff) {
    handoff = true;
    reply += "\n\nI am alerting an admissions counselor right now — they will reach out shortly.";
  }

  /* ------------------------------ persist lead --------------------------- */
  const lead = await repo.upsertLead({
    ...merged,
    score: scored.score,
    tier: scored.tier,
    status: base.status === "new" && scored.tier === "hot" ? "qualified" : base.status === "new" ? "nurturing" : base.status,
    optedOut: merged.optedOut ?? false,
  });

  // Phone de-dupe may have matched an existing lead record: if this
  // conversation pointed at a placeholder, re-point it at the surviving lead
  // so the thread and the lead stay consistent.
  if (priorConv && priorConv.leadId !== lead.id) {
    priorConv.leadId = lead.id;
    await repo.upsertConversation(priorConv);
  }

  const conv = await ensureConversation(repo, input, lead.id, now);
  if (handoff && conv.status === "ai") {
    conv.status = "human";
    conv.handoffReason = blocked
      ? "Blocked-topic question"
      : wantsHuman
        ? "Lead requested human"
        : "No retrieval hit";
    await repo.upsertConversation(conv);
  }

  await commit(repo, conv, [
    { role: "lead", content: input.text, sources: [] },
    { role: "ai", content: reply, sources },
  ], now);

  const action = blocked ? "guardrail.blocked" : sources.length ? "answer.grounded" : "answer.fallback";
  await audit(repo, {
    tenantId: input.tenantId, actor: "ai", action, detail:
      action === "answer.grounded"
        ? `Grounded answer to: "${input.text.slice(0, 80)}"`
        : action === "guardrail.blocked"
          ? `Blocked topic: "${input.text.slice(0, 80)}"`
          : `No knowledge hit for: "${input.text.slice(0, 80)}"`,
    sources, conversationId: conv.id,
  });
  if (handoff) {
    await audit(repo, {
      tenantId: input.tenantId, actor: "ai", action: "handoff.requested",
      detail: `Lead ${lead.name || lead.phone} escalated (tier ${lead.tier})`,
      sources: [], conversationId: conv.id,
    });
  }

  return {
    conversationId: conv.id,
    reply,
    sources,
    lead,
    handoff,
    tierChanged: scored.tier !== base.tier ? scored.tier : undefined,
  };
}

function placeholderLead(input: ChatInput): Lead {
  return {
    id: uid(),
    tenantId: input.tenantId,
    name: "",
    phone: input.leadPhone ?? "",
    source: input.channel,
    score: 10,
    tier: "cold",
    status: "new",
    language: "en",
    optedOut: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return raw.startsWith("+") ? raw : `+${digits}`;
}

async function upsertPartial(
  repo: Awaited<ReturnType<typeof getRepo>>,
  input: ChatInput,
  patch: Partial<Lead>,
): Promise<Lead> {
  const leads = await repo.listLeads(input.tenantId);
  const existing = input.leadPhone ? leads.find((l) => l.phone === input.leadPhone) : null;
  const base = existing ?? placeholderLead(input);
  return repo.upsertLead({ ...base, ...patch } as Lead);
}

async function ensureConversation(
  repo: Awaited<ReturnType<typeof getRepo>>,
  input: ChatInput,
  leadId: string,
  now: string,
): Promise<Conversation> {
  if (input.conversationId) {
    const c = await repo.getConversation(input.tenantId, input.conversationId);
    if (c) {
      c.lastActivityAt = now;
      await repo.upsertConversation(c);
      return c;
    }
  }
  const conv: Conversation = {
    id: uid(),
    tenantId: input.tenantId,
    leadId,
    channel: input.channel,
    status: "ai",
    lastActivityAt: now,
    createdAt: now,
  };
  await repo.upsertConversation(conv);
  return conv;
}

async function commit(
  repo: Awaited<ReturnType<typeof getRepo>>,
  conv: Conversation,
  msgs: { role: Message["role"]; content: string; sources: string[] }[],
  now: string,
) {
  let t = new Date(now).getTime();
  for (const m of msgs) {
    t += 1000;
    await repo.addMessage({
      id: uid(),
      conversationId: conv.id,
      tenantId: conv.tenantId,
      role: m.role,
      content: m.content,
      sources: m.sources,
      createdAt: new Date(t).toISOString(),
    });
  }
  conv.lastActivityAt = now;
  await repo.upsertConversation(conv);
}

async function audit(repo: Awaited<ReturnType<typeof getRepo>>, e: Omit<AuditEvent, "id" | "createdAt">) {
  await repo.addAudit({ ...e, id: uid(), createdAt: new Date().toISOString() });
}
