// Domain types shared across the app (PRD §6, §7)

export type Role = "owner" | "admin" | "counselor" | "viewer";

export type InstitutionType = "school" | "college" | "university";

export interface Tenant {
  id: string; // == Clerk organization id
  name: string;
  type: InstitutionType;
  affiliation: string; // board / university affiliation
  city: string;
  sector: "government" | "private";
  languages: string[]; // e.g. ["en", "hi", "hinglish"]
  slug: string;
  createdAt: string;
}

export interface KnowledgeDoc {
  id: string;
  tenantId: string;
  name: string;
  kind: "pdf" | "docx" | "xlsx" | "url" | "template";
  status: "ingested" | "processing" | "failed";
  version: number;
  updatedAt: string;
  chunkCount: number;
  topics: string[]; // detected topic tags e.g. ["fees", "eligibility"]
}

export interface KnowledgeChunk {
  id: string;
  docId: string;
  tenantId: string;
  content: string;
  topics: string[];
  /** Optional semantic vector — present when embeddings are configured. */
  embedding?: number[] | null;
}

export interface Lead {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  email?: string;
  city?: string;
  courseInterest?: string;
  source: "whatsapp" | "web_widget" | "lead_form" | "manual";
  score: number; // 0-100
  tier: "hot" | "warm" | "cold";
  status:
    | "new"
    | "nurturing"
    | "qualified"
    | "visit_booked"
    | "applied"
    | "not_interested"
    | "wrong_fit"
    | "opted_out";
  language: string;
  optedOut: boolean;
  createdAt: string;
  updatedAt: string;
  summary?: string;
}

export type MessageRole = "lead" | "ai" | "counselor" | "system";

export interface Message {
  id: string;
  conversationId: string;
  tenantId: string;
  role: MessageRole;
  content: string;
  sources: string[]; // knowledge doc names used for AI answers
  createdAt: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  leadId: string;
  channel: Lead["source"];
  status: "ai" | "human" | "closed";
  handoffReason?: string;
  summary?: string;
  lastActivityAt: string;
  createdAt: string;
}

export interface AgentSettings {
  tenantId: string;
  tone: string;
  workingHours: string; // e.g. "Mon-Sat 9:00-18:00 IST"
  neverAnswer: string[]; // topics the AI must never answer
  escalationTriggers: string[];
  hotThreshold: number; // score >= this => hot
  warmThreshold: number;
  sequences: NurtureSequence[];
}

export interface NurtureSequence {
  id: string;
  name: string;
  tier: "hot" | "warm" | "cold";
  enabled: boolean;
  steps: { dayOffset: number; message: string }[];
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  actor: "ai" | "counselor" | "system" | "lead";
  action: string;
  detail: string;
  sources: string[];
  conversationId?: string;
  createdAt: string;
}

export interface FunnelStats {
  leads: number;
  responded5MinPct: number;
  medianResponseSec: number;
  qualifiedPct: number;
  visitsBooked: number;
  applicationsStarted: number;
}

export interface Session {
  userId: string;
  orgId: string;
  orgName: string;
  role: Role;
  email: string;
}
