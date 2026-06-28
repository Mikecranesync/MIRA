# CodeGraph Re-Benchmark — after the operational fixes (PR #1869)

**Date:** 2026-06-10 (CHARLIE)
**Tool:** `@colbymchenry/codegraph` v0.9.5 (CLI + MCP daemon)
**Baseline:** `docs/tech-debt/2026-06-09-codegraph-evaluation.md`
**Change under test:** PR #1869 `fix/codegraph-operations` — `core.hooksPath` wired, daily `index --force` launchd job, corruption canary, smarter `post-merge`. (Operational only — no change to CodeGraph itself.)

---

## TL;DR

**The fixes worked for the thing they targeted: the call-graph corruption is gone.** Every Python symbol that returned **0 / wrong** callers on the *stale* index in the original eval now returns the **correct** callers, on both the CLI and the live MCP daemon. The genuine, upstream limitations (class-instantiation, import-alias, same-name aggregation) are unchanged — as expected, since our fix is operational, not a CodeGraph code change.

| Axis | Eval (as operated) | Now (after fixes) |
|---|---|---|
| Symbol coverage | A (9/9) | **A (9/9)** — unchanged |
| Python call-graph **as operated** | **D** (silent corruption, 0 callers) | **A−** (correct + kept fresh by canary/schedule) |
| Staleness / freshness plumbing | C− (hooks dead, watcher-only) | **A−** (hooks wired, daily force-reindex, self-healing canary) |
| Performance | A (6.9 s) | A (9.2 s `index --force`) |

What changed is **not** CodeGraph's accuracy on a fresh index (that was always good) — it's that the index is now **kept** fresh/healed instead of silently degrading.

---

## 1. Coverage (§2 re-run) — 9/9, unchanged

`codegraph query <sym>` → top hit, vs ground-truth:

| Symbol | Result | Verdict |
|---|---|---|
| `Supervisor` | engine.py:699 | ✅ |
| `classify_intent` | guardrails.py:777 | ✅ |
| `resolve_uns_path` | uns_resolver.py:767 | ✅ |
| `InferenceRouter` | inference/router.py:186 | ✅ |
| `check_citation_compliance` | citation_compliance.py:37 | ✅ |
| `withTenantContext` | tenant-context.ts:22 | ✅ |
| `sessionOr401` | session.ts:85 | ✅ |
| `SimEngine` | NOT FOUND | ✅ (other branch) |
| `tag_ingest` | test_tag_ingest.py:23 | ✅ (impl `ingest_batch` ↓ resolves too) |
| `ingest_batch` | tag_ingest.py:172 | ✅ |

---

## 2. Accuracy (§3 re-run) — the headline

`codegraph callers <sym>`, count from the result header. **Stale** column is from the original eval; **Now** is this run.

| Symbol | Real (grep) | Eval: stale | Eval: fresh | **Now (CLI)** | **Now (MCP daemon)** |
|---|---|---|---|---|---|
| `resolve_uns_path` (fn) | ~13–20 | **0** ❌ | 20 | **20** ✅ | **20** ✅ |
| `_should_fire_uns_gate` (unique method) | 9 | **0** ❌ | 9 | **9** ✅ | — |
| `_maybe_dispatch_via_dst` (unique method) | 2 | **0** ❌ | 2 | **2** ✅ | — |
| `_make_result` (method) | many | wrong twin ❌ | engine ✅ | **20** ✅ | — |
| `withTenantContext` (TS) | 20 | 20 | 20 | **20** ✅ | — |
| `sessionOr401` (TS) | 20 | 20 | 20 | **20** ✅ | — |

**Every previously-corrupt Python symbol is now correct.** The unique-named methods (`_should_fire_uns_gate`, `_maybe_dispatch_via_dst`) are the clean control — no same-name ambiguity is possible, so 0→9 and 0→2 isolates the recovery to the index repair, not luck. CLI and the running MCP daemon return identical results, so **sessions see the healed graph**, not just the CLI.

---

## 3. Persistent limitations — unchanged (upstream / not our fix's job)

These returned 0/limited on a **fresh** index in the eval and still do. They are *not* corruption; the operational fix is not expected to touch them.

| Symbol | Now | Why | Tracked |
|---|---|---|---|
| `Supervisor` (class) | **0 callers** | class instantiation `Supervisor(...)` (26 sites/21 files) isn't a caller edge | upstream **#774** |
| `check_citation_compliance` | **0 callers** | called via import alias: `from .citation_compliance import check_citation_compliance as _check_citation_compliance` → `_check_citation_compliance(...)`. Neither the real name nor the alias edges. | **new finding — see correction below** |
| same-name aggregation | banner persists | `callers resolve_uns_path` still notes "Aggregated across 2 symbols" (uns_resolver.py:767 + kg_client.py:84); can't scope to one def | upstream (eval §3.3) |

### Correction to the original eval

The eval's §3 table listed `check_citation_compliance` as "(resolves on fresh)". **That is not correct** — it returns **0** even on a freshly-forced index, because the only call sites use the import-alias `_check_citation_compliance(...)`, and `callers` resolves neither the original name nor the alias. This is a **third, distinct limitation** (call-through-import-alias), separate from #773 (corruption) and #774 (class instantiation). Worth folding into a future upstream note. `grep` remains the fallback for alias-called functions, same as for class instantiation.

---

## 4. Operational loop — verified working

- **`core.hooksPath`** → `.githooks` ✅
- **`index --force`** rebuild: **9.2 s** (eval 6.9 s; same ballpark, cheap to schedule).
- **Canary** after a fresh reindex: `healthy — 20 callers of resolve_uns_path`, **exit 0** ✅
- **Daily launchd job** `com.factorylm.codegraph-reindex` loaded (`launchctl list` shows it; next fire 04:17). Not yet fired at time of writing.
- **`post-merge`** now does sync → canary → self-healing force-reindex, logging to `.codegraph/hook.log`.

The canary converts the silent corruption into a self-healing event, and the daily reindex bounds how far the watcher can drift before it's repaired.

---

## 5. Verdict

The original eval's recommendation — *"Keep the tool; fix how it's kept up to date"* — is validated. After the operational fix:

- the **corruption axis moved D → A−** (correct call-graph, kept fresh);
- coverage and performance are unchanged (A);
- the remaining gaps (class instantiation #774, import-alias, same-name aggregation) are upstream/parser limitations that `grep` covers, exactly as the eval predicted.

**Net: the fix did what it was supposed to.** The only durable risk is the watcher re-corrupting between reindexes — bounded now to ≤24 h by the daily job, and caught immediately on any merge by the canary. If upstream **#773** lands, the daily force-reindex can be relaxed back to plain `sync`.
