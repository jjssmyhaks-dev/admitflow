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
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` | Follow-ups are recorded in the audit log, not sent |
| Webhooks | `LEAD_WEBHOOK_SECRET`, `OCR_RUN_SECRET` | Defaults to `change-me` — set it in production |
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
# trigger it (scheduler, cron, or curl); secret header matches LEAD_WEBHOOK_SECRET
curl -X POST https://<your-site>/api/knowledge/ocr \
  -H 'content-type: application/json' \
  -H 'x-webhook-secret: <secret>' \
  -d '{"tenantId":"org_greenfield"}'
```

The ingest route also schedules a run via `after()` right after a document that
needs it, so an upload normally completes on its own. The worker
([src/lib/ocr.ts](src/lib/ocr.ts)) then, per document:

- **URL import** → re-fetches the page;
- **file** → re-runs the local extractor (catches documents uploaded before an
  extractor fix), then sends the bytes to the OCR provider;
- **success** → chunks, flips the document to `ingested`, re-tags topics,
  writes a `knowledge.ocr` audit event and drops the parked upload;
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

Trigger it the same way as before:

```bash
curl -X POST http://localhost:<port>/api/nurture/run \
  -H 'content-type: application/json' -d '{"tenantId":"org_greenfield"}'
```

**Not implemented yet**: the inbound webhook (replies, delivery receipts,
template registration) — Meta needs a public HTTPS endpoint for it, so replies
currently arrive through `/api/chat` instead.

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
   `LEAD_WEBHOOK_SECRET`. Deploy once before setting secrets.
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
    api/chat               public inquiry endpoint (CORS, tenant-scoped)
    api/webhook/lead       lead-form webhook (shared secret)
    api/knowledge          upload / list / delete  + ocr/ (async worker trigger)
    api/nurture/run        cron-able follow-up sender
    api/conversations/*    reply, takeover, outcome
  lib/
    agent.ts               agent 1: guardrails, slots, scoring, reply composition
    nurture.ts             agent 2: sequences, due computation, delivery
    ingest.ts              extraction, chunking, topic tagging
    ocr.ts  rawstore.ts    async extraction worker + R2 raw upload store
    whatsapp.ts            WhatsApp Business Cloud API client
    repo.ts                Repo interface, demo store, backend resolution
    repo-d1.ts             Cloudflare D1 adapter
    repo-supabase.ts       Supabase adapter
tests/                     node:test suites (agent, whatsapp)
sites/d1-schema.sql        D1 schema
supabase/migrations/       Supabase schema
```

### Known limitations

- The inbound WhatsApp webhook (replies, delivery receipts) is not wired.
- OCR needs a provider key; without one, unextractable documents end as
  `failed` rather than being retried.
- Supabase and the demo store never share data with D1 — pick one backend.
- No automated tests for ingestion, nurture scheduling or the D1 adapter.
