-- AdmitFlow Phase 0/1 schema — Supabase Postgres (+ pgvector for retrieval)
-- Tenant = Clerk Organization. Every table carries tenant_id; RLS enforces
-- isolation using the Clerk JWT template claim `org_id`.
--
-- Setup:
--   1. Run this in the Supabase SQL editor (or `supabase db push`).
--   2. In Clerk: create a JWT template named "supabase" with claims:
--        { "sub": "{{user.id}}", "org_id": "{{org.id}}", "org_role": "{{org.role}}" }
--   3. Put the keys in .env.local — the app switches from demo store to Supabase.

create extension if not exists vector;

-- ------------------------------- tenants ---------------------------------
create table if not exists tenants (
  id          text primary key,             -- Clerk org id
  name        text not null,
  type        text not null check (type in ('school','college','university')),
  affiliation text default '',
  city        text default '',
  sector      text not null check (sector in ('government','private')),
  languages   text[] not null default '{en}',
  slug        text unique,
  created_at  timestamptz not null default now()
);

create table if not exists profiles (
  user_id     text primary key,             -- Clerk user id
  tenant_id   text not null references tenants(id) on delete cascade,
  role        text not null check (role in ('owner','admin','counselor','viewer')),
  email       text default '',
  created_at  timestamptz not null default now()
);

-- ------------------------------ knowledge --------------------------------
create table if not exists knowledge_docs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null references tenants(id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('pdf','docx','xlsx','url','template')),
  status      text not null default 'processing' check (status in ('ingested','processing','failed')),
  version     int  not null default 1,
  chunk_count int  not null default 0,
  topics      text[] not null default '{}',
  updated_at  timestamptz not null default now(),
  unique (tenant_id, name, version)
);

create table if not exists knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references knowledge_docs(id) on delete cascade,
  tenant_id   text not null references tenants(id) on delete cascade,
  content     text not null,
  topics      text[] not null default '{}',
  embedding   vector(1536)                  -- filled by the ingestion worker
);

create index if not exists knowledge_chunks_tenant_idx on knowledge_chunks (tenant_id);
create index if not exists knowledge_chunks_embedding_idx on knowledge_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- -------------------------------- leads ----------------------------------
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null references tenants(id) on delete cascade,
  name            text default '',
  phone           text not null,
  email           text,
  city            text,
  course_interest text,
  source          text not null check (source in ('whatsapp','web_widget','lead_form','manual')),
  score           int  not null default 0,
  tier            text not null default 'cold' check (tier in ('hot','warm','cold')),
  status          text not null default 'new'
                  check (status in ('new','nurturing','qualified','visit_booked','applied',
                                    'not_interested','wrong_fit','opted_out')),
  language        text not null default 'en',
  opted_out       boolean not null default false,
  summary         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, phone)                -- de-duplication by phone (PRD §6)
);

create index if not exists leads_tenant_idx on leads (tenant_id, tier, score desc);

-- ---------------------------- conversations ------------------------------
create table if not exists conversations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null references tenants(id) on delete cascade,
  lead_id          uuid not null references leads(id) on delete cascade,
  channel          text not null check (channel in ('whatsapp','web_widget','lead_form','manual')),
  status           text not null default 'ai' check (status in ('ai','human','closed')),
  handoff_reason   text,
  summary          text,
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index if not exists conversations_tenant_idx on conversations (tenant_id, last_activity_at desc);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  tenant_id       text not null references tenants(id) on delete cascade,
  role            text not null check (role in ('lead','ai','counselor','system')),
  content         text not null,
  sources         text[] not null default '{}',   -- audit: which docs the answer used
  created_at      timestamptz not null default now()
);

create index if not exists messages_conv_idx on messages (conversation_id, created_at);

-- --------------------------- settings + audit ----------------------------
create table if not exists agent_settings (
  tenant_id            text primary key references tenants(id) on delete cascade,
  tone                 text not null default 'Warm, concise, respectful to parents.',
  working_hours        text not null default 'Mon-Sat 9:00-18:00 IST',
  never_answer         text[] not null default '{}',
  escalation_triggers  text[] not null default '{}',
  hot_threshold        int  not null default 70,
  warm_threshold       int  not null default 40,
  sequences            jsonb not null default '[]'
);

create table if not exists audit_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null references tenants(id) on delete cascade,
  actor           text not null check (actor in ('ai','counselor','system','lead')),
  action          text not null,
  detail          text not null default '',
  sources         text[] not null default '{}',
  conversation_id uuid references conversations(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists audit_tenant_idx on audit_events (tenant_id, created_at desc);

-- ----------------------------- RLS policies ------------------------------
alter table tenants          enable row level security;
alter table profiles         enable row level security;
alter table knowledge_docs   enable row level security;
alter table knowledge_chunks enable row level security;
alter table leads            enable row level security;
alter table conversations    enable row level security;
alter table messages         enable row level security;
alter table agent_settings   enable row level security;
alter table audit_events     enable row level security;

-- The org id comes from the Clerk JWT template claim.
create or replace function current_tenant_id() returns text
  language sql stable as $$ select coalesce(auth.jwt() ->> 'org_id', '') $$;

create policy "tenant read"   on leads            for select using (tenant_id = current_tenant_id());
create policy "tenant write"  on leads            for all    using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy "tenant read"   on conversations    for select using (tenant_id = current_tenant_id());
create policy "tenant write"  on conversations    for all    using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy "tenant read"   on messages         for select using (tenant_id = current_tenant_id());
create policy "tenant write"  on messages         for all    using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy "tenant read"   on knowledge_docs   for select using (tenant_id = current_tenant_id());
create policy "tenant write"  on knowledge_docs   for all    using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy "tenant read"   on knowledge_chunks for select using (tenant_id = current_tenant_id());
create policy "tenant write"  on knowledge_chunks for all    using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy "tenant read"   on agent_settings   for select using (tenant_id = current_tenant_id());
create policy "tenant write"  on agent_settings   for all    using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy "tenant read"   on audit_events     for select using (tenant_id = current_tenant_id());
create policy "tenant insert" on audit_events     for insert with check (tenant_id = current_tenant_id());
create policy "tenant read"   on tenants          for select using (id = current_tenant_id());
create policy "tenant update" on tenants          for update using (id = current_tenant_id()) with check (id = current_tenant_id());
create policy "tenant read"   on profiles         for select using (tenant_id = current_tenant_id());
create policy "tenant write"  on profiles         for all    using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- Cross-tenant leak test (run as an authenticated user of org A):
--   select count(*) from leads;  -- must only return org A rows
