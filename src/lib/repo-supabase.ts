// Supabase-backed repository. Active only when env keys are configured.
// Tables come from supabase/migrations/0001_init.sql; all queries are
// filtered by tenant_id, and RLS adds a second enforcement layer.
import { createClient } from "@supabase/supabase-js";
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

function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-side only
    { auth: { persistSession: false } },
  );
}

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

export class SupabaseRepo implements Repo {
  private sb = client();

  async getTenant(id: string): Promise<Tenant | null> {
    const { data } = await this.sb.from("tenants").select("*").eq("id", id).maybeSingle();
    return (data as Tenant) ?? null;
  }

  async upsertTenant(t: Tenant): Promise<Tenant> {
    const { data, error } = await this.sb.from("tenants").upsert(t).select("*").single();
    if (error) throw error;
    return data as Tenant;
  }

  async listKnowledge(tenantId: string): Promise<KnowledgeDoc[]> {
    const { data } = await this.sb
      .from("knowledge_docs")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });
    return (data ?? []) as unknown as KnowledgeDoc[];
  }

  async addKnowledge(doc: KnowledgeDoc, chunks: Omit<KnowledgeChunk, "id">[]): Promise<void> {
    const { error } = await this.sb.from("knowledge_docs").insert({
      id: doc.id,
      tenant_id: doc.tenantId,
      name: doc.name,
      kind: doc.kind,
      status: doc.status,
      version: doc.version,
      updated_at: doc.updatedAt,
      chunk_count: doc.chunkCount,
      topics: doc.topics,
    });
    if (error) throw error;
    if (chunks.length) {
      const { error: ce } = await this.sb.from("knowledge_chunks").insert(
        chunks.map((c) => ({
          id: uid(),
          doc_id: c.docId,
          tenant_id: c.tenantId,
          content: c.content,
          topics: c.topics,
        })),
      );
      if (ce) throw ce;
    }
  }

  async updateKnowledge(doc: KnowledgeDoc, chunks: Omit<KnowledgeChunk, "id">[]): Promise<void> {
    const { error } = await this.sb
      .from("knowledge_docs")
      .update({
        status: doc.status,
        chunk_count: doc.chunkCount,
        topics: doc.topics,
        updated_at: doc.updatedAt,
      })
      .eq("id", doc.id)
      .eq("tenant_id", doc.tenantId);
    if (error) throw error;
    await this.sb
      .from("knowledge_chunks")
      .delete()
      .eq("doc_id", doc.id)
      .eq("tenant_id", doc.tenantId);
    if (chunks.length) {
      const { error: ce } = await this.sb.from("knowledge_chunks").insert(
        chunks.map((c) => ({
          id: uid(),
          doc_id: c.docId,
          tenant_id: c.tenantId,
          content: c.content,
          topics: c.topics,
        })),
      );
      if (ce) throw ce;
    }
  }

  async deleteKnowledge(tenantId: string, docId: string): Promise<void> {
    await this.sb.from("knowledge_chunks").delete().eq("doc_id", docId).eq("tenant_id", tenantId);
    await this.sb.from("knowledge_docs").delete().eq("id", docId).eq("tenant_id", tenantId);
  }

  async searchChunks(tenantId: string, query: string, limit = 4): Promise<KnowledgeChunk[]> {
    const terms = tokenize(query).slice(0, 8);
    if (!terms.length) return [];
    const or = terms.map((t) => `content.ilike.%${t}%`).join(",");
    const { data } = await this.sb
      .from("knowledge_chunks")
      .select("id, doc_id, tenant_id, content, topics")
      .eq("tenant_id", tenantId)
      .or(or)
      .limit(40);
    const rows = (data ?? []) as { id: string; doc_id: string; tenant_id: string; content: string; topics: string[] }[];
    return rows
      .map((r) => {
        const text = new Set(tokenize(r.content));
        const score = terms.reduce((acc, t) => acc + (text.has(t) ? 2 : 0), 0);
        return {
          id: r.id,
          docId: r.doc_id,
          tenantId: r.tenant_id,
          content: r.content,
          topics: r.topics ?? [],
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
      id: r.id as string,
      tenantId: r.tenant_id as string,
      name: (r.name as string) ?? "",
      phone: r.phone as string,
      email: r.email as string | undefined,
      city: r.city as string | undefined,
      courseInterest: r.course_interest as string | undefined,
      source: r.source as Lead["source"],
      score: (r.score as number) ?? 0,
      tier: (r.tier as Lead["tier"]) ?? "cold",
      status: r.status as Lead["status"],
      language: (r.language as string) ?? "en",
      optedOut: Boolean(r.opted_out),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      summary: r.summary as string | undefined,
    };
  }

  async listLeads(tenantId: string): Promise<Lead[]> {
    const { data } = await this.sb
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });
    return (data ?? []).map((r) => this.mapLead(r as Record<string, unknown>));
  }

  async getLead(tenantId: string, id: string): Promise<Lead | null> {
    const { data } = await this.sb
      .from("leads")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return data ? this.mapLead(data as Record<string, unknown>) : null;
  }

  async upsertLead(lead: Lead): Promise<Lead> {
    const { data, error } = await this.sb
      .from("leads")
      .upsert(
        {
          tenant_id: lead.tenantId,
          phone: lead.phone,
          name: lead.name,
          email: lead.email ?? null,
          city: lead.city ?? null,
          course_interest: lead.courseInterest ?? null,
          source: lead.source,
          score: lead.score,
          tier: lead.tier,
          status: lead.status,
          language: lead.language,
          opted_out: lead.optedOut,
          updated_at: lead.updatedAt,
          summary: lead.summary ?? null,
        },
        { onConflict: "tenant_id,phone" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return this.mapLead(data as Record<string, unknown>);
  }

  private mapConv(r: Record<string, unknown>): Conversation {
    return {
      id: r.id as string,
      tenantId: r.tenant_id as string,
      leadId: r.lead_id as string,
      channel: r.channel as Conversation["channel"],
      status: r.status as Conversation["status"],
      handoffReason: r.handoff_reason as string | undefined,
      summary: r.summary as string | undefined,
      lastActivityAt: r.last_activity_at as string,
      createdAt: r.created_at as string,
    };
  }

  async listConversations(tenantId: string): Promise<Conversation[]> {
    const { data } = await this.sb
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("last_activity_at", { ascending: false });
    return (data ?? []).map((r) => this.mapConv(r as Record<string, unknown>));
  }

  async getConversation(tenantId: string, id: string): Promise<Conversation | null> {
    const { data } = await this.sb
      .from("conversations")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return data ? this.mapConv(data as Record<string, unknown>) : null;
  }

  async upsertConversation(c: Conversation): Promise<void> {
    const { error } = await this.sb.from("conversations").upsert(
      {
        id: c.id,
        tenant_id: c.tenantId,
        lead_id: c.leadId,
        channel: c.channel,
        status: c.status,
        handoff_reason: c.handoffReason ?? null,
        summary: c.summary ?? null,
        last_activity_at: c.lastActivityAt,
        created_at: c.createdAt,
      },
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  async listMessages(tenantId: string, conversationId: string): Promise<Message[]> {
    const { data } = await this.sb
      .from("messages")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    return (data ?? []).map((r) => ({
      id: r.id as string,
      conversationId: r.conversation_id as string,
      tenantId: r.tenant_id as string,
      role: r.role as Message["role"],
      content: r.content as string,
      sources: (r.sources as string[]) ?? [],
      createdAt: r.created_at as string,
    }));
  }

  async addMessage(m: Message): Promise<void> {
    const { error } = await this.sb.from("messages").insert({
      id: m.id,
      conversation_id: m.conversationId,
      tenant_id: m.tenantId,
      role: m.role,
      content: m.content,
      sources: m.sources,
      created_at: m.createdAt,
    });
    if (error) throw error;
  }

  async getSettings(tenantId: string): Promise<AgentSettings> {
    const { data } = await this.sb
      .from("agent_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!data) return defaultSettings(tenantId);
    return {
      tenantId,
      tone: data.tone,
      workingHours: data.working_hours,
      neverAnswer: data.never_answer ?? [],
      escalationTriggers: data.escalation_triggers ?? [],
      hotThreshold: data.hot_threshold,
      warmThreshold: data.warm_threshold,
      sequences: data.sequences ?? [],
    };
  }

  async saveSettings(s: AgentSettings): Promise<void> {
    const { error } = await this.sb.from("agent_settings").upsert(
      {
        tenant_id: s.tenantId,
        tone: s.tone,
        working_hours: s.workingHours,
        never_answer: s.neverAnswer,
        escalation_triggers: s.escalationTriggers,
        hot_threshold: s.hotThreshold,
        warm_threshold: s.warmThreshold,
        sequences: s.sequences,
      },
      { onConflict: "tenant_id" },
    );
    if (error) throw error;
  }

  async addAudit(e: AuditEvent): Promise<void> {
    const { error } = await this.sb.from("audit_events").insert({
      id: e.id,
      tenant_id: e.tenantId,
      actor: e.actor,
      action: e.action,
      detail: e.detail,
      sources: e.sources,
      conversation_id: e.conversationId ?? null,
      created_at: e.createdAt,
    });
    if (error) throw error;
  }

  async listAudit(tenantId: string, limit = 200): Promise<AuditEvent[]> {
    const { data } = await this.sb
      .from("audit_events")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      tenantId: r.tenant_id as string,
      actor: r.actor as AuditEvent["actor"],
      action: r.action as string,
      detail: r.detail as string,
      sources: (r.sources as string[]) ?? [],
      conversationId: r.conversation_id as string | undefined,
      createdAt: r.created_at as string,
    }));
  }
}
