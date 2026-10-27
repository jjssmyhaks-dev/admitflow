# AdmitFlow

An AI admissions agent for schools and colleges. It answers lead inquiries from the
institution's **own** documents (never invented), captures and scores the lead one
question at a time, hands hot leads to a counselor, then runs multi-touch nurture
follow-ups until the parent applies.

Two agents run on one shared knowledge base:

| Agent | What it does |
| --- | --- |
| **Inquiry & Lead Capture** | Grounded answers from ingested knowledge, slot-filling (name → phone → course → city), language detection (en / hi / hinglish), scoring into hot / warm / cold, never-answer guardrails, instant counselor handoff, `STOP` opt-out. |
| **Counseling & Nurture** | Per-tier sequences with day offsets, computed daily, sent over the WhatsApp Business Cloud API (session message inside the 24-hour window, approved template outside it). |

Plus a counselor console: dashboard, inbox, leads, knowledge library, agent rules,
nurture queue and a full audit log (every AI answer records the sources it used).

Built with **Next.js 16 (App Router) + React 19 + TypeScript (strict) + Tailwind v4**,
auth by **Clerk**, deployed to **Cloudflare Workers** through OpenNext.

---

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in the keys you have
npm run dev                    # http://localhost:<port printed by Next>
```

`.env.local` is optional. With no keys the app runs in **demo mode**: seeded
tenants, leads and knowledge, a cookie-based console login, and the JSON data
store. Add keys to turn on the matching capability — nothing else changes.

Key groups (full list in [.env.example](.env.example)):

| Group | Variables | Without them |
| --- | --- | --- |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Demo cookie sign-in (`/console`) |
| Database | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Demo JSON store (or D1 on Workers) |
| LLM | `LLM_API_KEY`, `LLM_MODEL` | Deterministic grounded template engine (still cites sources) |
| OCR | `OCR_API_KEY`, `OCR_API_URL`, `OCR_MODEL` | Unextractable documents end as `failed` instead of being retried |
| WhatsApp (out) | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` | Follow-ups are recorded in the audit log, not sent |
| WhatsApp (in) | `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Inbound webhook answers 503 — no default secret |
| Webhooks / scheduler | `LEAD_WEBHOOK_SECRET`, `CRON_SECRET`, `OCR_RUN_SECRET` | Those endpoints refuse requests (there is no default secret anymore) |
| LLM embeddings | `EMBED_MODEL`, `LLM_BASE_URL` (alongside `LLM_API_KEY`) | Keyword-only retrieval — behaviour identical to before |
| Hot-lead alerts | `KNOCK_API_KEY`, `KNOCK_WORKFLOW_KEY`, `ALERT_RECIPIENT_IDS` | Alerts are recorded in the audit log only |
| Plan caps | `KNOWLEDGE_DOC_LIMIT`, `LEAD_LIMIT` | Defaults: 100 documents, 10 000 leads per tenant |
| Analytics | `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST` | Analytics stay off |

Local development uses the OpenNext/wrangler proxy
(`initOpenNextCloudflareForDev` in [next.config.ts](next.config.ts)) so `next dev`
gets the same **D1** and **R2** bindings as production — see
[freebuff.wrangler.jsonc](freebuff.wrangler.jsonc).

---

## The three data backends

Every read and write goes through one interface, `Repo`
([src/lib/repo.ts](src/lib/repo.ts)). Resolution order in `getRepo()`:

1. **Cloudflare D1** — used automatically when a `DB` binding exists: on
   Freebuff Sites, under `wrangler dev`, and in `next dev` through the OpenNext
   proxy. Adapter: [src/lib/repo-d1.ts](src/lib/repo-d1.ts), schema:
   [sites/d1-schema.sql](sites/d1-schema.sql) (also created on first use by
   `ensureSchema()`). **This is what production runs.** Isolation is the
   `tenant_id` filter on every statement — D1 has no row-level security.
2. **Supabase** — used when the three Supabase env vars are set. Adapter:
   [src/lib/repo-supabase.ts](src/lib/repo-supabase.ts), schema:
   [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql)
   (apply it with the Supabase CLI or the SQL editor).
3. **Demo JSON store** — the fallback. A seeded `DemoRepo` that persists to
   `.data/demo-db.json` when `node:fs` is reachable and stays in memory
   otherwise (Workers). Reset by deleting `.data/demo-db.json`; it re-seeds on
   the next request.

Tenant isolation is the same in all three: every query is scoped to the Clerk
organization id (`tenantId`), unknown tenants get `404` on public routes, and a
guessed id can never create orphan data.

---

## Authorization, roles & rate limits

Every non-public API route resolves its tenant **from the caller's session**,
never from client input alone ([src/lib/authz.ts](src/lib/authz.ts)):

1. no session → `401`;
2. a requested tenant that differs from the session's organization → `403`
   (cross-tenant attempt);
3. the caller's role must clear the route's permission tier:

| Tier | Roles | Covers |
| --- | --- | --- |
| `read` | viewer, counselor, admin, owner | lists, previews, CSV export |
| `write` | counselor, admin, owner | inbox replies/takeover/outcomes, knowledge ingest & re-index, lead import, nurture run |
| `manage` | admin, owner | agent rules, institution profile, knowledge delete, full backup, OCR run |

The console mirrors these tiers ([src/lib/roles.ts](src/lib/roles.ts)) —
viewers see read-only screens, counselors cannot change agent rules.
Machine endpoints (lead webhook, cron, OCR) authenticate with shared secrets
instead: `x-cron-secret: CRON_SECRET` or `x-webhook-secret` — and if no secret
env is set the endpoint **rejects** rather than falling back to a default.

Public endpoints are rate-limited per IP
([src/lib/ratelimit.ts](src/lib/ratelimit.ts), in-isolate fixed windows):
chat 30/min, lead webhook 60/min, login 10/min, OCR trigger 10/min,
WhatsApp webhook 120/min — all answer `429` with `Retry-After`. Plan caps
([src/lib/limits.ts](src/lib/limits.ts)) bound documents per tenant
(`KNOWLEDGE_DOC_LIMIT`, default 100) and leads (`LEAD_LIMIT`, default 10 000)
on the bulk paths (ingest, import, lead webhook).

> Switching backends moves no data — they are separate stores. Export leads as
> CSV from `/api/export/leads` if you need to carry records across.

---

## Knowledge ingestion & the async extraction worker

Uploads go through `POST /api/knowledge` (multipart file, `{ url }` or
`{ text }`). The synchronous pass in [src/lib/ingest.ts](src/lib/ingest.ts)
extracts text with **zero-dependency** parsers (txt/md/csv/json/html, docx and
xlsx via a minimal ZIP reader, PDFs via `FlateDecode` + text operators — all on
Web-standard APIs so the same code runs on Node and Workers), chunks at ~700
chars and tags topics (fees, eligibility, dates, courses, campus, transport,
hostel, placement).

Scanned PDFs and photographs produce no text. Those documents are parked as
`processing` with their original bytes stored in **R2** (`FILES` binding) under
`raw/<tenantId>/<docId>` — see [src/lib/rawstore.ts](src/lib/rawstore.ts) — and
the async worker finishes them:

```bash
# trigger it (scheduler, cron, or curl). No tenant id ⇒ every tenant.
# Auth: x-cron-secret: CRON_SECRET  |  x-webhook-secret: OCR_RUN_SECRET
#       (or LEAD_WEBHOOK_SECRET)  |  a signed-in admin session
curl -X POST https://<your-site>/api/knowledge/ocr \
  -H 'x-cron-secret: <CRON_SECRET>'
```

Both cron endpoints (`/api/knowledge/ocr` and `/api/nurture/run`) work the
same way — see **Background jobs** below.

The ingest route also schedules a run via `after()` right after a document that
needs it, so an upload normally completes on its own. The worker
([src/lib/ocr.ts](src/lib/ocr.ts)) then, per document:

- **URL import** → re-fetches the page;
- **file** → re-runs the local extractor (catches documents uploaded before an
  extractor fix), then sends the bytes to the OCR provider;
- **success** → chunks (+ embeddings when configured), flips the document to
  `ingested`, re-tags topics and writes a `knowledge.ocr` audit event (the
  parked upload is kept as the source for **Re-index**);
- **no provider configured / provider rejects it** → `failed` with the reason in
  the audit log (`knowledge.failed`) — nothing sits in `processing` forever;
- **transient failure** (network, provider 5xx/429) → stays `processing` so the
  next run retries it.

`OCR_API_URL` defaults to `https://api.openai.com/v1/chat/completions` (OpenAI
image/`file` parts are built automatically). Any endpoint that accepts
`{ filename, mimeType, data }` and answers `{ text }` works too.

---

## WhatsApp nurture delivery

[src/lib/whatsapp.ts](src/lib/whatsapp.ts) talks to Meta's **WhatsApp Business
Cloud API** (`graph.facebook.com/v26.0/<phone_number_id>/messages`) with plain
`fetch` — no SDK, so it runs unchanged on Workers.

- Credentials: a permanent **system-user access token** with
  `whatsapp_business_messaging` + `whatsapp_business_management`, plus the
  sending number's `phone_number_id`. Server-side secrets; never expose them.
- **Mode selection**: the lead's last inbound message opens a 24-hour customer
  service window. Inside it → free-form session message. Outside it → the
  approved template in `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANG`
  (sent with the follow-up text as its body parameter; if the template has no
  variables it is retried without them).
- Outcomes are audited: `nurture.sent` (accepted by Meta, with the `wamid`),
  `nurture.recorded` (WhatsApp not configured — nothing left the building),
  `nurture.failed` (with the provider error).
- Opted-out leads are skipped before any send.

Trigger it the same way as before (now authenticated):

```bash
curl -X POST http://localhost:<port>/api/nurture/run \
  -H 'content-type: application/json' \
  -H 'x-cron-secret: <CRON_SECRET>' \
  -d '{"tenantId":"org_greenfield"}'   # omit tenantId as a scheduler ⇒ every tenant
```

### Inbound messages (webhook)

[src/app/api/webhooks/whatsapp/route.ts](src/app/api/webhooks/whatsapp/route.ts)
implements Meta's webhook end to end:

- **GET** — verification challenge: echoes `hub.challenge` when
  `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`.
- **POST** — signature-checked (`X-Hub-Signature-256` over the raw body with
  `WHATSAPP_APP_SECRET`, timing-safe), then per message:
  - text / quick-reply / interactive-button replies run through the agent and
    its reply is sent back on the 24-hour service window the message just
    opened;
  - `STOP` / `unsubscribe` / `opt out` → lead opted out (+ confirmation
    reply); `START` / `subscribe` → opted back in; messages from opted-out
    numbers are ignored — same guardrail as the chat;
  - `sent` / `delivered` / `read` / `failed` status callbacks are recorded in
    the audit log against the lead's conversation (`whatsapp.*`).
- The tenant travels in the callback URL — there is no tenant input in the
  signed payload.

Register it in the Meta App Dashboard → WhatsApp → Configuration → Webhook:

```
Callback URL:  https://<your-site>/api/webhooks/whatsapp?tenant=<orgId>
Verify token:  <WHATSAPP_VERIFY_TOKEN>
Webhook fields: messages, statuses
```

Template registration/changes still happen in Meta's dashboard (App
Dashboard → WhatsApp → Message templates) — Meta approves templates out of
band, there is no API for submitting them.

---

## Background jobs (scheduler)

`/api/nurture/run` and `/api/knowledge/ocr` are plain HTTP cron endpoints:
authenticate with `x-cron-secret: CRON_SECRET` (or an admin session), omit the
tenant to sweep **every** tenant. The repo ships
[.github/workflows/scheduled-jobs.yml](.github/workflows/scheduled-jobs.yml)
which calls both every 15 minutes. One-time setup:

1. `Settings → Secrets and variables → Actions` in the GitHub repo:
   - secret `CRON_SECRET` — same value as the Sites secret (generate one with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
     your local copy lives in `.secrets/cron-secret.txt`, which is gitignored),
   - variable `APP_URL` — the production origin.
2. Sites → Secrets: set `CRON_SECRET` there too.

Any other scheduler (GitHub cron, Cloudflare Cron Triggers, a VPS crontab,
cron-job.org) works the same — it only needs to send the header. Uploads also
schedule their own OCR pass via `after()`, so the cron mainly catches
anything left by a crashed request and drives nurture follow-ups.

---

## Hot-lead alerts

When a lead **first** crosses to `hot`, [src/lib/notify.ts](src/lib/notify.ts)
always writes a `lead.hot_alert` audit event, and — when `KNOCK_API_KEY` is
set — triggers the Knock workflow `hot-lead-alert`
(`KNOCK_WORKFLOW_KEY`) with the lead's name, phone, score, course, city and
conversation id. Delivery (email/in-app) goes through whatever provider you
connect inside the [Knock](https://knock.app) dashboard; recipients default to
the tenant id and can be overridden with `ALERT_RECIPIENT_IDS`. Alert failures
are audited (`notify.failed`) and never break the conversation.

---

## Semantic retrieval (optional)

With `LLM_API_KEY` set, ingestion also stores an embedding per chunk
(`EMBED_MODEL`, default `text-embedding-3-small`; set it to `off` to disable)
and every search blends cosine similarity with the keyword score
([src/lib/embed.ts](src/lib/embed.ts), [src/lib/retrieval.ts](src/lib/retrieval.ts)):
a chunk passes on a keyword hit **or** a strong semantic match, so answers
still prefer exact term hits. Storage: D1 gets an `embedding text` column
(added automatically by `ensureSchema`, also in
[sites/d1-schema.sql](sites/d1-schema.sql)); Supabase already declares
`vector(1536)` in `0001_init.sql`; the demo store keeps vectors in its JSON
file. Any embeddings failure (no key, provider without `/embeddings`, timeout)
falls back to keyword search for that query — behaviour with the feature off
is byte-for-byte the old behaviour.

Chunks ingested **before** embeddings were enabled have no vector; they keep
working through keyword search and pick up vectors on **Re-index** (or
re-upload).

---

## Data in / data out

- **CSV import** — Leads page → *Import CSV* (`POST /api/import/leads`,
  `write` tier). Columns: `name`, `phone` (required), `email`, `city`,
  `course`, `message`. Rows run through the same agent pipeline as live
  leads: phone de-dupe, slot capture, scoring, conversation backing. Capped at
  500 rows per file and at `LEAD_LIMIT` overall.
- **CSV export** — Leads page → *Export CSV* (`/api/export/leads`, `read`).
- **Full backup** — Audit log page → *Export backup*
  (`/api/export/tenant`, `manage`): one JSON file with the tenant profile,
  settings, documents + chunks, leads, conversations, messages and the audit
  trail (`admitflow.backup.v1`).

---

## Tests

```bash
npm test          # node --test through tsx, no network, no server needed
npm run typecheck # tsc --noEmit
```

- [tests/agent.test.ts](tests/agent.test.ts) — slot capture (one question at a
  time, never re-asking, course vs city, phone normalisation), language
  detection, scoring/tiering across turns, and the never-answer guardrails
  (including that the guardrail follows each tenant's own `neverAnswer` list).
- [tests/whatsapp.test.ts](tests/whatsapp.test.ts) — payload envelopes, session
  vs template selection, the variable-less template retry, and error
  classification, all against a stubbed `fetch`.

Tests install an in-memory `Repo` double through `setRepoForTests()` and clear
LLM/OCR/WhatsApp keys before any `src/` module loads, so they never touch the
network — each test file starts with `import "./env"` ([tests/env.ts](tests/env.ts))
to guarantee that ordering.

---

## Deploying to Freebuff Sites

Production is a Cloudflare Worker built by OpenNext.

1. **Prepare** — `sites_prepare_next` installs the OpenNext adapter, writes the
   Freebuff build configs (your `next.config.ts` and `package.json` are
   preserved), runs `next build`, and packages the Worker. It returns
   `freebuff-sites-build/manifest.json` — the deploy manifest. The Publish
   button in Freebuff Desktop does the same thing.
2. **Storage** — provision the bindings once per environment:
   - D1 → binding **`DB`** (schema is created on first request),
   - R2 → binding **`FILES`** (raw uploads for the OCR worker).
3. **Secrets** — set them from the Sites panel (never in the repo):
   `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, the Supabase keys if
   you use that backend, `LLM_API_KEY`, `OCR_API_KEY`, `WHATSAPP_ACCESS_TOKEN`,
   `LEAD_WEBHOOK_SECRET` (required — the lead webhook refuses without it),
   `CRON_SECRET` (required for the GitHub Actions scheduler), and for inbound
   WhatsApp `WHATSAPP_APP_SECRET` + `WHATSAPP_VERIFY_TOKEN`. Optional:
   `KNOCK_API_KEY` for hot-lead alerts, `EMBED_MODEL` for semantic retrieval.
   Deploy once before setting secrets.
4. **Deploy & publish** — `sites_deploy` with the manifest returns an operation
   receipt; a `succeeded` receipt means the upload finished, **not** that the
   environment is live. Publication is explicit: check with `sites_inspect`
   (`published`) and publish with `sites_set_published`. Preview and production
   are independent and both public.
5. **Verify** — open the URL and check the console/network tab, hit an API
   route, sign in, and confirm a knowledge upload and a chat turn work against
   the real origin. An HTTP 200 alone proves nothing about rendering or auth.

Rolling back or taking it offline: `sites_set_published { published: false }`
keeps the code, data, secrets and URL — it just stops serving.

---

## Project map

```
src/
  app/                     marketing pages, console, sign-in
    api/chat               public inquiry endpoint (CORS, tenant-scoped, rate-limited)
    api/webhook/lead       lead-form webhook (shared secret, rate-limited)
    api/webhooks/whatsapp  inbound Meta webhook (verify, replies, STOP, receipts)
    api/knowledge          upload / list / preview / delete + reindex/ + ocr/
    api/import/leads       CSV lead import
    api/export/leads|tenant  CSV export · full JSON backup
    api/nurture/run        cron-able follow-up sender
    api/conversations/*    reply, takeover, outcome
  components/
    lead-import.tsx        CSV import control (role-aware)
  lib/
    agent.ts               agent 1: guardrails, slots, scoring, reply composition
    nurture.ts             agent 2: sequences, due computation, delivery
    ingest.ts              extraction, chunking, topic tagging, embedding
    ocr.ts  rawstore.ts    async extraction worker + R2 raw upload store
    whatsapp.ts            WhatsApp Business Cloud API client (outbound)
    authz.ts  roles.ts     session-pinned tenant guard + permission tiers
    ratelimit.ts  limits.ts  per-IP windows + per-tenant plan caps
    embed.ts  retrieval.ts embeddings + hybrid ranking
    notify.ts              hot-lead alerts (Knock + audit)
    repo.ts                Repo interface, demo store, backend resolution
    repo-d1.ts             Cloudflare D1 adapter
    repo-supabase.ts       Supabase adapter
tests/                     node:test suites (agent, whatsapp)
.github/workflows/         scheduled-jobs.yml — nurture + OCR every 15 min
sites/d1-schema.sql        D1 schema
supabase/migrations/       Supabase schema
```

### Known limitations

- The inbound WhatsApp webhook needs a **public HTTPS origin** plus Meta app
  registration (callback URL, verify token, subscribed fields) — the code is
  in, the wiring is done in Meta's dashboard.
- Rate limits are per-isolate and in-memory: a brake against bursts, not a
  distributed wall. The auth layer and Meta's signature check remain the
  security boundary.
- Chunks created before embeddings were enabled have no vector until
  re-indexed; retrieval then serves them keyword-only.
- Supabase and the demo store never share data with D1 — pick one backend.
- No automated tests for ingestion, nurture scheduling, the webhook or the
  D1 adapter (they are exercised by live smoke tests instead).
