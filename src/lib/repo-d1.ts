// D1-backed repository (Cloudflare Workers). Mirrors the Supabase schema in
// SQLite dialect — see sites/d1-schema.sql. D1 has no row-level security,
// so tenant_id filtering in every statement is the isolation boundary.
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
import { defaultSettings, uid, type Repo } from "@/lib/repo";
import { embeddingsConfigured, embedQuery } from "@/lib/embed";
import { rankHybrid, retrievalTokens } from "@/lib/retrieval";

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
  batch(stmts: D1Statement[]): Promise<unknown>;
}

const SCHEMA: string[] = [
  `create table if not exists tenants (
     id text primary key,
     name text not null,
     type text not null,
     affiliation text not null default '',
     city text not null default '',
     sector text not null,
     languages text not null default '["en"]',
     slug text,
     created_at text not null
   )`,
  `create table if not exists profiles (
     user_id text primary key,
     tenant_id text not null,
     role text not null,
     email text not null default '',
     created_at text not null
   )`,
  `create table if not exists knowledge_docs (
     id text primary key,
     tenant_id text not null,
     name text not null,
     kind text not null,
     status text not null default 'processing',
     version integer not null default 1,
     chunk_count integer not null default 0,
     topics text not null default '[]',
     updated_at text not null
   )`,
  `create index if not exists knowledge_docs_tenant_idx on knowledge_docs (tenant_id, updated_at desc)`,
  `create table if not exists knowledge_chunks (
     id text primary key,
     doc_id text not null,
     tenant_id text not null,
     content text not null,
     topics text not null default '[]',
     embedding text
   )`,
  `create index if not exists knowledge_chunks_tenant_idx on knowledge_chunks (tenant_id)`,
  `create table if not exists leads (
     id text primary key,
     tenant_id text not null,
     name text not null default '',
     phone text not null,
     email text,
     city text,
     course_interest text,
     source text not null,
     score integer not null default 0,
     tier text not null default 'cold',
     status text not null default 'new',
     language text not null default 'en',
     opted_out integer not null default 0,
     summary text,
     created_at text not null,
     updated_at text not null
   )`,
  `create unique index if not exists leads_tenant_phone_idx on leads (tenant_id, phone)`,
  `create index if not exists leads_tenant_idx on leads (tenant_id, tier, score desc)`,
  `create table if not exists conversations (
     id text primary key,
     tenant_id text not null,
     lead_id text not null,
     channel text not null,
     status text not null default 'ai',
     handoff_reason text,
     summary text,
     last_activity_at text not null,
     created_at text not null
   )`,
  `create index if not exists conversations_tenant_idx on conversations (tenant_id, last_activity_at desc)`,
  `create table if not exists messages (
     id text primary key,
     conversation_id text not null,
     tenant_id text not null,
     role text not null,
     content text not null,
     sources text not null default '[]',
     created_at text not null
   )`,
  `create index if not exists messages_conv_idx on messages (conversation_id, created_at)`,
  `create table if not exists agent_settings (
     tenant_id text primary key,
     tone text not null,
     working_hours text not null,
     never_answer text not null default '[]',
     escalation_triggers text not null default '[]',
     hot_threshold integer not null default 70,
     warm_threshold integer not null default 40,
     sequences text not null default '[]'
   )`,
  `create table if not exists audit_events (
     id text primary key,
     tenant_id text not null,
     actor text not null,
     action text not null,
     detail text not null default '',
     sources text not null default '[]',
     conversation_id text,
     created_at text not null
   )`,
  `create index if not exists audit_tenant_idx on audit_events (tenant_id, created_at desc)`,
];

const stop = new Set([
  "the", "and", "for", "you", "your", "are", "with", "this", "that", "what",
  "when", "how", "much", "many", "have", "has", "can", "not", "any", "who",
  "why", "from", "into", "was", "were", "will", "would", "there", "their",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9\u0900-\u097f]+/)
    .filter((t) => t.length > 1 && !stop.has(t));
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function fromJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

export class D1Repo implements Repo {
  constructor(private db: D1Database) {}

  private mapTenant(r: Record<string, unknown>): Tenant {
    return {
      id: str(r.id),
      name: str(r.name),
      type: str(r.type) as Tenant["type"],
      affiliation: str(r.affiliation),
      city: str(r.city),
      sector: str(r.sector) as Tenant["sector"],
      languages: fromJson<string[]>(r.languages, ["en"]),
      slug: str(r.slug),
      createdAt: str(r.created_at),
    };
  }

  async getTenant(id: string): Promise<Tenant | null> {
    const row = await this.db.prepare("select * from tenants where id = ?").bind(id).first();
    return row ? this.mapTenant(row) : null;
  }

  async listTenants(): Promise<Tenant[]> {
    const rs = await this.db.prepare("select * from tenants").all();
    return (rs.results as Record<string, unknown>[]).map((row) => this.mapTenant(row));
  }

  async upsertTenant(t: Tenant): Promise<Tenant> {
    await this.db
      .prepare(
        `insert into tenants (id, name, type, affiliation, city, sector, languages, slug, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           name = excluded.name, type = excluded.type, affiliation = excluded.affiliation,
           city = excluded.city, sector = excluded.sector, languages = excluded.languages,
           slug = excluded.slug`,
      )
      .bind(
        t.id,
        t.name,
        t.type,
        t.affiliation ?? "",
        t.city ?? "",
        t.sector,
        toJson(t.languages ?? ["en"]),
        t.slug ?? null,
        t.createdAt,
      )
      .run();
    return t;
  }

  async listKnowledge(tenantId: string): Promise<KnowledgeDoc[]> {
    const { results } = await this.db
      .prepare("select * from knowledge_docs where tenant_id = ? order by updated_at desc")
      .bind(tenantId)
      .all();
    return results.map((r) => ({
      id: str(r.id),
      tenantId: str(r.tenant_id),
      name: str(r.name),
      kind: str(r.kind) as KnowledgeDoc["kind"],
      status: str(r.status) as KnowledgeDoc["status"],
      version: num(r.version),
      updatedAt: str(r.updated_at),
      chunkCount: num(r.chunk_count),
      topics: fromJson<string[]>(r.topics, []),
    }));
  }

  async addKnowledge(doc: KnowledgeDoc, chunks: Omit<KnowledgeChunk, "id">[]): Promise<void> {
    const stmts = [
      this.db
        .prepare(
          `insert into knowledge_docs (id, tenant_id, name, kind, status, version, chunk_count, topics, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          doc.id,
          doc.tenantId,
          doc.name,
          doc.kind,
          doc.status,
          doc.version,
          doc.chunkCount,
          toJson(doc.topics ?? []),
          doc.updatedAt,
        ),
      ...chunks.map((c) =>
        this.db
          .prepare(
            "insert into knowledge_chunks (id, doc_id, tenant_id, content, topics, embedding) values (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            uid(),
            c.docId,
            c.tenantId,
            c.content,
            toJson(c.topics ?? []),
            c.embedding?.length ? JSON.stringify(c.embedding) : null,
          ),
      ),
    ];
    await this.db.batch(stmts);
  }

  async updateKnowledge(doc: KnowledgeDoc, chunks: Omit<KnowledgeChunk, "id">[]): Promise<void> {
    const stmts = [
      this.db
        .prepare(
          `update knowledge_docs set status = ?, chunk_count = ?, topics = ?, updated_at = ?
           where id = ? and tenant_id = ?`,
        )
        .bind(doc.status, doc.chunkCount, toJson(doc.topics ?? []), doc.updatedAt, doc.id, doc.tenantId),
      this.db
        .prepare("delete from knowledge_chunks where doc_id = ? and tenant_id = ?")
        .bind(doc.id, doc.tenantId),
      ...chunks.map((c) =>
        this.db
          .prepare(
            "insert into knowledge_chunks (id, doc_id, tenant_id, content, topics, embedding) values (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            uid(),
            c.docId,
            c.tenantId,
            c.content,
            toJson(c.topics ?? []),
            c.embedding?.length ? JSON.stringify(c.embedding) : null,
          ),
      ),
    ];
    await this.db.batch(stmts);
  }

  async deleteKnowledge(tenantId: string, docId: string): Promise<void> {
    await this.db.batch([
      this.db
        .prepare("delete from knowledge_chunks where doc_id = ? and tenant_id = ?")
        .bind(docId, tenantId),
      this.db
        .prepare("delete from knowledge_docs where id = ? and tenant_id = ?")
        .bind(docId, tenantId),
    ]);
  }

  async listChunks(tenantId: string, docId: string, limit = 100): Promise<KnowledgeChunk[]> {
    const { results } = await this.db
      .prepare(
        `select id, doc_id, tenant_id, content, topics from knowledge_chunks
         where tenant_id = ? and doc_id = ? order by rowid limit ?`,
      )
      .bind(tenantId, docId, limit)
      .all();
    return (results as Record<string, unknown>[]).map((r) => ({
      id: str(r.id),
      docId: str(r.doc_id),
      tenantId: str(r.tenant_id),
      content: str(r.content),
      topics: fromJson<string[]>(r.topics, []),
    }));
  }

  async searchChunks(tenantId: string, query: string, limit = 4): Promise<KnowledgeChunk[]> {
    const terms = tokenize(query).slice(0, 8);
    if (!terms.length) return [];

    // Semantic pass: vectors + keyword blended in JS (see lib/retrieval).
    if (embeddingsConfigured()) {
      const qVec = await embedQuery(query);
      if (qVec) {
        const { results } = await this.db
          .prepare(
            `select id, doc_id, tenant_id, content, topics, embedding
             from knowledge_chunks where tenant_id = ? limit 800`,
          )
          .bind(tenantId)
          .all();
        const candidates = (results as Record<string, unknown>[]).map((r) => {
          const embedding = fromJson<number[]>(r.embedding, []);
          return {
            id: str(r.id),
            docId: str(r.doc_id),
            tenantId: str(r.tenant_id),
            content: str(r.content),
            topics: fromJson<string[]>(r.topics, []),
            embedding: embedding.length ? embedding : null,
          };
        });
        return rankHybrid(retrievalTokens(query), qVec, candidates, limit);
      }
    }

    const where = terms.map(() => "content like ?").join(" or ");
    const { results } = await this.db
      .prepare(
        `select id, doc_id, tenant_id, content, topics from knowledge_chunks
         where tenant_id = ? and (${where}) limit 60`,
      )
      .bind(tenantId, ...terms.map((t) => `%${t}%`))
      .all();
    return (results as Record<string, unknown>[])
      .map((r) => {
        const content = str(r.content);
        const text = new Set(tokenize(content));
        const score = terms.reduce((acc, t) => acc + (text.has(t) ? 2 : 0), 0);
        return {
          id: str(r.id),
          docId: str(r.doc_id),
          tenantId: str(r.tenant_id),
          content,
          topics: fromJson<string[]>(r.topics, []),
          score,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score: _score, ...chunk }) => chunk);
  }

  private mapLead(r: Record<string, unknown>): Lead {
    return {
      id: str(r.id),
      tenantId: str(r.tenant_id),
      name: str(r.name),
      phone: str(r.phone),
      email: r.email == null ? undefined : str(r.email),
      city: r.city == null ? undefined : str(r.city),
      courseInterest: r.course_interest == null ? undefined : str(r.course_interest),
      source: str(r.source) as Lead["source"],
      score: num(r.score),
      tier: str(r.tier) as Lead["tier"],
      status: str(r.status) as Lead["status"],
      language: str(r.language) || "en",
      optedOut: num(r.opted_out) === 1,
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
      summary: r.summary == null ? undefined : str(r.summary),
    };
  }

  async listLeads(tenantId: string): Promise<Lead[]> {
    const { results } = await this.db
      .prepare("select * from leads where tenant_id = ? order by updated_at desc")
      .bind(tenantId)
      .all();
    return results.map((r) => this.mapLead(r));
  }

  async getLead(tenantId: string, id: string): Promise<Lead | null> {
    const row = await this.db
      .prepare("select * from leads where id = ? and tenant_id = ?")
      .bind(id, tenantId)
      .first();
    return row ? this.mapLead(row) : null;
  }

  async upsertLead(lead: Lead): Promise<Lead> {
    // De-duplicate by phone within the tenant (PRD §6).
    const existing = await this.db
      .prepare("select id, created_at from leads where tenant_id = ? and phone = ?")
      .bind(lead.tenantId, lead.phone)
      .first();

    if (existing) {
      const id = str(existing.id);
      await this.db
        .prepare(
          `update leads set
             name = ?, email = ?, city = ?, course_interest = ?, source = ?, score = ?,
             tier = ?, status = ?, language = ?, opted_out = ?, summary = ?, updated_at = ?
           where id = ? and tenant_id = ?`,
        )
        .bind(
          lead.name,
          lead.email ?? null,
          lead.city ?? null,
          lead.courseInterest ?? null,
          lead.source,
          lead.score,
          lead.tier,
          lead.status,
          lead.language,
          lead.optedOut ? 1 : 0,
          lead.summary ?? null,
          lead.updatedAt,
          id,
          lead.tenantId,
        )
        .run();
      return { ...lead, id, createdAt: str(existing.created_at) };
    }

    await this.db
      .prepare(
        `insert into leads
           (id, tenant_id, name, phone, email, city, course_interest, source, score, tier,
            status, language, opted_out, summary, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        lead.id,
        lead.tenantId,
        lead.name,
        lead.phone,
        lead.email ?? null,
        lead.city ?? null,
        lead.courseInterest ?? null,
        lead.source,
        lead.score,
        lead.tier,
        lead.status,
        lead.language,
        lead.optedOut ? 1 : 0,
        lead.summary ?? null,
        lead.createdAt,
        lead.updatedAt,
      )
      .run();
    return lead;
  }

  private mapConv(r: Record<string, unknown>): Conversation {
    return {
      id: str(r.id),
      tenantId: str(r.tenant_id),
      leadId: str(r.lead_id),
      channel: str(r.channel) as Conversation["channel"],
      status: str(r.status) as Conversation["status"],
      handoffReason: r.handoff_reason == null ? undefined : str(r.handoff_reason),
      summary: r.summary == null ? undefined : str(r.summary),
      lastActivityAt: str(r.last_activity_at),
      createdAt: str(r.created_at),
    };
  }

  async listConversations(tenantId: string): Promise<Conversation[]> {
    const { results } = await this.db
      .prepare("select * from conversations where tenant_id = ? order by last_activity_at desc")
      .bind(tenantId)
      .all();
    return results.map((r) => this.mapConv(r));
  }

  async getConversation(tenantId: string, id: string): Promise<Conversation | null> {
    const row = await this.db
      .prepare("select * from conversations where id = ? and tenant_id = ?")
      .bind(id, tenantId)
      .first();
    return row ? this.mapConv(row) : null;
  }

  async upsertConversation(c: Conversation): Promise<void> {
    await this.db
      .prepare(
        `insert into conversations
           (id, tenant_id, lead_id, channel, status, handoff_reason, summary, last_activity_at, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           lead_id = excluded.lead_id, channel = excluded.channel, status = excluded.status,
           handoff_reason = excluded.handoff_reason, summary = excluded.summary,
           last_activity_at = excluded.last_activity_at`,
      )
      .bind(
        c.id,
        c.tenantId,
        c.leadId,
        c.channel,
        c.status,
        c.handoffReason ?? null,
        c.summary ?? null,
        c.lastActivityAt,
        c.createdAt,
      )
      .run();
  }

  async listMessages(tenantId: string, conversationId: string): Promise<Message[]> {
    const { results } = await this.db
      .prepare(
        "select * from messages where tenant_id = ? and conversation_id = ? order by created_at asc",
      )
      .bind(tenantId, conversationId)
      .all();
    return results.map((r) => ({
      id: str(r.id),
      conversationId: str(r.conversation_id),
      tenantId: str(r.tenant_id),
      role: str(r.role) as Message["role"],
      content: str(r.content),
      sources: fromJson<string[]>(r.sources, []),
      createdAt: str(r.created_at),
    }));
  }

  async addMessage(m: Message): Promise<void> {
    await this.db
      .prepare(
        `insert into messages (id, conversation_id, tenant_id, role, content, sources, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(m.id, m.conversationId, m.tenantId, m.role, m.content, toJson(m.sources ?? []), m.createdAt)
      .run();
  }

  async getSettings(tenantId: string): Promise<AgentSettings> {
    const row = await this.db
      .prepare("select * from agent_settings where tenant_id = ?")
      .bind(tenantId)
      .first();
    if (!row) return defaultSettings(tenantId);
    return {
      tenantId,
      tone: str(row.tone),
      workingHours: str(row.working_hours),
      neverAnswer: fromJson<string[]>(row.never_answer, []),
      escalationTriggers: fromJson<string[]>(row.escalation_triggers, []),
      hotThreshold: num(row.hot_threshold),
      warmThreshold: num(row.warm_threshold),
      sequences: fromJson<AgentSettings["sequences"]>(row.sequences, []),
    };
  }

  async saveSettings(s: AgentSettings): Promise<void> {
    await this.db
      .prepare(
        `insert into agent_settings
           (tenant_id, tone, working_hours, never_answer, escalation_triggers, hot_threshold, warm_threshold, sequences)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(tenant_id) do update set
           tone = excluded.tone, working_hours = excluded.working_hours,
           never_answer = excluded.never_answer, escalation_triggers = excluded.escalation_triggers,
           hot_threshold = excluded.hot_threshold, warm_threshold = excluded.warm_threshold,
           sequences = excluded.sequences`,
      )
      .bind(
        s.tenantId,
        s.tone,
        s.workingHours,
        toJson(s.neverAnswer ?? []),
        toJson(s.escalationTriggers ?? []),
        s.hotThreshold,
        s.warmThreshold,
        toJson(s.sequences ?? []),
      )
      .run();
  }

  async addAudit(e: AuditEvent): Promise<void> {
    await this.db
      .prepare(
        `insert into audit_events
           (id, tenant_id, actor, action, detail, sources, conversation_id, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        e.id,
        e.tenantId,
        e.actor,
        e.action,
        e.detail ?? "",
        toJson(e.sources ?? []),
        e.conversationId ?? null,
        e.createdAt,
      )
      .run();
  }

  async listAudit(tenantId: string, limit = 200): Promise<AuditEvent[]> {
    const { results } = await this.db
      .prepare("select * from audit_events where tenant_id = ? order by created_at desc limit ?")
      .bind(tenantId, limit)
      .all();
    return results.map((r) => ({
      id: str(r.id),
      tenantId: str(r.tenant_id),
      actor: str(r.actor) as AuditEvent["actor"],
      action: str(r.action),
      detail: str(r.detail),
      sources: fromJson<string[]>(r.sources, []),
      conversationId: r.conversation_id == null ? undefined : str(r.conversation_id),
      createdAt: str(r.created_at),
    }));
  }
}

/* --------------------------- binding + schema --------------------------- */

let schemaReady: Promise<void> | null = null;

async function ensureSchema(db: D1Database): Promise<void> {
  schemaReady ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).then(
    async () => {
      // v2: embeddings column for databases created before semantic search.
      // Fresh databases get it from CREATE TABLE; existing ones raise
      // "duplicate column" here on every boot — harmless, ignored.
      try {
        await db.prepare("alter table knowledge_chunks add column embedding text").run();
      } catch {
        /* already migrated */
      }
    },
    (err) => {
      schemaReady = null;
      throw err;
    },
  );
  return schemaReady;
}

/** Reads the DB binding from the Cloudflare context (set by the Worker, or by
 *  initOpenNextCloudflareForDev during `next dev`). Null when unavailable. */
async function getD1Binding(): Promise<D1Database | null> {
  const read = (ctx: unknown): D1Database | null => {
    const env = (ctx as { env?: Record<string, unknown> } | undefined)?.env;
    const db = env?.DB;
    return db ? (db as D1Database) : null;
  };
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare/cloudflare-context");
    return read(getCloudflareContext());
  } catch {
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare/cloudflare-context");
      return read(await getCloudflareContext({ async: true }));
    } catch {
      return null;
    }
  }
}

/** Returns a D1-backed repo, or null when no DB binding is configured. */
export async function getD1Repo(): Promise<Repo | null> {
  const db = await getD1Binding();
  if (!db) return null;
  await ensureSchema(db);
  return new D1Repo(db);
}
