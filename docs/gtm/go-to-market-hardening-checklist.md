# Go-To-Market Hardening Checklist

> **Owner:** GTM readiness · **Created:** 2026-06-10 · **Status:** in progress
>
> The #1 priority for going to market is a hardened set of stranger-facing
> demo/product surfaces. This checklist tracks all four priorities and their
> sub-items. Update it as items land.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Priority 1 — Quickstart chat path (`/api/quickstart/ask`)

The public, no-auth "ask MIRA" experience on factorylm.com. A stranger types a
maintenance question, picks a manufacturer (optional), and gets a grounded,
cited answer. This is the first thing a prospect touches — it must not look
like it hallucinates.

**Surface:** `mira-hub` (TypeScript) — `src/app/api/quickstart/ask/route.ts`
+ `src/lib/manual-rag.ts`. Note: this path does **not** go through the Python
`mira-bots/shared/engine.py`; citations are assembled in the TS route from
BM25 chunks.

- [x] **RED #1 — Rate limit.** Per-IP-hash in-memory limiter (20 req/min →
  429). Shipped in **PR #1838** (`fix/quickstart-rate-limit`, merge
  `5fd70dae`), verified on `origin/main`. Closes #1832.
- [x] **RED #2 — Citation relevance enforcement.** After BM25 retrieval, drop
  chunks whose manufacturer/model don't match the asked-about manufacturer
  (the tenant-wide fallback could pull e.g. Siemens chunks for a Danfoss
  question). Lightweight string match — no LLM call, no `uns_resolver` (there
  is no `uns_context` on this anonymous surface). Filter applied to the
  **chunks** (before `buildGroundedContext`), so the LLM never sees the
  irrelevant content and `[n]` markers stay consistent. → `filterCitationsByRelevance()`
  in `manual-rag.ts`, wired into `quickstart/ask/route.ts`.
  **Scope:** fires off the **picked manufacturer** (the request's `manufacturer`
  field — exactly the fallback case where the bug bites). A stranger who picks
  no manufacturer and types a free-text vendor mention ("my Danfoss VFD…") gets
  `manufacturer=null` → passthrough; BM25 query-text ranking is the only defense
  there. Free-text vendor extraction is out of scope on this surface. **Test the
  Danfoss case via the manufacturer picker.**
- [x] **RED #3 — Quickstart smoke gate.** End-to-end check on every deploy:
  POST a real maintenance question, assert non-empty answer + citations-or-
  explicit-refusal + no error status; assert 429 on the 21st rapid request
  (localhost only). → `tests/smoke/test_quickstart_e2e.py`, wired into
  `smoke-test.yml`.

**Follow-up (out of scope here):** the Python bot engine (Telegram/Slack via
`mira-bots/shared/engine.py` + `citation_compliance.py`) has the *same*
wrong-manufacturer citation gap on a *different* surface. Tracked separately —
do not fix inline with the quickstart work.

---

## Priority 2 — Command Center dashboard

The Hub UNS-tree + live HMI display surface (`mira-hub`, Command Center pages).

- [ ] Audit live-tile freshness / staleness guard on public-demo data.
- [ ] Verify no "Coming Soon" / fake-data tiles are reachable in the demo path.
- [ ] Confirm cloud-reach proxy (Phase 2) liveness probes are green.
- [ ] Smoke check: Command Center loads with seeded demo data, no 5xx.

_(Sub-items to be refined when this priority is picked up.)_

---

## Priority 3 — SimLab juice bottling demo

The ProveIt-style deterministic simulated factory benchmark (`simlab/` +
`tests/simlab/`).

- [ ] Headless sim runs seeded + deterministic (11/11 tests green).
- [ ] Eval harness produces a clean scorecard on the juice bottling line.
- [ ] Demo entry point documented + reproducible from a cold checkout.
- [ ] Smoke check: `simlab` boots on port 8099, golden run matches.

_(Sub-items to be refined when this priority is picked up.)_

---

## Priority 4 — Fault Detective PLC bench

The bench Fault-Detective demo (`plc/`, `docker-compose.fault-detective.yml`).

- [ ] Confirm bench harness is clearly labeled bench-only (not a customer arch).
- [ ] Live Modbus map deployed + verified (no `ILLEGAL_FUNCTION`).
- [ ] Anomaly rules (A2/A7/A12) fire on the seeded fault scenarios.
- [ ] Demo runbook reproducible; bench tools carry BENCH-ONLY banners.

_(Sub-items to be refined when this priority is picked up.)_

---

## Change log

- **2026-06-10** — Checklist created. Quickstart RED #1 verified merged;
  RED #2 + RED #3 implemented on `feat/quickstart-gtm-hardening`.
