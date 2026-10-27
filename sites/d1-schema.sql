-- AdmitFlow schema for Cloudflare D1 (SQLite) — used by Freebuff Sites.
-- The app bootstraps this schema automatically on first use (src/lib/repo-d1.ts);
-- this file is the reference copy for local `wrangler d1 execute` runs.
-- Every table carries tenant_id (the Clerk organization id): D1 has no
-- row-level security, so tenant_id filtering is the isolation boundary.

create table if not exists tenants (
  id          text primary key,          -- Clerk org id
  name        text not null,
  type        text not null,             -- school | college | university
  affiliation text not null default '',
  city        text not null default '',
  sector      text not null,             -- government | private
  languages   text not null default '["en"]',
  slug        text,
  created_at  text not null
);

create table if not exists profiles (
  user_id   text primary key,             -- Clerk user id
  tenant_id text not null,
  role      text not null,                -- owner | admin | counselor | viewer
  email     text not null default '',
  created_at text not null
);

create table if not exists knowledge_docs (
  id          text primary key,
  tenant_id   text not null,
  name        text not null,
  kind        text not null,              -- pdf | docx | xlsx | url | template
  status      text not null default 'processing',
  version     integer not null default 1,
  chunk_count integer not null default 0,
  topics      text not null default '[]',
  updated_at  text not null
);
create index if not exists knowledge_docs_tenant_idx on knowledge_docs (tenant_id, updated_at desc);

create table if not exists knowledge_chunks (
  id        text primary key,
  doc_id    text not null,
  tenant_id text not null,
  content   text not null,
  topics    text not null default '[]',
  embedding text                   -- JSON float array; set when embeddings are on
);
create index if not exists knowledge_chunks_tenant_idx on knowledge_chunks (tenant_id);

create table if not exists leads (
  id              text primary key,
  tenant_id       text not null,
  name            text not null default '',
  phone           text not null,
  email           text,
  city            text,
  course_interest text,
  source          text not null,          -- whatsapp | web_widget | lead_form | manual
  score           integer not null default 0,
  tier            text not null default 'cold',
  status          text not null default 'new',
  language        text not null default 'en',
  opted_out       integer not null default 0,
  summary         text,
  created_at      text not null,
  updated_at      text not null
);
create unique index if not exists leads_tenant_phone_idx on leads (tenant_id, phone);
create index if not exists leads_tenant_idx on leads (tenant_id, tier, score desc);

create table if not exists conversations (
  id               text primary key,
  tenant_id        text not null,
  lead_id          text not null,
  channel          text not null,
  status           text not null default 'ai',
  handoff_reason   text,
  summary          text,
  last_activity_at text not null,
  created_at       text not null
);
create index if not exists conversations_tenant_idx on conversations (tenant_id, last_activity_at desc);

create table if not exists messages (
  id              text primary key,
  conversation_id text not null,
  tenant_id       text not null,
  role            text not null,           -- lead | ai | counselor | system
  content         text not null,
  sources         text not null default '[]',
  created_at      text not null
);
create index if not exists messages_conv_idx on messages (conversation_id, created_at);

create table if not exists agent_settings (
  tenant_id           text primary key,
  tone                text not null,
  working_hours       text not null,
  never_answer        text not null default '[]',
  escalation_triggers text not null default '[]',
  hot_threshold       integer not null default 70,
  warm_threshold      integer not null default 40,
  sequences           text not null default '[]'
);

create table if not exists audit_events (
  id              text primary key,
  tenant_id       text not null,
  actor           text not null,           -- ai | counselor | system | lead
  action          text not null,
  detail          text not null default '',
  sources         text not null default '[]',
  conversation_id text,
  created_at      text not null
);
create index if not exists audit_tenant_idx on audit_events (tenant_id, created_at desc);
