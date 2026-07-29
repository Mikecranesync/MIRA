# Onboarding Upload → Ask: Beta-Gate Close (#1901)

**Date:** 2026-06-15
**Issue:** #1901 — *no upload step in onboarding + no obvious in-app 'Ask MIRA' for a fresh customer*
**Component:** `mira-hub`
**Status:** Design approved (2026-06-15)

## Problem

The product is gated on one action — a customer uploads their own equipment manual and
gets a grounded, cited answer from it. The upload→retrieval **plumbing** works (PR #1592),
but the **front door does not exist**:

- After signup the user lands on `/feed`, not onboarding.
- The onboarding wizard steps are `company → site → line → review → try → validate` — there
  is **no "upload a manual" step**.
- "Try MIRA" routes to `/quickstart`, which searches the **public OEM corpus only** — it
  cannot see the customer's own upload.
- Manual upload is buried at Knowledge → Manuals → Upload; the only in-app chat on their own
  content is Ask MIRA on a namespace node, reachable only if the user discovers it.

Net: a stranger has no guided path to the one action the product is gated on. This is the
beta gate (`.claude/CLAUDE.md` § "Primary product focus: Beta readiness").

## Goal

A fresh customer is guided to upload their manual and gets a **cited answer from their own
file**, unattended — no Mike fixing anything.

**Success criteria (the verification gate):**
1. A fresh tenant (0 namespace nodes) landing in the hub is taken to `/onboarding`.
2. The wizard has an upload step that ingests the customer's manual into their namespace.
3. The step waits until the manual is actually retrievable, then opens Ask MIRA scoped to
   that manual.
4. The first question returns an answer **with a citation from the uploaded file**.

## Non-goals (YAGNI / scope guard)

- No new upload API — reuse `/api/uploads/local`.
- No new chat surface — reuse the node-scoped Ask MIRA (`/api/namespace/node/[id]/chat`).
- No cloud file pickers (Google Drive / Dropbox) — that is #1902, separate.
- No change to ingest internals (mira-ingest → embed → KB).
- The existing "try" step (`/quickstart`, public corpus) stays as-is, downstream.

## Design

### Component 1 — Auto-launch onboarding for a fresh tenant

**What:** A tenant with no namespace yet is redirected into the wizard on entering the hub.

**Where:** A **server component** with DB access — the `/feed` page
(`mira-hub/src/app/(hub)/feed/page.tsx`). `middleware.ts` runs in the edge runtime and
cannot query the DB, so the namespace-existence check cannot live there.

**Logic:**
- On render of `/feed`, check whether the tenant has any namespace nodes (kg_entities /
  the same signal the wizard's `finish` writes, or wizard completion status).
- If **zero** namespace nodes → `redirect("/onboarding")`.
- **Loop guard:** only this `/feed` entry redirects; `/onboarding` itself never redirects
  back, and a `completed` wizard does not redirect (the wizard already sends completed users
  to `/namespace`). The user can still navigate away manually.

**Interface:** no new endpoint; uses the existing tenant/namespace read already available to
the feed page. Exact existence query confirmed during planning (kg_entities count for the
session tenant, or `/api/wizard/company` `status`).

### Component 2 — "Upload manual" wizard step

**What:** A new `upload` step in the onboarding wizard.

**Placement:** after `review` (so the site + line nodes exist and the manual has a namespace
node to attach to), before `try`. New `StepId` value `"upload"`; added to `STEPS` between
`review` and `try`.

**Flow inside the step:**
1. **Pick a file** — a native `<input type="file">` (industry-standard widget; trust signal).
   Accept PDF (+ the doc types `/api/uploads/local` already supports).
2. **Upload** — `POST /api/uploads/local` (session-authenticated browser path) with
   `unsPath = <line node uns_path>` so the resulting KB chunks are tagged into that node's
   subtree and become retrievable by the node-scoped Ask MIRA.
3. **Processing state** — poll `GET /api/uploads/[id]` (~2 s interval) and show
   "Extracting & indexing your manual…" until **ready**:
   `status === "parsed" && knowledge_chunks_count > 0`. Surface a clear error state on
   `status === "error"` (with a retry via `/api/uploads/[id]/retry`).
4. **Ready** — primary CTA **"Ask MIRA about your manual"** → navigate to the **line node's
   Ask MIRA** surface (node-scoped chat; the node selection IS the UNS location-confirmation
   gate, so this is gate-compliant by construction and retrieves the customer's own manual,
   not the public corpus).
5. **Skippable** — "I'll upload later" advances to `try`/`validate` unchanged.

**Interface:** one new step component in `onboarding/page.tsx` (mirrors the existing
`TryStep`/`ValidateStep` pattern) + a small poll helper. No change to upload or chat APIs.

### Data flow

```
signup/login ─▶ /feed (server) ──0 nodes──▶ /onboarding
                                            wizard: company→site→line→review
                                                       │ finish() creates site+line kg_entities (uns_path)
                                                       ▼
                                            upload step
                                              POST /api/uploads/local (file, unsPath=line.uns_path)
                                                       │  mira-ingest → extract → embed → KB (async)
                                              poll GET /api/uploads/[id] until parsed & chunks>0
                                                       ▼
                                            "Ask MIRA about your manual"
                                              ─▶ line node Ask MIRA (/api/namespace/node/[id]/chat)
                                                  subtree-scoped retrieval → cited answer from THEIR manual
```

### Error handling

- Upload HTTP failure → inline error in the step, file retained, retry allowed.
- Ingest `status === "error"` → inline error + retry via `/api/uploads/[id]/retry`.
- Ingest slow / never ready → keep the processing state with a "still working…" message and a
  "skip for now" escape so the user is never trapped (poll has no hard timeout that strands
  them; the skip path always exists).
- Redirect guard prevents loops (see Component 1).

### Testing

- **Playwright e2e (regime: hub e2e):** fresh tenant → assert redirect to `/onboarding` →
  run wizard through `review` → upload a real manual fixture → assert processing state →
  wait for ready → ask a troubleshooting question → **assert the answer contains a citation
  referencing the uploaded file** (the beta-gate assertion).
- **Unit:** the ready-poll predicate (`parsed && chunks>0`), the redirect guard
  (0-node → redirect; completed/onboarding → no redirect).
- **Screenshot rule:** desktop (1440×900) + mobile (412×915) of the upload step (idle,
  processing, ready) and the cited answer → `docs/promo-screenshots/` with dated filenames.

## Files (anticipated)

- `mira-hub/src/app/(hub)/onboarding/page.tsx` — add `upload` step + poll helper.
- `mira-hub/src/app/(hub)/feed/page.tsx` — 0-namespace redirect (server component).
- `mira-hub/tests/e2e/…` — beta-gate e2e spec.
- `docs/promo-screenshots/2026-06-15_onboarding-upload-ask_*.png` — proof.

## Open items resolved during planning

- Exact 0-namespace existence query for the feed redirect.
- The concrete client route/URL for the line node's Ask MIRA surface (node id → chat UI).
- Whether `/api/uploads/local` already tags chunks by `unsPath` end-to-end (confirm the
  chunk → node subtree linkage that node-scoped retrieval depends on).
