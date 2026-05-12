# Manual Intelligence Self-Serve Flow — Gap-Fill Spec

**Date:** 2026-05-12
**Owner:** MIRA platform
**Status:** Draft — actionable
**Source:** Eval of "Upload manual → get maintenance intelligence" self-serve flow.

## Goal

A customer signs up, pays, uploads an OEM manual, and within minutes gets:
1. A grounded chat answer when they ask a question about that manual.
2. A PM schedule + asset registry + fault codes extracted from the manual.
3. An obvious next-step UI ("View what we found").
4. Export paths (CSV + ICS) so the value escapes our app.

Today, every step except extraction has a gap. This spec defines the 5 fixes.

---

## Gap 1 — Hub chat doesn't query `knowledge_entries` (P0)

### Problem
`mira-hub/src/app/api/assets/[id]/chat/route.ts` builds its system prompt from asset metadata + KG graph context only. The real RAG corpus — `knowledge_entries`, 83K chunks indexed with Postgres `tsvector` (`content_tsv`) — is never queried. The same DB is queried correctly by:
- `mira-bots/shared/workers/rag_worker.py` (Telegram path)
- `mira-scan-monday/backend/vendor_rag.py` (manufacturer-scoped BM25, the cleanest reference)

Result: customer uploads a manual, asks a question, gets a confident hallucination grounded in nothing.

### Fix
Wire the Hub chat route to BM25-retrieve from `knowledge_entries` before invoking the LLM cascade.

**Flow:**
1. Receive `messages[]` + asset id.
2. Look up asset row to get `manufacturer` (and `model_number`).
3. Query `knowledge_entries` with `content_tsv @@ plainto_tsquery('english', $query)`, filtered by `tenant_id` AND `manufacturer ILIKE '%<mfr>%'`, ranked by `ts_rank_cd`, `LIMIT 5–10`.
4. If zero chunks under manufacturer scope, retry without the manufacturer filter (still tenant-scoped). Mark sources as "cross-vendor" so the UI can flag it.
5. Build grounded system prompt with `[1] manufacturer model — p.N`-style citation blocks (mirror `vendor_rag.build_grounded_messages`).
6. Stream from Groq → Cerebras → Gemini (existing cascade in the route).
7. Emit a non-content SSE event (e.g. `data: {"sources":[...]}\n\n`) before `[DONE]` so the UI can render citation chips.

### Files
- **Modify:** `mira-hub/src/app/api/assets/[id]/chat/route.ts`
- **Create:** `mira-hub/src/lib/manual-rag.ts` — `retrieveManualChunks()` + `buildGroundedSystemPrompt()`. Pure functions, easy to unit-test.
- **Optional UI:** chat panel renders `sources[]` chips below the assistant message.

### Acceptance criteria
- Posting a question about an asset whose manufacturer has chunks in `knowledge_entries` returns an answer that quotes/paraphrases retrieved chunks and emits `sources[]`.
- If zero chunks match anywhere, the answer plainly states "I don't have documentation on this" rather than guessing.
- All retrieval goes through `withTenantContext` (RLS enforced).
- No Anthropic. Groq → Cerebras → Gemini cascade preserved.
- Unit test for `retrieveManualChunks` with a mocked PG client covering: manufacturer hit, manufacturer miss + cross-vendor fallback, empty query.

### Estimate
1–2 days.

---

## Gap 2 — Signup wall: every new user lands on `/pending-approval` (P0)

### Problem
`mira-hub/src/middleware.ts:16–24` routes any token with `status === "pending"` to `/pending-approval`. No code path flips `pending → active` after Stripe checkout. New paying customers cannot enter the product.

### Fix
Two options; ship Option A first (smaller), Option B can follow.

**Option A — Trial auto-activation (preferred for self-serve):**
- New signups start with `status = "trial"`, `trialExpiresAt = now + 7 days`. Middleware already supports this (`status === "trial"` falls through). Remove the `pending` default from the signup path.
- Stripe webhook (`checkout.session.completed`) updates user → `status = "active"`, clears `trialExpiresAt`.

**Option B — Pending kept for Enterprise/manual-onboard tiers only:**
- Tag specific tiers as requiring approval. Self-serve tiers skip the gate entirely.

### Files
- `mira-hub/src/middleware.ts` (no logic change if signup default is fixed)
- Signup route (look for `auth/signup` or NextAuth callback that writes the user row)
- New: `mira-hub/src/app/api/stripe/webhook/route.ts` (or extend existing if present)
- DB: ensure `status`, `trialExpiresAt` columns exist on users table; otherwise migration.

### Acceptance criteria
- New signup with no Stripe interaction → lands inside the app, sees trial banner, has 7 days.
- Stripe `checkout.session.completed` webhook → `status` becomes `active`, banner gone.
- Signed-in trial user past `trialExpiresAt` → redirected to `/upgrade` (existing logic).
- E2E: signup → upload manual → chat → no `/pending-approval` redirect.

### Estimate
1 day.

---

## Gap 3 — No ICS calendar export for PM schedules (P1)

### Problem
PM schedules live only inside the app. Users want them on their phone/Outlook/Google Calendar.

### Fix
Generate an RFC 5545 VCALENDAR for the active PM schedule. One `VEVENT` per PM occurrence with `RRULE` if recurring.

### Files
- **Create:** `mira-hub/src/lib/ics-export.ts` — pure builder (string in, string out). No deps required; hand-roll the small subset needed.
- **Create:** `mira-hub/src/app/api/pm/export.ics/route.ts` — returns `text/calendar`, `Content-Disposition: attachment; filename="mira-pm.ics"`.
- **Modify:** PM schedule page — add "Export to Calendar" button → `/api/pm/export.ics?asset_id=...` or `?tenant=...`.

### Acceptance criteria
- Downloaded `.ics` imports cleanly into Google Calendar, Outlook, Apple Calendar.
- Each event has UID, DTSTART, DTEND (or DURATION), SUMMARY, DESCRIPTION (PM task), RRULE for recurrence.
- Unit test: builder snapshot against a fixture schedule.

### Estimate
0.5 day.

---

## Gap 4 — CSV export not discoverable (P1)

### Problem
CSV export endpoints exist but are not surfaced in the UI. Users don't know they can leave with their data.

### Fix
Add visible "Export CSV" buttons on:
- PM schedule page
- Assets page
- Work orders page

Style as secondary action next to the filters. Use existing CSV endpoints (audit first; create thin wrapper routes if missing).

### Files
- PM schedule, assets, work orders page components
- Verify/extend existing `/api/*/export.csv` routes

### Acceptance criteria
- "Export CSV" visible above-fold on all three pages.
- Click → downloads a file named `mira-<resource>-YYYY-MM-DD.csv`.
- Columns documented in `docs/exports.md`.

### Estimate
0.5 day.

---

## Gap 5 — Upload → results UI polish (P1)

### Problem
After upload + extraction, the user is dropped back to a generic page. There is no "here's what we found" summary, so they don't know value was created.

### Fix
After ingest completes (poll `/api/uploads/:id` or subscribe to the existing job-status channel), render a summary card:

> **Found in `pump-manual.pdf`:**
> - X PM tasks → View Schedule →
> - Y fault codes → View Knowledge →
> - Z knowledge chunks → Ask a question →

Each link routes to the relevant page with the new content highlighted (e.g. `?since=<upload_id>` filter).

### Files
- Upload page / post-upload view component
- `mira-hub/src/app/api/uploads/[id]/route.ts` — return counts (already may; verify)
- Highlight UI on PM schedule + Knowledge + Asset chat pages

### Acceptance criteria
- After a successful manual upload, the user sees concrete counts within 30s of ingest completion.
- Each link navigates and visibly filters/highlights the new content.
- Screenshot pair (before/after) committed to `docs/design-history/` per project convention.

### Estimate
1 day.

---

## Order of execution

1. **Gap 1** (chat RAG) — unblocks all value: a paying customer who asks a question gets a real answer.
2. **Gap 2** (signup wall) — without this no customer reaches Gap 1.
3. **Gap 5** (results UI) — makes ingest results legible, drives Gap 1 usage.
4. **Gap 4** (CSV) — quick win, increases perceived value.
5. **Gap 3** (ICS) — same.

Gaps 2 + 1 can be built in parallel by separate agents — they share no files.

## Non-goals

- New embedding model / pgvector — BM25 is good enough at this corpus size and already indexed.
- Reranking / hybrid retrieval — defer until we have eval data showing it's needed.
- Multi-turn citation memory — each turn re-retrieves; the cost is dominated by LLM, not BM25.
- Anthropic — explicitly excluded per repo policy.
