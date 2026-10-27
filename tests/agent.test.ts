// Focused behaviour tests for the inquiry agent (src/lib/agent.ts).
//
// Covered: slot capture (one question at a time, never re-asking, course vs
// city, phone normalisation), language detection, lead scoring/tiering across
// turns, and the never-answer guardrails.
//
// Run with: npm test
import "./env"; // must stay first: clears LLM/OCR/WhatsApp keys before src/ loads

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { defaultSettings, setRepoForTests, uid } from "@/lib/repo";
import { handleInquiry } from "@/lib/agent";
import type { Repo } from "@/lib/repo";
import type {
  AgentSettings,
  AuditEvent,
  Conversation,
  KnowledgeChunk,
  KnowledgeDoc,
  Lead,
  Message,
  Tenant,
} from "@/lib/types";

const TENANT = "org_greenfield";
const NOW = "2026-10-26T09:00:00.000Z";

after(() => setRepoForTests(null));

/* ------------------------------ test double ------------------------------ */

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9\u0900-\u097f]+/)
    .filter((t) => t.length > 1);
}

/** In-memory Repo with the same semantics as the demo JSON store. */
class MemoryRepo implements Repo {
  tenants: Tenant[] = [];
  knowledge: KnowledgeDoc[] = [];
  chunks: KnowledgeChunk[] = [];
  leads: Lead[] = [];
  conversations: Conversation[] = [];
  messages: Message[] = [];
  settings: Record<string, AgentSettings> = {};
  audit: AuditEvent[] = [];

  async getTenant(id: string) {
    return this.tenants.find((t) => t.id === id) ?? null;
  }
  async listTenants() {
    return [...this.tenants];
  }
  async upsertTenant(t: Tenant) {
    this.tenants.push(t);
    return t;
  }
  async listKnowledge(tenantId: string) {
    return this.knowledge.filter((d) => d.tenantId === tenantId);
  }
  async addKnowledge(doc: KnowledgeDoc, parts: Omit<KnowledgeChunk, "id">[]) {
    this.knowledge.push(doc);
    for (const c of parts) this.chunks.push({ ...c, id: uid() });
  }
  async updateKnowledge(doc: KnowledgeDoc, parts: Omit<KnowledgeChunk, "id">[]) {
    const i = this.knowledge.findIndex(
      (d) => d.id === doc.id && d.tenantId === doc.tenantId,
    );
    if (i >= 0) this.knowledge[i] = doc;
    else this.knowledge.push(doc);
    this.chunks = this.chunks.filter((c) => c.docId !== doc.id);
    for (const c of parts) this.chunks.push({ ...c, id: uid() });
  }
  async deleteKnowledge(tenantId: string, docId: string) {
    this.knowledge = this.knowledge.filter(
      (d) => !(d.id === docId && d.tenantId === tenantId),
    );
    this.chunks = this.chunks.filter((c) => c.docId !== docId);
  }
  async listChunks(tenantId: string, docId: string, limit = 100) {
    return this.chunks
      .filter((c) => c.tenantId === tenantId && c.docId === docId)
      .slice(0, limit);
  }
  async searchChunks(tenantId: string, query: string, limit = 4) {
    const terms = tokenize(query);
    if (!terms.length) return [];
    return this.chunks
      .filter((c) => c.tenantId === tenantId)
      .map((c) => {
        const text = tokenize(c.content);
        let score = 0;
        for (const t of terms) {
          if (text.includes(t)) score += 2;
          if (c.topics.some((topic) => topic.includes(t))) score += 1;
        }
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.c);
  }
  async listLeads(tenantId: string) {
    return this.leads
      .filter((l) => l.tenantId === tenantId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getLead(tenantId: string, id: string) {
    return this.leads.find((l) => l.id === id && l.tenantId === tenantId) ?? null;
  }
  async upsertLead(lead: Lead) {
    if (lead.phone) {
      const byPhone = this.leads.findIndex(
        (l) => l.tenantId === lead.tenantId && l.phone === lead.phone,
      );
      if (byPhone >= 0) {
        this.leads[byPhone] = { ...this.leads[byPhone], ...lead, id: this.leads[byPhone].id };
        return this.leads[byPhone];
      }
    }
    const byId = this.leads.findIndex((l) => l.id === lead.id);
    if (byId >= 0) {
      this.leads[byId] = { ...this.leads[byId], ...lead };
      return this.leads[byId];
    }
    this.leads.push(lead);
    return lead;
  }
  async listConversations(tenantId: string) {
    return this.conversations.filter((c) => c.tenantId === tenantId);
  }
  async getConversation(tenantId: string, id: string) {
    return this.conversations.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
  }
  async upsertConversation(c: Conversation) {
    const i = this.conversations.findIndex((x) => x.id === c.id);
    if (i >= 0) this.conversations[i] = c;
    else this.conversations.push(c);
  }
  async listMessages(tenantId: string, conversationId: string) {
    return this.messages
      .filter((m) => m.conversationId === conversationId && m.tenantId === tenantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async addMessage(m: Message) {
    this.messages.push(m);
  }
  async getSettings(tenantId: string): Promise<AgentSettings> {
    return this.settings[tenantId] ?? defaultSettings(tenantId);
  }
  async saveSettings(s: AgentSettings) {
    this.settings[s.tenantId] = s;
  }
  async addAudit(e: AuditEvent) {
    this.audit.unshift(e);
  }
  async listAudit(tenantId: string, limit = 200) {
    return this.audit.filter((a) => a.tenantId === tenantId).slice(0, limit);
  }
}

/** Fresh repo + tenant (+ seeded knowledge unless `knowledge: false`). */
function setup(opts: { knowledge?: boolean } = {}) {
  const repo = new MemoryRepo();
  repo.tenants.push({
    id: TENANT,
    name: "Greenfield Public School",
    type: "school",
    affiliation: "CBSE",
    city: "Pune",
    sector: "private",
    languages: ["en", "hi", "hinglish"],
    slug: "greenfield",
    createdAt: NOW,
  });
  if (opts.knowledge !== false) {
    const doc: KnowledgeDoc = {
      id: "doc-fees",
      tenantId: TENANT,
      name: "Fee Structure 2026-27.pdf",
      kind: "pdf",
      status: "ingested",
      version: 1,
      updatedAt: NOW,
      chunkCount: 1,
      topics: ["fees"],
    };
    repo.knowledge.push(doc);
    repo.chunks.push({
      id: "chunk-fees",
      docId: doc.id,
      tenantId: TENANT,
      content:
        "The fee for Class 11 Science is Rs 45,000 payable in two installments. " +
        "Scholarship decisions are made in June each year.",
      topics: ["fees"],
    });
  }
  setRepoForTests(repo);
  return repo;
}

function ask(
  text: string,
  conversationId?: string,
  extra: Partial<Parameters<typeof handleInquiry>[0]> = {},
) {
  return handleInquiry({
    tenantId: TENANT,
    channel: "web_widget",
    conversationId,
    text,
    ...extra,
  });
}

/* ----------------------------- slot capture ------------------------------ */

test("slot capture asks one question at a time and never re-asks", async (t) => {
  const repo = setup();
  t.after(() => setRepoForTests(null));

  const first = await ask("Hi");
  assert.match(first.reply, /may I know your name/i, "first question is the name");
  assert.equal(first.lead.name, "");
  assert.equal(first.lead.tier, "cold");
  const convId = first.conversationId;

  const named = await ask("Aarav Sharma", convId);
  assert.equal(named.lead.name, "Aarav Sharma");
  assert.match(named.reply, /mobile number/i);
  assert.doesNotMatch(named.reply, /may I know your name/i, "name is not asked twice");

  const called = await ask("9876543210", convId);
  assert.equal(called.lead.phone, "+919876543210", "normalised to E.164");
  assert.match(called.reply, /class or course/i);
  assert.doesNotMatch(called.reply, /may I know your name|mobile number/i);

  const course = await ask("Class 11 Science", convId);
  assert.equal(course.lead.courseInterest, "Class 11 Science", "stream kept with the course");
  assert.match(course.reply, /which city/i);
  assert.doesNotMatch(course.reply, /may I know your name|mobile number|class or course/i);

  const city = await ask("I am from Pune", convId);
  assert.equal(city.lead.city, "Pune", "'from <City>' always wins");
  assert.doesNotMatch(city.reply, /which city|class or course|mobile number/i);

  assert.equal(repo.leads.length, 1, "all turns collapse onto one lead record");
  assert.equal(
    repo.messages.filter((m) => m.role === "ai").length,
    5,
    "one reply per turn",
  );
});

test("never mistakes a course for a city when answering the city question", async (t) => {
  setup();
  t.after(() => setRepoForTests(null));

  const first = await ask("Hi");
  const convId = first.conversationId;
  await ask("Riya", convId);
  await ask("9811122233", convId);
  const askedCity = await ask("Class 11 Science", convId);
  assert.match(askedCity.reply, /which city/i);

  const answered = await ask("Class 11 Science", convId);
  assert.equal(answered.lead.city ?? "", "", "a course must not be recorded as a city");
  assert.equal(answered.lead.courseInterest, "Class 11 Science");
});

test("normalises Indian mobile numbers", async (t) => {
  for (const [raw, expected] of [
    ["9876543210", "+919876543210"],
    ["+919876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
  ] as const) {
    const repo = setup({ knowledge: false });
    const res = await ask(`My number is ${raw}`);
    assert.equal(res.lead.phone, expected, `"${raw}" → ${expected}`);
    assert.equal(repo.leads.length, 1);
    setRepoForTests(null);
  }
  t.after(() => setRepoForTests(null));
});

/* --------------------------- language detection -------------------------- */

test("detects the lead's language from the message", async (t) => {
  t.after(() => setRepoForTests(null));
  const cases: [string, string][] = [
    ["नमस्ते, क्या फीस है?", "hi"],
    ["kya aapke paas fees ka detail hai", "hinglish"],
    ["What are the course fees?", "en"],
  ];
  for (const [text, expected] of cases) {
    setup({ knowledge: false });
    const res = await ask(text);
    assert.equal(res.lead.language, expected, `"${text}" → ${expected}`);
    assert.equal(res.lead.source, "web_widget");
  }
});

/* -------------------------------- scoring -------------------------------- */

test("scores and tiers a lead across turns: cold → warm → hot", async (t) => {
  const repo = setup();
  t.after(() => setRepoForTests(null));

  // Lead-form style turn: the channel supplies name/course/city up front.
  const warm = await handleInquiry({
    tenantId: TENANT,
    channel: "lead_form",
    text: "I want to apply this session. What is the fee?",
    predefined: { name: "Aarav", course: "Class 11 Science", city: "Pune" },
  });
  assert.equal(warm.lead.score, 54, "course 8 + city 6 + apply 15 + urgency 10 + fee 5 (+ base 10)");
  assert.equal(warm.lead.tier, "warm");
  assert.equal(warm.handoff, false, "a warm, answerable lead stays with the AI");
  assert.equal(warm.lead.status, "nurturing");
  assert.ok(warm.sources.includes("Fee Structure 2026-27.pdf"), "answer is grounded");

  const hot = await ask("Please confirm soon, I need to apply now", warm.conversationId);
  assert.ok(hot.lead.score >= 70, `expected ≥ 70, got ${hot.lead.score}`);
  assert.equal(hot.lead.tier, "hot");
  assert.equal(hot.tierChanged, "hot");
  assert.equal(hot.handoff, true, "a hot lead is handed to a counselor");
  assert.match(hot.reply, /admissions counselor/i);

  const conv = await repo.getConversation(TENANT, hot.conversationId);
  assert.equal(conv?.status, "human");
});

test("keeps a low-intent lead cold", async (t) => {
  setup();
  t.after(() => setRepoForTests(null));

  const res = await ask("Just looking, maybe next year");
  assert.equal(res.lead.score, 0, "browsing intent is discounted to zero");
  assert.equal(res.lead.tier, "cold");
  assert.equal(res.tierChanged, undefined);
});

/* --------------------------- never-answer guard -------------------------- */

test("blocks a never-answer topic and hands off to a counselor", async (t) => {
  const repo = setup();
  t.after(() => setRepoForTests(null));

  const res = await ask("Do you offer scholarship?");
  assert.equal(res.handoff, true);
  assert.deepEqual(res.sources, [], "a blocked topic is never answered from knowledge");
  assert.match(res.reply, /not able to confirm that directly/i);

  const conv = await repo.getConversation(TENANT, res.conversationId);
  assert.equal(conv?.status, "human");
  assert.equal(conv?.handoffReason, "Blocked-topic question");

  const actions = repo.audit.map((a) => a.action);
  assert.ok(actions.includes("guardrail.blocked"), `expected guardrail.blocked in ${actions}`);
  assert.ok(actions.includes("handoff.requested"));
  const blocked = repo.audit.find((a) => a.action === "guardrail.blocked");
  assert.match(blocked?.detail ?? "", /scholarship/i);
});

test("the guardrail follows the tenant's own neverAnswer list", async (t) => {
  const repo = setup();
  t.after(() => setRepoForTests(null));

  // Same question, but this tenant has switched the guardrail off.
  await repo.saveSettings({
    ...defaultSettings(TENANT),
    neverAnswer: [],
  });

  const res = await ask("Do you offer scholarship?");
  assert.equal(res.handoff, false, "no blocked topic → no forced handoff");
  assert.ok(res.sources.includes("Fee Structure 2026-27.pdf"), "grounded answer instead");
  assert.ok(!repo.audit.some((a) => a.action === "guardrail.blocked"));

  // And a tenant whose list does not cover guarantees still gets them blocked
  // only when its own rules say so.
  await repo.saveSettings({
    ...defaultSettings(TENANT),
    neverAnswer: ["Seat guarantees or confirmed admission"],
  });
  const guarantee = await ask("Is my seat guaranteed if I pay today?");
  assert.equal(guarantee.handoff, true);
  assert.deepEqual(guarantee.sources, []);
  assert.ok(repo.audit.some((a) => a.action === "guardrail.blocked"));
});
