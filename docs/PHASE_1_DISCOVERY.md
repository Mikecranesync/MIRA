# PHASE 1 — FactoryLM Discovery and Connection Map

**Date:** 2026-09-08 · **Method:** six parallel read-only tracing agents + direct verification.
**No product code was changed.** This document is the only artifact.

> ⚠️ **Read this first — a bias in the evidence.** The tracing agents read the working tree,
> which was on branch `feat/hub-v3-surface`, **not `main`**. Every "X does not exist" claim was
> therefore relative to that branch. I re-normalised each one against `origin/main` before
> recording it here, and two agent findings turned out to be branch artifacts rather than
> defects. Where a claim depends on which branch you stand on, this document says so.

---

## 1. Executive summary, in plain English

**The unification is not a proposal. It is largely built, and the pieces are scattered across
branches nobody can see.**

Three shared UI packages exist, are CI-gated, and already ship to production mobile behind a
device-local beta toggle. A Hub-side V3 surface wired to real retrieval exists. A composer-first
home screen exists. None of it is in a queue: **7 of the 10 branches created during this
programme have no pull request at all.** The single largest risk to this project is not
technical difficulty — it is rebuilding something that already exists on an invisible branch.

**Four things are actually broken**, in descending order of consequence:

1. **No OTA bundle has ever reached a handset.** Twice disproven, not merely unverified. The
   publish tooling verifies `updates.factorylm.com`; the client asks `app.factorylm.com`. Every
   CI check exercises the first host. Nothing exercised the second until an unmerged draft.
2. **The V3 surface calls an endpoint that is not on its own branch.** `/v3` posts to
   `/api/hub/ask`, which lives only on `feat/hub-home-composer`. Merged alone, V3's composer
   404s. Its 16 contract tests assert on source text and never make the call.
3. **`/` is redirected to `/feed` by three independent implementations**, and the outermost
   (nginx) has silently regressed a closed bug (#1952): unauthenticated visitors lose their
   callback URL. The middleware written to prevent exactly that never runs.
4. **Gemini is the third provider in a live diagnostic chat cascade** (`assets/[id]/chat`),
   contrary to PRD §4. A test named "NEVER routes to Gemini" exists and is CI-gated — but covers
   only the equipment-notebooks seam, not this route.

**The good news is substantial.** The Equipment Notebook spine (migrations 073/081/084/085/086)
is a genuinely well-built, cross-device, per-technician-owned conversation system. Capabilities
are consolidated into one function serving both web and mobile. The attachment spine — park,
recognise, confirm, materialise, cite — is sound and instrumented. **The backend is not the
constraint.** Almost everything V3 needs to become a product is wiring.

---

## 2. Repository and runtime topology

| Surface | Stack | Origin | Auth | Consumes shared shell? |
|---|---|---|---|---|
| `mira-hub` | Next.js | `app.factorylm.com` | NextAuth JWT cookie, UUID tenant, Postgres RLS | **no** |
| `mira-mobile` | Capacitor + React | native app | same NextAuth flow, hand-rolled cookie jar | **yes — via tsconfig/vite path alias only** |
| `mira-web` | Hono/Bun | `factorylm.com` | separate `jose` HS256 JWT | no |
| `apps/factorylm-ui-lab` | Vite | dev only | none (CSP `connect-src 'none'`) | yes, via `file:` deps |
| Ignition / bots | Python | direct | HMAC / no per-user auth | no |

**One NeonDB behind all of them.** Two tenant-id spaces coexist: `cmms_equipment.tenant_id` is
`TEXT` with legacy slugs; kg/Hub tables are `UUID`, and non-UUID sessions are 401'd at
`requireSession()`. RLS is enforced for the Hub; every other surface connects as an
RLS-bypassing role and relies on app-level predicates.

**Original file bytes live in Postgres** (`namespace_direct_uploads.content BYTEA`),
content-addressed by SHA — not object storage. Consistently applied; a fact, not a defect.

---

## 3. Connection matrix

| Capability | Frontend | Backend | Storage | Status | Action |
|---|---|---|---|---|---|
| Equipment Notebook chat | `NotebookScreen`, `ChatV2`, Hub notebook routes | `/api/equipment-notebooks/[id]/chat` | `equipment_notebook_turns` (073/086) | **live, cross-device** | KEEP |
| V3 web surface | `mira-hub/src/app/v3/page.tsx` | `/api/hub/ask` | — | **incomplete — endpoint on another branch** | REPAIR |
| Home composer | `HomeComposer.tsx` on `/feed` | `/api/hub/ask` | `knowledge_entries` | built, **no PR** | CONNECT |
| Quickstart (public) | `/quickstart` | `/api/quickstart/ask` | shared OEM corpus | live | KEEP |
| AssetChat | `/assets/[id]` | `/api/assets/[id]/chat` | **`localStorage`, unscoped by user** | live, risky | CONSOLIDATE |
| NodeChat | `/namespace` | `/api/namespace/node/[id]/chat` | localStorage | duplicate (admitted in code) | CONSOLIDATE |
| `troubleshooting_sessions` | demo tablet | engine | migration 019 | no list endpoint — unreachable | VERIFY |
| Bot conversations | Slack/Telegram | `session_manager.py` | host-local SQLite, no tenant column | live, structurally isolated | KEEP |
| Attachments (mobile) | `AddSourcesSheet`, `AttachFileSheet` | `/api/namespace/node/[id]/files` | `namespace_direct_uploads`, `workspace_file_links` | live | KEEP |
| Attachments (web local) | `UploadPicker` | `/api/uploads/local` | same v2 writer | live | KEEP |
| Attachments (web cloud/photo) | `UploadPicker` | `/api/uploads` → external `mira-ingest` | — | **divergent pipeline** | VERIFY |
| Nameplate OCR + confirm | `ComponentNameplateFlow` | `/nameplate/recognize`, `/confirm` | parks photo **before** recognising | live, well built | KEEP |
| Citation viewer | `FilePreview` (blob URL, authenticated) | `/api/namespace/files/[id]` | BYTEA | live | KEEP |
| OTA | `AboutUpdates`, `live-update.ts` | Hub manifest route + `updates.factorylm.com` | — | **broken (#3664)** | REPAIR |
| OTA channel selection | `AboutUpdates.tsx` | — | keys exported, **never read or written** | **dead code** | REPAIR or RETIRE |
| Capabilities/roles | `/api/me` | `capabilities.ts` | `hub_users.role` | live, single source of truth | KEEP |
| `(hub)/scan` | `scan/page.tsx` | — | — | **unreachable — nginx gives `/scan/` to another app** | REPAIR |
| Shared shell | `packages/factorylm-{theme,interaction,ui}` | none by design | none | live in mobile beta + lab | KEEP |

---

## 4. V3 versus existing capability — the gap map

| V3 needs | Already exists? | Gap |
|---|---|---|
| Ask a general question | **yes**, built | endpoint on the wrong branch |
| Ask **about a machine** | yes — notebook chat, fully wired | V3 doesn't call it; no scope picker |
| Attach a photo/manual | yes — three doors, mobile + web | V3's `＋`/`◉` are inert |
| Nameplate → manual → citation | yes, end to end | not surfaced in V3 |
| Conversation persists | yes — notebooks, per-user owned | V3 is in-memory only |
| Citation opens the original | yes | V3 renders text cards only |
| `More ›` destinations | ~60 Hub routes exist | **`More ›` goes nowhere** |
| Machine list / QR entry | yes | not in V3 |

**Every row above is wiring against endpoints that already exist.** None requires new backend.

---

## 5. Duplicate shells and duplicate features

| Duplicate | Instances | Authoritative | Action |
|---|---|---|---|
| App shell | `packages/factorylm-ui`; Hub `/v3` bespoke; Hub legacy nav; mobile classic tabs | shared package (per charter) | CONSOLIDATE — `/v3` should consume it, not reimplement |
| Chat surface (mobile) | legacy, ChatV2 (default), UnifiedChat (beta) | ChatV2 today, unified next | VERIFY this is a migration window, not permanent |
| Chat surface (web) | notebook chat, AssetChat, NodeChat, `/v3`, `/quickstart` | notebook chat | CONSOLIDATE |
| Root redirect | nginx 301, `middleware.ts`, dead `app/route.ts` | middleware (intended) | REPAIR — nginx wins today and is wrong |
| Nav source of truth | `NAV_ITEMS` vs hand-written `/more` MORE_ITEMS | `NAV_ITEMS` | RETIRE the second |
| Hybrid-corpus SQL predicate | TypeScript `manual-rag.ts` + Python `neon_recall.py` | both, hand-duplicated | CONSOLIDATE or pin with a shared test |
| LLM cascade | `mira-hub/lib/llm/cascade.ts` (has Gemini), `mira-bots/inference/router.py` (correct) | the Python one | REPAIR |
| `/cmms` vs `/workorders` | two CMMS pages | `/workorders` | VERIFY, likely RETIRE |

---

## 6. Proposed ownership boundaries

- **`packages/factorylm-*`** owns presentation and interaction. No fetch, no auth, no storage.
- **Host apps** (`mira-hub`, `mira-mobile`) own data, auth, platform adapters — via `HostHooks`.
- **Hub API** owns retrieval, grounding, citations, tenancy, and the approved-context gate.
- **Nothing but nginx should own routing at the origin**, and it should delegate `/` to the app.
- **One nav definition** (`NAV_ITEMS`) feeds both the sidebar and `More ›`.

---

## 7. Ordered Phase 2 backlog

Each item is wiring unless marked otherwise. Ordered so nothing is built twice.

1. **Open PRs for the 7 invisible branches.** Zero code. Highest value per minute: it stops
   duplicate work and surfaces the beta-gate correction, the register, and the 412 fix.
2. **Repair `/v3`'s missing endpoint** — either land `feat/hub-home-composer` first or move the
   route. *Blocks any V3 testing.*
3. **Connect the disconnected tests** — `notebook-adversarial`, `notebook-loop`,
   `notebook-visual` and three `.integration.test.ts` files exist and run in no workflow.
4. **`More ›` opens something**, from `NAV_ITEMS`. Removes a promise the UI breaks today.
5. **Scope picker in V3** → notebook chat. Turns a search box into the product.
6. **Attachments in V3** → the existing three doors.
7. **History in V3** → `equipment_notebooks`. Do not invent a `conversations` table.
8. **Move V3 onto `packages/factorylm-ui`** — before more surface is written twice.
9. **Land the OTA fix (#3661) and verify on a handset.** Not UI; on the critical path for mobile.
10. **Repair the root redirect** (nginx + middleware + delete dead route), then flip `/` last.

---

## 8. Unknowns requiring runtime or handset proof

- **Is Gemini reachable in production?** Depends on whether `GEMINI_API_KEY` is set in Doppler
  `prd`. Code path exists and is unguarded on `assets/[id]/chat`. **Cannot be answered from the repo.**
- **Do cloud-picked uploads become citable?** The local path converged on the v2 writer; the
  Google/Dropbox and photo paths still forward to external `mira-ingest`. Needs a live upload.
- **Which shell was on the phone during testing?** The chat-surface toggle is device-local.
- **Does OTA work?** Requires a signed-in handset: Check now → Update ready → Restart → About
  shows the new bundleId.
- **Does `mira-web` scope its DB access?** No `withTenantContext` found in that module.
- **Is the retry buffer safe on a multi-replica Hub?** It is `os.tmpdir()`-based.
- **Are all 175 API route files live?** Route files were counted, not responses.

---

## 9. Risks

- **Rebuilding invisible work** — the dominant risk. Seven branches, no PRs.
- **Flipping `/` prematurely** — 13+ hardcoded `/feed` call sites, plus an onboarding tour keyed
  on `pathname === "/feed"` that will silently stop firing.
- **Trusting source-level tests** — V3's own suite is green while its primary action is broken.
- **Cross-user chat leakage** on shared devices via AssetChat's unscoped `localStorage` key.
- **Doctrine describing unimplemented surfaces** — the direct-connection UNS rule names six
  surfaces; only Ignition implements it.

## 10. Explicit non-goals for Phase 2

- Not flipping `/` to V3.
- Not retiring `/feed`, legacy mobile tabs, or the bot surfaces.
- Not migrating the TEXT/UUID tenant split.
- Not moving file bytes out of Postgres.
- Not building a second conversations table, ingest pipeline, or nav definition.
- Not touching production Slack, prod DB, or the VPS.
