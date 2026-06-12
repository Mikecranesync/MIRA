# MIRA Beta Readiness — Audit Lenses

**Updated:** 2026-06-09 (autonomous BRAVO session)
**Gate:** A stranger uploads their own equipment manual, asks a real troubleshooting
question, and gets a grounded answer with citations from that manual — with zero
manual fixing. Tracked by `tests/beta/beta_ready_upload_retrieval_citation.py`
(xfail, env-driven) and `docs/plans/2026-06-07-path-to-beta.md`.

Each lens is **RED** (gate flow broken) / **YELLOW** (works, rough edges) /
**GREEN** (solid). Findings carry `[severity]` and `[beta-path: yes/no]`. Every
non-obvious claim was corroborated against current `main` — false positives are
called out explicitly, because an audit that ships unverified findings is worse
than no audit.

---

## Lens A — The gate path itself: **GREEN (code-complete), env-gated to flip the test**

The literal gate test is `xfail(strict=True)` and **environment-driven**: it
flips green only when an operator points `BETA_GATE_UPLOAD_URL` /
`BETA_GATE_CHAT_URL` / `BETA_GATE_TENANT` / `BETA_GATE_API_KEY` at a **dev or
staging** surface (never prod) and the gap is closed. Without that env it records
the expected xfail. So "flip the gate green" is **not autonomously achievable** —
it needs operator-provisioned dev/staging endpoints + secrets.

What an autonomous session *can* prove — and did — is that the **code path is
complete end-to-end**:

| Stage | Symbol | File:line | Verified |
|---|---|---|---|
| Upload (node-attach door) | `POST /api/namespace/node/[id]/files` → `ingestPdfToNode` | `mira-hub/src/lib/node-knowledge-ingest.ts:60` | ✅ writes `knowledge_entries` `ingest_route='v2'`, `metadata.node_id`, generated `content_tsv` (lines 105–130) |
| Retrieval (read side) | `retrieveNodeChunks` | `mira-hub/src/lib/manual-rag.ts:154` | ✅ `SELECT … FROM knowledge_entries WHERE ingest_route='v2' AND metadata->>'node_id' = ANY(...)` BM25 ranked |
| Citation | `buildGroundedContext` / `appendManualContext` | `mira-hub/src/lib/manual-rag.ts:194` | ✅ numbers chunks `[n]` for the model to cite |
| Wiring | NodeChat route calls retrieve + append | `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:262,284` | ✅ |

**Write side and read side match** (`ingest_route='v2'` + `metadata.node_id` on
both). PR #1592 (`folder = brain`) closed the node-attach door; PR #1807
(`lane/upload-retrieval-gate`, open) hardens natural-question BM25 + makes the
gate harness speak NodeChat.

**Owed to operator to actually flip the gate test:**
1. A dev/staging Hub URL with the node-attach upload + NodeChat reachable.
2. `BETA_GATE_*` env vars (upload URL, chat URL, tenant uuid, api key) set against it.
3. Then run `pytest tests/beta/beta_ready_upload_retrieval_citation.py -v` — when it
   PASSES, the strict-xfail flips the suite RED, which is the signal to remove the
   marker and declare the gate met.

---

## Lens B — Hub functional readiness (#1825): **YELLOW**

Gate flow exists and is wired (signup → onboarding wizard → node create → attach
PDF → NodeChat cited answer). Blockers are build/dependency state and one
governance pattern, **not** gate logic.

| Sev | Beta-path | Finding | File:line | Note / fix |
|---|---|---|---|---|
| P1 | no | ADR-0017 not honored: proposal decision does raw `UPDATE … SET status` / `SET approval_state` instead of a `proposal-transition` helper (which doesn't exist yet) | `mira-hub/src/app/api/proposals/[id]/decide/route.ts:92–100,136–144` | Real debt. Needs the helper built first (`mira-hub/lib/proposal-transition.ts`) — that's a **decision + build**, not a 1-line fix. Log, don't rush. |
| P2 | no | Health/readiness endpoint recomputes per request (no cache) | `mira-hub/src/app/api/readiness/route.ts` | Fine for beta demo; cache later. |
| P3 | no | `tsc --noEmit` shows ~60 errors, **mostly Next.js auto-generated `.next/.../validator.ts` internal-type noise**; a couple real (`withTenantContext` callback generic typing in node `files/route.ts`) | `mira-hub/.next/...`, `files/route.ts:57,123,159` | Largely build-state, not regressions. `skipLibCheck` / `npm run build` in CI is the real signal. |

**Corrected false alarms (verified against main):**
- ❌ "missing `unpdf` module / build fails" — **local `node_modules` state**, not a
  code bug. `npm ci` resolves. The package-lock sync is owned by PR #1820 / #1855.
- ❌ "onboarding wizard endpoints not found / progress not persisted" — **they
  exist**: `mira-hub/src/app/api/wizard/[step]/route.ts` (the `[step]` dynamic
  segment handles `company`/`site`/`line`/`finish`); onboarding page GETs saved
  state (`page.tsx:59`) and POSTs each step (`:91`) + finish (`:110`). Persistence
  is wired. Not a blocker.

---

## Lens C — Engine integrity (#1826): **GREEN on citation + gate enforcement**

The two "citation bypass" P1s flagged by the first-pass audit are **false
positives** — refuted by the engine's central enforcement architecture.

**The H4 citation enforcer is a central wrapper, not a per-branch call.**
`process()` runs:
```
result = await process_full(...)             # ALL FSM branches return reply into result["reply"]
reply  = await _apply_quality_gate(..., result["reply"], ...)   # engine.py:1190
reply  = await _enforce_citation_rewrite(reply, ...)            # engine.py:1201 (#1659, merged PR #1840)
reply  = enforce_citation_or_gap_admission(reply)              # engine.py:1209  ← every reply passes here
```
ELECTRICAL_PRINT (`engine.py:2249`) and session-followup (`engine.py:3430`) return
their reply **into `result["reply"]` inside `process_full`**, which then flows
through 1190→1209. The `_check_citation_compliance()` calls at 2593/3423 are
*additional observational logging* inside those branches — not the enforcement
point the first-pass audit mistook them for.

**Production confirmation:** the only direct `process_full()` callers are tests;
every adapter (`mira-pipeline/main.py:659`, `mira-pipeline/ignition_chat.py:481`)
calls `engine.process()` → the 1209 enforcer. So **every production reply is
citation-enforced**.

| Sev | Beta-path | Finding | File:line | Verdict |
|---|---|---|---|---|
| — | — | ELECTRICAL_PRINT "uncited bypass" | `engine.py:2249` | **FALSE POSITIVE** — flows through central enforcer at 1209 |
| — | — | session-followup "missing H4" | `engine.py:3430` | **FALSE POSITIVE** — flows through central enforcer at 1209 |
| P3 | no | Engine doesn't itself reject a `source="direct_connection"` turn lacking a `uns_path` — rejection lives at the `ignition_chat.py` endpoint (PR #1844) | `engine.py:5361–5404` | Real but **not yet needed**: Ignition (only live direct surface) rejects at the endpoint. A *new* direct surface must carry its own reject. Defensive engine-level guard is a nice-to-have, not a blocker. |

UNS chat-gate correctly fires (confidence>0, `_should_fire_uns_gate`) and correctly
skips for `source="direct_connection"` (`engine.py:5396`). Groundedness scoring +
low-groundedness episode tracking intact on the RAG path.

---

## Lens D — Eval & test health (#1827): **YELLOW — safety is clean; FSM/retrieval eval cluster needs live-key verification**

**Premise correction (eval health is NOT declining):** the issue cites a single
"46/57 (81%)". In reality the offline scorecard **oscillates 38–50/57 across
recent nights** under live-inference variance — it is not a fixed number:
- 2026-06-08 → **50/57** (`tests/eval/runs/2026-06-08T0229-offline-text.md`, per #1788)
- 2026-06-09 → **48/57** (latest reported; `2026-06-09T0045-offline-text.md`, per #1843)
- 2026-06-04 → 38/57 (`2026-06-04T1221-offline-text.md`, the low end)

So the **latest reported pass rate is 48/57** — ~the same band as the issue's 46/57,
i.e. normal oscillation, **not a regression**. (Local `main` tree only has runs
through 2026-06-04 committed; the 06-08/06-09 numbers are the authoritative ones in
#1788/#1843.)

**Safety-keyword question — ANSWERED: no real gap.** The "4 safety failures" from
the adversarial-review triage were **LLM-router false positives** (the
`conversation_router.safety_concern` path firing `SAFETY_ALERT` on fixtures with no
safety keywords), **not** missed escalations. Already fixed (commits f59bce64 /
e97fa8b3, merged 2026-06-09). The deterministic detector is sound:
- `tests/test_safety_coverage.py` — **94/94 pass** (all SAFETY_KEYWORDS + educational-bypass + hot-work + routine-non-safety).
- `mira-bots/tests/test_conversation_router_sanitize.py` — router PII-sanitizes before POST.

| Cluster | Count | Beta-blocking | Example fixtures |
|---|---|---|---|
| FSM stuck at `AWAITING_UNS_CONFIRMATION` | ~5–13 | **yes** (gate-adjacent) | `vague_opener_05`, `asset_change_08`, `abbreviation_heavy_10` |
| Manual-doc retrieval stuck in `ASSET_IDENTIFIED` (no doc + no IDLE) | ~5 | **yes** | `vfd_danfoss_02_aqua_drive_manual`, `vfd_siemens_02_micromaster_manual` |
| Vendor/model keyword miss in final reply | ~8 | **yes** (citation-adjacent) | `yaskawa_out_of_kb_04`, `danfoss` (missing `FC 202`) |
| Stale fixture assertions / classifier variance | ~4 | no | `pf520_hw_overcurrent_17` (forbidden-kw), `yaskawa_a1000_ov_23` |

**Why these aren't clean autonomous fixes:** the failures are **stochastic**
(50–67% oscillation under live inference) and require an offline-eval run **with
live provider keys** to verify any fix doesn't regress the rest. Per
`.claude/rules/session-discipline.md §2` (regression-recheck) and
`debugging-conventions.md`, claiming a fix without a full before/after eval run
would be evidence-free. These are **operator/daytime work with the eval harness**,
not a one-shot autonomous PR. Recommend: triage `vfd_danfoss_02` / `micromaster`
(manual-doc-stuck) first — that cluster is closest to the gate.

---

## Lens F — Beta-blocker ledger (#1829): ranked top blockers

Each has an exact next action. "Owned" = an open PR or session already on it.

| # | Blocker | Sev | Next action (exact) | Owner |
|---|---|---|---|---|
| 1 | Gate test can't be flipped without dev/staging env | P0* | Provision dev/staging Hub + set `BETA_GATE_*`, run the gate test | **operator** (env/secrets) |
| 2 | E2E smoke red on main (`npm ci` package-lock `mnemonist`) | P0 | Merge **PR #1855** (`fix/ci-smoke-bun-install`) + **#1820** (lockfile sync) | owned (#1855/#1820) |
| 3 | Natural-question BM25 retrieval hardening + gate harness speaks NodeChat | P1 | Review/merge **PR #1807** (`lane/upload-retrieval-gate`) | owned (#1807) |
| 4 | Eval: manual-doc retrieval stuck (`ASSET_IDENTIFIED`, no doc/IDLE) | P1 | Repro `vfd_danfoss_02_aqua_drive_manual` with live keys; fix doc-fetch→IDLE transition; full eval re-run | daytime + eval harness |
| 5 | Eval: FSM stuck at `AWAITING_UNS_CONFIRMATION` (~5 cases) | P1 | Repro `vague_opener_05`; check confirmation routing/fallback; full eval re-run | daytime + eval harness |
| 6 | Blind upload doors still OW-KB-only (#1806) | P1 | **Design decision** (wire-to-v2-via-inbox-node vs deprecate) — see #1806 | **operator decision** |
| 7 | ADR-0017 proposal-transition helper missing; raw `UPDATE SET status` | P2 | Build `mira-hub/lib/proposal-transition.ts`, refactor `proposals/[id]/decide` | decision + build |
| 8 | `test_photo_query_embeds_with_asset_context` red on main (#1786 re-regressed) | P2 | Re-fix the photo-embed asset-context fallback | unowned (separate issue) |
| 9 | Engine-level direct-connection reject guard (defense-in-depth) | P3 | Add `uns_required` reject in engine when `source=direct_connection` & no `uns_path` | nice-to-have |
| 10 | #961 P0 500 on `GET /api/uploads/` | P3 | **Stale** — handler now exists (401/503/200, not 500). Recommend close-with-evidence | recommend close |

`P0*` = release-gating but operator-only (not a code fix).

---

## What this session changed

- Verified the gate code path is complete end-to-end (Lens A).
- Refuted two engine "citation bypass" P1s as false positives (Lens C) — saved an
  unnecessary edit to the most sensitive shared module.
- Corrected the scorecard premise: eval health oscillates 38–50/57 (latest
  reported 48/57, 2026-06-09) — **not declining**; and spot-confirmed safety has
  **no real gap** (`tests/test_safety_coverage.py` 94/94; fix commits
  f59bce64/e97fa8b3 verified to exist) (Lens D).
- Confirmed onboarding persistence + the blind-door reality (#1806 needs a
  decision, not a wire).
- Produced this ledger (Lens F).

No engine/RAG/classifier code was changed — the audits surfaced no clean,
offline-verifiable, surgical beta-path fix that isn't already owned by an open PR,
a design decision, or a live-eval task. That is the honest outcome; the durable
deliverable is this readiness map.
