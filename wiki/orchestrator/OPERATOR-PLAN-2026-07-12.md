# Operator Action Plan — Sunday 2026-07-12 (Mike)

Built 2026-07-11 late evening from a **live** GitHub/repo audit (4 subagents, verified against `gh` + `origin/main`, not old handoffs) plus first-hand orchestrator state from today's session. Where sources conflicted, the authoritative source is named.

**Today's context (already done, no action):** the 8-PR SHIP list was merged today (v3.129.2–.6, deployed, smoke green) — one auditor re-listed it from a stale STATE.md read; `git log origin/main` wins, it's DONE. Prod sites are healthy (200/301). Main CI + deploys green. **Bravo Ollama is back online** (was the #1 ops blocker — now verify-only).

---

## 1) MUST DO TOMORROW (Mike personally)

### M1 — Add `DOPPLER_TOKEN` to GitHub Actions secrets — 5 min, phone or laptop
- **Why:** `beta-gate.yml` has failed every run through 2026-07-11 with `##[error]DOPPLER_TOKEN not set` — the "CI-enforced beta gate" is fiction until this lands. Agents cannot touch repo secrets.
- **Unblocks:** the beta gate actually running; honest beta-readiness signal on every PR.
- **How:** GitHub → Mikecranesync/MIRA → Settings → Secrets and variables → Actions → New repository secret → `DOPPLER_TOKEN` = a **read-only Doppler service token for `factorylm/stg`** (create in Doppler dashboard → factorylm → stg → Access → Service Tokens).
- **Completion test:** `gh run list --workflow=beta-gate.yml --limit 1` → conclusion `success` (or a *real* test failure, not the token error).
- **Claude next:** re-run the gate, triage the first honest result, report RED/GREEN with cause.

### M2 — Authorize the merge queue (one message), then agents execute — 5 min authorization, ~2h supervised background
- **Why:** 15+ CI-green PRs are stacked; only a human may merge. Same update-branch → watch-green → squash-merge → settle loop proven today on the SHIP list.
- **Proposed order** (dependency-proof below): 
  1. Drive Commander lane: **#2621** (G120 pack) → **#2626** (public fault funnel + freemium gate) → **#2625** (dogfood regression) → **#2620** (Stripe webhook test) → **#2619** (drop anthropic dep)
  2. Gap train (sequential VERSIONs staged 3.129.9–13, reviewed + evidence-commented today): **#2639 → #2644 → #2637 → #2641 → #2638 → #2636**
  3. New lanes after your review: **#2640** (WO-evidence Step-2 plan, docs), **#2642** (machine-print pack), **#2643/#2645** (Visual Technician — see M5), CHARLIE docs **#2633**, **#2629**
- **Watch-outs (flagged during review):** three PRs ship a migration numbered 063 (#2635 ai_suggestions, #2645 visual_sessions) — filename-keyed ledger makes this cosmetic (rule 7), but confirm #2645's 063 doesn't collide semantically; the gap train MUST land in order (G6 #2638 contains G4 #2641's commits by design); #2641 (retrieval) requires the staging gate before deploy.
- **Completion test:** merged PRs reflected in `git log origin/main`; version-tag fires per bump; smoke stays green.
- **Claude next:** run the merge train exactly as today (rebase in scratch worktrees, E2E-smoke-flake retry once, stop on any real red), then verify `/drive-commander/siemens-g120` returns 200 post-deploy.

### M3 — Stripe: live mode + Drive Commander price — 20–30 min, laptop (Stripe dashboard + Doppler)
- **Why:** THE single biggest blocker to first dollar. Issue #1831 (live mode) + #2582 pricing decision ($29/mo or $197/yr) + PR #2626's Pro CTA needs a real price ID. Agents must not touch payment credentials.
- **Unblocks:** a stranger can actually pay for Drive Commander Pro once #2626 deploys.
- **How:** Stripe dashboard → activate live mode + payment method (#1831) → Products → create "Drive Commander Pro" with $29/mo and $197/yr prices → copy price IDs → Doppler `factorylm/prd` → add the key(s) PR #2626 names (see its body — `STRIPE_DRIVE_COMMANDER_*`), and update live `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` if still test-mode.
- **Completion test:** checkout from the deployed funnel reaches a live Stripe Checkout session (use a live-mode test card first).
- **Claude next:** flip `SMOKE_CHECKOUT_CHECK=1` in smoke-test.yml via PR (re-arms the checkout gate), run the money-path E2E, wire the #2620 test into CI required set.

### M4 — Two 2-minute phone taps
- **Ratify #2447** (90-day MVP rescope): reply "APPROVED" (or modify) on the PROPOSED comment; then Claude merges #2629 with the plan-doc banner.
- **Reschedule the promo-director cloud Routine** (code.claude.com → Routines): daily → weekly Monday 06:00 UTC (`0 6 * * 1`). Repo-side is done (13+1 drafts closed); only the cloud schedule remains. Completion test: no new `COMPETITOR_ANALYSIS refresh` draft PR appears before Monday.

### M5 — Read + decide ADR-0027 (MIRA Visual Technician) — 15–20 min, laptop
- **Why:** #2643 (ADR + PRD) and #2645 (Phase 1 code, 38 hermetic tests) landed today from another lane; the ADR is an architecture decision only you can accept. It sets the pattern for the camera/vision product line.
- **Refs:** PR #2643 → `docs/adr/0027-mira-visual-technician-architecture.md`; #2645 diff.
- **Completion test:** approve/comment on #2643; #2645 joins the merge queue (after its migration-number check) or gets change requests.

## 2) SHOULD DO TOMORROW

- **S1 — Score the Print Translator calibration packet** — 30–45 min, laptop. `docs/eval/print-translator-benchmark/calibration_packet/README.md`; your scores calibrate the LLM judge (Baseline A frozen). Unblocks: judge-calibration + staging OCR retest (agent-runnable after). Test: scored packet committed/returned.
- **S2 — CV-101 bench photos for #2631** — 30–60 min, **PLC bench + phone camera**. Your own prints PR awaits photo alignment; also decide its VERSION (it claims 3.130.0 — either intentional minor bump or rebase to next patch after the queue). Unblocks: real wiring data for the Machine Pack cv101 example + the #2635 wiring approve-path demo.
- **S3 — VPS capacity decision** (one line): move the staging stack off the prod box **or** bump droplet to 16GB (PR #2513 findings; swap 3.6/4.0GiB). Decision only — agents execute either path next week. Batches with nothing; do it while merging.

## 3) CAN DELEGATE TO CLAUDE IMMEDIATELY (no Mike needed)

1. Verify prod ingest end-to-end now that Bravo Ollama is up: confirm `nomic-embed-text` present (probe showed gemma first — may need `ollama pull nomic-embed-text`… that pull is on BRAVO, agent-doable via its session), trigger `kb_growth_cron`, prove ≥1 chunk stored + citable (#2562 Phase 1 proof).
2. Close stale issues with evidence: **#1830** (Gemini 403 — cascade is Groq→Cerebras→Together, Gemini removed), **#1665** (migrations 032–037 already on main; verify via `db-inspect.yml` read-only), and the Bravo-Ollama-restart line in #2564.
3. Dedupe the three duplicate ruff-fix drafts (#2628/#2627/#2624 — keep one, close two) and the older duplicate #2424/#2398 pair.
4. Rebase the stale-but-green Group C branches so they're one click for you (no merging).
5. Execute WO-evidence **Step 2 staging enablement** per #2640's plan (staging is agent-territory; gates G1–G5 documented).
6. Machine Pack **Phase 2** (schema `kind` discriminator + example cv101 pack) — agent-runnable per the plan doc.
7. #2646 allowlist burn-down (the 128 TODO justifications — start with the ~70 scripts/tests bulk class).
8. Worktree hygiene: prune the 12 locked `.audit-worktrees/*` + orphaned session trees (51 → ≤10), remove today's review worktrees after the queue merges.
9. Dependabot batch: verify + rebase the 9 bumps; flag #2249 (anthropic — recommend close, dep already removed by #2619).

## 4) CAN DEFER (not blocking)

- Identity unification #2437 (post-first-dollar), engine consolidation #2442 (~40h), fault-detective decision #2444, mira-sidecar migration #2446 (needs your go, not urgent), RBAC Phase 2 #2622, historian epic #2338–2346, i3x.

## 5) NO LONGER NEEDED / ALREADY DONE (verified)

- SHIP-list merges #2616/#2617/#2618/#2504/#2494/#2610 — **merged today** (auditor claim of "pending" was stale; git log wins).
- Bravo Ollama restart — **it's up** (curl 200 with model list tonight). Only the embed-model + end-to-end proof remains (delegated, item 3.1).
- Zip-bomb #2439, publish-gate test #2440, ctx signals #2441, RBAC P0 #2360 — closed today with file:line evidence.
- Interlock flywheel #2454 — parked and closed. Promo drafts (14) — closed.
- Docling dead-POST — fixed on main (#2614); prod extraction path is pdfplumber/Tika.

---

## Chronological plan (Sunday)

| When | Where | Actions |
|---|---|---|
| ☕ Morning, phone (10 min) | anywhere | M4 both taps (#2447 ratify, Routine reschedule) + M1 DOPPLER_TOKEN (phone browser works) |
| Late morning, laptop (45 min) | desk | M3 Stripe live + SKU + Doppler keys → then message Claude: "run the merge queue" (M2) — the train runs in background while you… |
| Midday (45 min) | desk | M5 read ADR-0027, decide; S1 score the calibration packet |
| Afternoon (60 min) | **PLC bench** | S2 CV-101 photos (batch all bench/camera work in one trip) + push to #2631 |
| End of day (5 min) | phone | Read Claude's merge-train + funnel-live report; drop S3 one-line VPS decision |

## Phone checklist
- [ ] #2447: reply APPROVED
- [ ] code.claude.com → Routines → promo refresh → weekly Mon 06:00 UTC
- [ ] GitHub → Settings → Actions secrets → add DOPPLER_TOKEN (stg read-only)
- [ ] Stripe: live mode + payment method + "Drive Commander Pro" $29/mo + $197/yr → price IDs → Doppler prd
- [ ] Tell Claude: "run the merge queue" (order in OPERATOR-PLAN M2)
- [ ] Read ADR-0027, approve/comment #2643
- [ ] Score calibration packet
- [ ] Bench: CV-101 photos → #2631
- [ ] One line: staging off prod box, or 16GB droplet?

## Top 3 highest-leverage
1. **Stripe live + SKU (M3)** — converts a merged funnel into a purchasable product.
2. **Merge-queue authorization (M2)** — lands Drive Commander + the gap train (incl. the beta-P0 tenant-recall fix) in one supervised run.
3. **DOPPLER_TOKEN (M1)** — turns the beta gate from fiction into signal.

## Single most important blocker
**Stripe live mode + Drive Commander price.** Everything else on the first-dollar path (pack, funnel, freemium gate, webhook provisioning test) is code that's green and waiting; nobody but you can create the thing that takes the money.

## Claude can execute now without Mike
Items 3.1–3.9 above (ingest proof, stale-issue closes, dedupe, rebases, WO-evidence staging Step 2, Machine Pack Phase 2, allowlist burn-down, worktree hygiene, dependabot triage).

## Proposed agent dispatch (after your M2 go)
- **CHARLIE (this session):** merge-train executor (M2 mechanics) → post-deploy funnel verification → stale-issue close sweep → worktree hygiene.
- **BRAVO (open session):** `ollama pull nomic-embed-text` if missing → kb_growth end-to-end chunk proof (#2562 Phase 1) → then DriveSense PR-A per #2494 now the wedge docs are merged.
- **Background workflow (sonnet):** WO-evidence Step 2 staging run (#2640 gates G1–G5) ∥ Machine Pack Phase 2 schema PR ∥ #2646 bulk-class burn-down. All PRs-only, no prod, no merges.
