# Product analytics — activation funnel (PostHog)

Integration note for the AdmitFlow console. Nothing here touches a PostHog
project yet: the code path is implemented, offline-tested, and inert until an
operator supplies a project token, an ingestion host and a visitor grants
consent.

## Repository facts

| Item | Value |
| --- | --- |
| Package manager | `npm` (no `packageManager` field; `npm install` is what the README documents) |
| Lock file (original, kept) | `package-lock.json`, `lockfileVersion: 3` |
| Owning package / importer | `admitflow@0.1.0` — root importer `""` in `package-lock.json` (single-package repo, no workspaces) |
| Framework | Next.js `16.4.2` (App Router), React `19.3.1`, TypeScript `5.8.3` |
| Runtime used for checks | Node `v24.17.0`, npm `11.13.0` |
| Quality commands | `npm run typecheck` (`tsc --noEmit`), `npm run build` (`next build`). There is **no** lint script and **no** test script in `package.json`. |
| Offline analytics checks | `node posthog-analytics.verify.mjs` (runs `posthog-analytics.test.mjs` with `node --test` — the toolchain Node already provides) |

Lock/manager signals checked before editing: only `package-lock.json` exists at
the project root. `design-ref/bun.lock` belongs to the vendored Tines design
reference — a separate, git-ignored copy (excluded from `tsconfig.json`), not a
workspace of this package — so it is not a competing lock for this app. No
`yarn.lock` anywhere.

Baseline before any change: `npm run typecheck` passed; no lint or test command
exists to run. After the change: `npm run typecheck` still passes and
`node posthog-analytics.verify.mjs` passes (13 offline tests).

## Question

> Of institutions that open the Setup guide, how many reach a first grounded AI
> reply in the sandbox and approve go-live, and which setup step loses them?

This is the product's activation moment: a tenant only gets value once the
inquiry agent answers from their own approved knowledge. The funnel starts at
the guide's denominator and ends at the "approve & go live" decision, so the
drop-off points map directly to a screen the team can improve.

## Events (contract)

| # | Event | Trigger (real code) | Allowed properties |
| --- | --- | --- | --- |
| 1 | `setup_guide_opened` | `OnboardingWizard` mount in [src/components/onboarding-wizard.tsx](src/components/onboarding-wizard.tsx) (rendered by [src/app/console/onboarding/page.tsx](src/app/console/onboarding/page.tsx)) → `trackSetupGuideOpened()` | `has_profile` (bool), `knowledge_doc_count` (int) |
| 2 | `knowledge_document_ingested` | Successful `POST /api/knowledge` in `uploadFile` / `submitUrl` / `submitPaste` of [src/components/knowledge-client.tsx](src/components/knowledge-client.tsx) → `trackKnowledgeIngested()` | `source_kind` (`pdf`/`docx`/`xlsx`/`url`/`template`/`other`), `topic_count` (int), `doc_count` (int) |
| 3 | `agent_sandbox_message_sent` | Successful `POST /api/chat` reply in the onboarding `Sandbox` component of [src/components/onboarding-wizard.tsx](src/components/onboarding-wizard.tsx) → `trackSandboxMessageSent()` | `is_first_message` (bool), `answer_grounded` (bool — reply cited sources), `handoff` (bool) |
| 4 | `setup_go_live_approved` | "Approve & go live" click in the same `Sandbox` → `trackGoLiveApproved()` | `has_profile` (bool), `knowledge_doc_count` (int), `sandbox_messages` (int) |

No pre-existing analytics existed in the repository, so these are additive and
duplicate nothing. Everything is emitted through `captureEvent()` in
[src/lib/analytics.ts](src/lib/analytics.ts), which refuses any event outside
this table and strips any property outside the row's allowlist (booleans,
counts and the `source_kind` enum only — no free-text values at all).

Deliberately **not** collected: lead names/phones/emails, institution names,
document names, chat text, URLs, referrers, device data, session replay.

## Identity

- Browser client: `identifySession(subjectId)` is called by
  [src/components/analytics-identity.tsx](src/components/analytics-identity.tsx)
  from the console layout with `session.userId` only — Clerk's opaque `user_…`
  id (or the demo `user_demo_owner`). Anything that is not an opaque
  `[A-Za-z0-9_-]{6,64}` id (an email, a blank) is rejected and the visitor
  stays anonymous.
- `resetAnalyticsIdentity()` runs in both sign-out controls
  ([src/components/demo-sign-out.tsx](src/components/demo-sign-out.tsx),
  [src/components/clerk-sign-out.tsx](src/components/clerk-sign-out.tsx)), so a
  shared browser does not carry one institution's identity into the next
  session.
- The tenant/institution is deliberately not sent: multitenancy lives in the
  app's own RLS boundary, not in analytics.

## Consent

- The client is created with `opt_out_capturing_by_default: true` and is only
  initialized after an explicit grant stored under
  `admitflow.analytics-consent` (`granted` / `denied`) in `localStorage`.
  **No decision means off** — no cookieless fallback, no pre-consent events.
- [src/components/analytics-consent.tsx](src/components/analytics-consent.tsx)
  is the grant/decline control, mounted once in the root layout. It renders
  only when a token + host are configured.
- The repository had no analytics CMP before this change; the app's existing
  lead-messaging consent and STOP opt-out are untouched and unrelated.
- `before_send` ([`scrubEvent`](src/lib/analytics.ts)) re-checks the contract
  on every payload and drops `$current_url`, `$referrer`, `$set`/`$set_once`
  person metadata and anything else not allowlisted; unknown events are
  discarded.

## Configuration

Browser client, initialized at the Next.js `instrumentation-client` boundary
([src/instrumentation-client.ts](src/instrumentation-client.ts)) which installs
the single `posthog-js` singleton for every instrumented component:

```
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=   # browser-safe public project token
NEXT_PUBLIC_POSTHOG_HOST=            # https://us.i.posthog.com | https://eu.i.posthog.com | self-hosted ingestion domain
```

Both are empty placeholders in [.env.example](.env.example); local env files are
already git-ignored. Missing token **or** missing host keeps capture off, so the
demo mode is unaffected.

Client privacy defaults: `autocapture: false`, `capture_pageview: false`,
`capture_pageleave: false`, `capture_dead_clicks: false`,
`disable_session_recording: true`, `disable_surveys: true`,
`advanced_disable_flags: true`, `person_profiles: "identified_only"`,
`respect_dnt: true`, `persistence: "localStorage"`.

### Install evidence

- Command: `npm install posthog-js@1.438.13` (npm, install scripts skipped by the host sandbox).
- Manifest: `package.json` → `"posthog-js": "1.438.13"`.
- Lock: `package-lock.json` → `packages["node_modules/posthog-js"].version = "1.438.13"`,
  root importer `packages[""].dependencies["posthog-js"] = "1.438.13"`.
- Sole importer: [src/instrumentation-client.ts](src/instrumentation-client.ts).

## Live analysis (to run once a project is connected)

- Insight: a **funnel** (PostHog → Product analytics → Funnels), steps in this order:
  1. `setup_guide_opened`
  2. `knowledge_document_ingested`
  3. `agent_sandbox_message_sent`
  4. `setup_go_live_approved`
- Conversion window: **1 day** per person (activation is a first-session event).
- Denominator: unique persons who emitted step 1 (`setup_guide_opened`).
- Success measure: share of those persons who reach step 4 — plus the step with
  the steepest drop-off, which names the screen to fix.
- Secondary breakdown once there is volume: step 3 by `answer_grounded`
  (`true` vs `false`) to see whether ungrounded answers stall go-live, and step 3
  by `handoff`.
- Success looks like: a non-zero step-1 count, and the largest drop-off located
  at a single named step (e.g. "knowledge uploaded → sandbox tested"), not an
  all-zero funnel (which would mean consent/configuration never landed).

### How to produce the insight

1. In PostHog, create/choose the project and copy its **public project token**
   plus the ingestion host for its region.
2. Put them in `.env.local` as `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and
   `NEXT_PUBLIC_POSTHOG_HOST`, start the app (`npm run dev`).
3. Accept the analytics consent control, sign in with the demo owner account,
   walk `/console/onboarding` (upload knowledge, send a sandbox message, approve
   go live). Sign out once to exercise `reset()`.
4. In PostHog, confirm the four events arrive and build the funnel above.

## Offline verification

```
node posthog-analytics.verify.mjs
```

Spawns `node --test posthog-analytics.test.mjs` with `shell: false`, a bounded
timeout, a from-scratch environment (no dotenv/framework autoload) holding only
path/temp values plus a synthetic token and host, and fails on a missing runner,
a missing test file, a non-zero exit, zero executed tests or any failure. The
suite drives the real handlers in `src/lib/analytics.ts` through an in-memory
client and consent store to prove: consent and configuration gating, one event
per action with the allowlisted properties, sentinel email/password/token/card
and URL/referrer exclusion, `before_send` scrubbing, harmless init/transport
failures, opaque identity + reset, no network calls, and that the manifest and
lock still pin `posthog-js@1.438.13` with no yarn/pnpm/bun lock present.

## Status

- Code, configuration names, consent control and offline proofs: **done**.
- Real insight in a PostHog project: **pending** — requires the operator to
  create/choose the project and set the two env values privately. No event has
  been transmitted by this change.
