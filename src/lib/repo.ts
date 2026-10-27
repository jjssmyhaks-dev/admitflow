// Repository layer. On Cloudflare Workers the D1 adapter is used (Sites
// storage); with Supabase env vars the Supabase adapter takes over; otherwise
// a local JSON demo store (seeded) keeps every flow working.
import { supabaseConfigured } from "@/lib/env";
import { embeddingsConfigured, embedQuery } from "@/lib/embed";
import { rankHybrid, retrievalTokens } from "@/lib/retrieval";
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

export interface Repo {
  getTenant(id: string): Promise<Tenant | null>;
  listTenants(): Promise<Tenant[]>;
  upsertTenant(t: Tenant): Promise<Tenant>;
  listKnowledge(tenantId: string): Promise<KnowledgeDoc[]>;
  addKnowledge(doc: KnowledgeDoc, chunks: Omit<KnowledgeChunk, "id">[]): Promise<void>;
  /** Replaces a document and rewrites its chunks (async extraction results). */
  updateKnowledge(doc: KnowledgeDoc, chunks: Omit<KnowledgeChunk, "id">[]): Promise<void>;
  deleteKnowledge(tenantId: string, docId: string): Promise<void>;
  listChunks(tenantId: string, docId: string, limit?: number): Promise<KnowledgeChunk[]>;
  searchChunks(tenantId: string, query: string, limit?: number): Promise<KnowledgeChunk[]>;
  listLeads(tenantId: string): Promise<Lead[]>;
  getLead(tenantId: string, id: string): Promise<Lead | null>;
  upsertLead(lead: Lead): Promise<Lead>; // dedupes by phone within tenant
  listConversations(tenantId: string): Promise<Conversation[]>;
  getConversation(tenantId: string, id: string): Promise<Conversation | null>;
  upsertConversation(c: Conversation): Promise<void>;
  listMessages(tenantId: string, conversationId: string): Promise<Message[]>;
  addMessage(m: Message): Promise<void>;
  getSettings(tenantId: string): Promise<AgentSettings>;
  saveSettings(s: AgentSettings): Promise<void>;
  addAudit(e: AuditEvent): Promise<void>;
  listAudit(tenantId: string, limit?: number): Promise<AuditEvent[]>;
}

export const uid = () => crypto.randomUUID();

/* ------------------------------- demo store ------------------------------ */

interface DemoDB {
  tenants: Tenant[];
  knowledge: KnowledgeDoc[];
  chunks: KnowledgeChunk[];
  leads: Lead[];
  conversations: Conversation[];
  messages: Message[];
  settings: Record<string, AgentSettings>;
  audit: AuditEvent[];
}

const DATA_DIR = `${process.cwd()}/.data`;
const DB_FILE = `${DATA_DIR}/demo-db.json`;

// `node:fs` is not available in the Workers runtime, so the demo store only
// persists to disk when a Node-style fs module can be resolved at runtime.
// On Workers the D1 adapter is used instead and this store stays in memory.
type NodeFs = {
  statSync(path: string): { mtimeMs: number };
  readFileSync(path: string, encoding: string): string;
  writeFileSync(path: string, data: string): void;
  mkdirSync(path: string, opts: { recursive: boolean }): void;
};

function nodeFs(): NodeFs | null {
  try {
    const proc = (
      globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
    ).process;
    const mod = proc?.getBuiltinModule?.("fs");
    return (mod as NodeFs | undefined) ?? null;
  } catch {
    return null;
  }
}

function emptyDB(): DemoDB {
  return {
    tenants: [],
    knowledge: [],
    chunks: [],
    leads: [],
    conversations: [],
    messages: [],
    settings: {},
    audit: [],
  };
}

// Cache with mtime invalidation so parallel dev requests don't clobber each other.
let cache: { db: DemoDB; mtimeMs: number } | null = null;
let memoryVersion = 0;

function loadDB(): DemoDB {
  const fs = nodeFs();
  if (!fs) {
    if (!cache) cache = { db: emptyDB(), mtimeMs: 0 };
    return cache.db;
  }
  try {
    const stat = fs.statSync(DB_FILE);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.db;
    const db = { ...emptyDB(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) } as DemoDB;
    cache = { db, mtimeMs: stat.mtimeMs };
    return db;
  } catch {
    if (!cache) cache = { db: emptyDB(), mtimeMs: 0 };
    return cache.db;
  }
}

function saveDB(db: DemoDB) {
  const fs = nodeFs();
  if (!fs) {
    memoryVersion += 1;
    cache = { db, mtimeMs: memoryVersion };
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  cache = { db, mtimeMs: fs.statSync(DB_FILE).mtimeMs };
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9\u0900-\u097f]+/)
    .filter((t) => t.length > 1);
}

class DemoRepo implements Repo {
  private tx<T>(fn: (db: DemoDB) => T): T {
    const db = loadDB();
    const out = fn(db);
    saveDB(db);
    return out;
  }

  async getTenant(id: string) {
    return loadDB().tenants.find((t) => t.id === id) ?? null;
  }
  async listTenants() {
    return loadDB().tenants;
  }
  async upsertTenant(t: Tenant) {
    return this.tx((db) => {
      const i = db.tenants.findIndex((x) => x.id === t.id);
      if (i >= 0) db.tenants[i] = t;
      else db.tenants.push(t);
      return t;
    });
  }
  async listKnowledge(tenantId: string) {
    return loadDB().knowledge.filter((d) => d.tenantId === tenantId);
  }
  async addKnowledge(doc: KnowledgeDoc, chunks: Omit<KnowledgeChunk, "id">[]) {
    this.tx((db) => {
      db.knowledge.push(doc);
      for (const c of chunks) db.chunks.push({ ...c, id: uid() });
    });
  }
  async updateKnowledge(doc: KnowledgeDoc, chunks: Omit<KnowledgeChunk, "id">[]) {
    this.tx((db) => {
      const i = db.knowledge.findIndex((d) => d.id === doc.id && d.tenantId === doc.tenantId);
      if (i >= 0) db.knowledge[i] = doc;
      else db.knowledge.push(doc);
      db.chunks = db.chunks.filter((c) => c.docId !== doc.id);
      for (const c of chunks) db.chunks.push({ ...c, id: uid() });
    });
  }
  async deleteKnowledge(tenantId: string, docId: string) {
    this.tx((db) => {
      db.knowledge = db.knowledge.filter((d) => !(d.id === docId && d.tenantId === tenantId));
      db.chunks = db.chunks.filter((c) => c.docId !== docId);
    });
  }
  async listChunks(tenantId: string, docId: string, limit = 100) {
    return loadDB()
      .chunks.filter((c) => c.tenantId === tenantId && c.docId === docId)
      .slice(0, limit);
  }
  async searchChunks(tenantId: string, query: string, limit = 4) {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];
    const all = loadDB().chunks.filter((c) => c.tenantId === tenantId);
    // Semantic pass when embeddings are on and the query vector is available.
    if (embeddingsConfigured()) {
      const qVec = await embedQuery(query);
      if (qVec) return rankHybrid(retrievalTokens(query), qVec, all, limit);
    }
    return all
      .map((c) => {
        const text = tokenize(c.content);
        let score = 0;
        for (const qt of qTokens) {
          if (text.includes(qt)) score += 2;
          if (c.topics.some((t) => t.includes(qt))) score += 1;
        }
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.c);
  }
  async listLeads(tenantId: string) {
    return loadDB()
      .leads.filter((l) => l.tenantId === tenantId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getLead(tenantId: string, id: string) {
    return loadDB().leads.find((l) => l.id === id && l.tenantId === tenantId) ?? null;
  }
  async upsertLead(lead: Lead) {
    return this.tx((db) => {
      const i = db.leads.findIndex(
        (l) => l.tenantId === lead.tenantId && lead.phone && l.phone === lead.phone,
      );
      if (i >= 0) {
        db.leads[i] = { ...db.leads[i], ...lead, id: db.leads[i].id };
        return db.leads[i];
      }
      const byId = db.leads.findIndex((l) => l.id === lead.id);
      if (byId >= 0) {
        db.leads[byId] = { ...db.leads[byId], ...lead };
        return db.leads[byId];
      }
      db.leads.push(lead);
      return lead;
    });
  }
  async listConversations(tenantId: string) {
    return loadDB()
      .conversations.filter((c) => c.tenantId === tenantId)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }
  async getConversation(tenantId: string, id: string) {
    return loadDB().conversations.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
  }
  async upsertConversation(c: Conversation) {
    this.tx((db) => {
      const i = db.conversations.findIndex((x) => x.id === c.id);
      if (i >= 0) db.conversations[i] = c;
      else db.conversations.push(c);
    });
  }
  async listMessages(tenantId: string, conversationId: string) {
    return loadDB()
      .messages.filter((m) => m.conversationId === conversationId && m.tenantId === tenantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async addMessage(m: Message) {
    this.tx((db) => db.messages.push(m));
  }
  async getSettings(tenantId: string): Promise<AgentSettings> {
    const s = loadDB().settings[tenantId];
    if (s) return s;
    return defaultSettings(tenantId);
  }
  async saveSettings(s: AgentSettings) {
    this.tx((db) => {
      db.settings[s.tenantId] = s;
    });
  }
  async addAudit(e: AuditEvent) {
    this.tx((db) => db.audit.unshift(e));
  }
  async listAudit(tenantId: string, limit = 200) {
    return loadDB()
      .audit.filter((a) => a.tenantId === tenantId)
      .slice(0, limit);
  }
}

export function defaultSettings(tenantId: string): AgentSettings {
  return {
    tenantId,
    tone: "Warm, concise, respectful to parents. One question at a time.",
    workingHours: "Mon-Sat 9:00-18:00 IST",
    neverAnswer: [
      "Scholarship promises or guaranteed scholarships",
      "Seat guarantees or confirmed admission",
      "Any fee not present in approved documents",
    ],
    escalationTriggers: [
      "Lead asks for a human counselor",
      "Complaint or legal threat",
      "Fee discount negotiation",
      "Message contains no valid answer after retrieval",
    ],
    hotThreshold: 70,
    warmThreshold: 40,
    sequences: [
      {
        id: "seq-hot",
        name: "Hot lead — immediate counselor",
        tier: "hot",
        enabled: true,
        steps: [
          { dayOffset: 0, message: "Thanks! A counselor will call you shortly to confirm your campus visit." },
          { dayOffset: 1, message: "Gentle reminder: your counselor tried to reach you. Reply CALL to book a slot." },
        ],
      },
      {
        id: "seq-warm",
        name: "Warm lead — nurture",
        tier: "warm",
        enabled: true,
        steps: [
          { dayOffset: 0, message: "Here are the course details you asked for. Any other questions?" },
          { dayOffset: 2, message: "Applications for this session are open. Want help with the form?" },
          { dayOffset: 5, message: "Last nudge: seats fill quickly. Reply VISIT to book a campus tour." },
        ],
      },
      {
        id: "seq-cold",
        name: "Cold lead — light touch",
        tier: "cold",
        enabled: true,
        steps: [
          { dayOffset: 3, message: "Thought you might find our prospectus useful. Reply for a copy." },
          { dayOffset: 10, message: "We would love to help when you are ready. Reply STOP to opt out." },
        ],
      },
    ],
  };
}

/* ----------------------------- supabase repo ----------------------------- */
// Used once env keys are provided. Maps 1:1 onto supabase/migrations SQL.

let supabaseRepo: Repo | null = null;

async function getSupabaseRepo(): Promise<Repo> {
  if (!supabaseRepo) {
    const { SupabaseRepo } = await import("@/lib/repo-supabase");
    supabaseRepo = new SupabaseRepo();
  }
  return supabaseRepo;
}

let d1Repo: Repo | null = null;

// Test hook: a test can install its own Repo double so the agent runs against
// isolated in-memory data. Never set outside tests — pass null to restore the
// normal resolution order.
let overrideRepo: Repo | null = null;

export function setRepoForTests(repo: Repo | null): void {
  overrideRepo = repo;
}

export async function getRepo(): Promise<Repo> {
  if (overrideRepo) return overrideRepo;
  // Cloudflare Workers / Sites: the D1 binding wins when it is present.
  if (!d1Repo) {
    const { getD1Repo } = await import("@/lib/repo-d1");
    d1Repo = await getD1Repo();
  }
  if (d1Repo) return d1Repo;
  if (supabaseConfigured) return getSupabaseRepo();
  return new DemoRepo();
}
