# CodeGraph Evaluation — MIRA Repo

**Date:** 2026-06-09 (run on CHARLIE, branch `feat/orchestrator-kg-query`)
**Tool:** `@colbymchenry/codegraph` v0.9.5 (daemon) / CLI same package
**Evaluator:** practical hands-on assessment (not a sales pitch)

---

## TL;DR

| Axis | Grade |
|---|---|
| **Overall** | **B−** (would be A− with the operational fix below) |
| Symbol coverage / lookup | **A** |
| Call-graph accuracy *on a fresh index* | **B+** |
| Call-graph reliability *as actually operated* (incremental watcher) | **D** |
| Staleness / freshness plumbing | **C−** |
| Performance | **A** |

**Coverage score: 9/9 applicable symbols found** (10th, `SimEngine`, is correctly absent — it lives on `feat/simlab-juice-bottling`, not this branch).

**The one-sentence verdict:** CodeGraph's symbol index is excellent and its call-graph genuinely works **when the index is freshly built** — but the **incremental file-watcher sync silently corrupts the call-edge layer over time**, and it corrupts exactly the hot files (`engine.py`) the MIRA rules tell you to trust it on. During this evaluation the *stale* index returned **0 callers** for `resolve_uns_path`; a forced full reindex restored the correct **20 callers**. **Keep the tool; fix how it's kept up to date.**

> **Side effect of this eval:** I ran `codegraph index --force` as test #2 below. The on-disk index is now correct (callers/callees resolve properly through both CLI and the MCP daemon). The corruption described here was the *pre-eval* state.

---

## 1. Is it installed and running?

Yes.

- **MCP config** (`.mcp.json`): `npx -y @colbymchenry/codegraph serve --mcp` — stdio server, wired into every session. ✅
- **Index location:** `.codegraph/codegraph.db` (SQLite, WAL mode, FTS5). Gitignored (`.codegraph/.gitignore`). A daemon (`daemon.pid` → pid 26284, `daemon.sock`) runs a file-watcher.
- **Size:** ~35 MB db (pre-rebuild) → 1,645 files scanned, 1,392 indexed (code files), 21,873 nodes.
- **`sync` works:** `codegraph sync` → "Already up to date" in ~1.25 s. ✅ (But see §4 — `sync` is the incremental path that causes the corruption; it does **not** repair a damaged edge set.)
- **Full reindex:** `codegraph index --force` rebuilt the whole graph in **6.9 s** (1,392 files). Fast enough to run routinely.

### Node/edge inventory (fresh index)
```
Files indexed: 1,392 (1,645 scanned)
Nodes:  21,873   (function 5,861 · import 6,112 · variable 3,393 · constant 963
                  class 842 · method 2,769 · interface 325 · route 69 · type_alias 147)
Edges:  ~41,054  (status count, incl. import + containment + call edges)
Languages: python 870 · typescript 405 · tsx 88 · yaml 253 · javascript 23 · jsx 6
```
Good signal: `.next/standalone` build output is **excluded** (grep finds the symbols there; CodeGraph correctly returns only `src/`).

---

## 2. Coverage test — 10 symbols

| Symbol | Expected file | CodeGraph result | Verdict |
|---|---|---|---|
| `Supervisor` | mira-bots/shared/engine.py:699 | class @ engine.py:699 | ✅ exact |
| `classify_intent` | mira-bots/shared/guardrails.py:777 | function @ :777 + signature | ✅ exact |
| `resolve_uns_path` | mira-bots/shared/uns_resolver.py:767 | function @ :767 (+ 2nd def in mira-mcp/kg_client.py — real) | ✅ exact |
| `InferenceRouter` | mira-bots/shared/inference/router.py:186 | class @ :186 + methods | ✅ exact |
| `check_citation_compliance` | mira-bots/shared/citation_compliance.py:37 | function @ :37 + signature | ✅ exact |
| `withTenantContext` | mira-hub/src/lib/**db.ts** (prompt guess) | function @ **tenant-context.ts:22** | ✅ CodeGraph corrected the path |
| `sessionOr401` | mira-hub/src/lib/*auth* | function @ **session.ts:85** | ✅ exact |
| `SimEngine` | simlab/engine.py (other branch) | **not found** | ✅ correctly absent (not on this branch) |
| `tag_ingest` | mira-relay/tag_ingest.py | file + symbols | ✅ exact |
| `ingest_batch` (relay) | mira-relay/tag_ingest.py:172 | function @ :172 + signature | ✅ exact |

**Score: 9/9 applicable.** Every path and signature matched ground-truth grep exactly (each result landed on the precise line number — proof the index content reflects current source, i.e. content-fresh for these files). CodeGraph even **out-performed the prompt's own guesses** (`withTenantContext` is in `tenant-context.ts`, not `db.ts`).

---

## 3. Accuracy test — callers / callees

This is where it gets interesting, and where the headline finding lives.

### TypeScript: solid and stable ✅
- `withTenantContext` → **20 callers**, every one a real route handler (`GET`/`POST` in `mira-hub/src/app/api/**`). Verified against source.
- `sessionOr401` → **20 callers** (route handlers) + callees `requireSession`, `SessionContext` (both real, internal to session.ts).

### Python: **broke on the stale index, works on a fresh one**

The pre-eval (incrementally-synced) index gave wrong/empty answers. Same queries after `index --force`:

| Symbol | Real callers (grep) | Stale index | Fresh index |
|---|---|---|---|
| `resolve_uns_path` (fn) | ~13 in engine/dialogue_* | **0** ❌ | **20** ✅ (engine.py:1017/1521/3098/3378/3512/4096/4791, dialogue_acts, dialogue_state…) |
| `_should_fire_uns_gate` (method, **unique name**) | `self.…` @ engine.py:1905 | **0** ❌ | **9** ✅ (`process_full` + tests) |
| `_maybe_dispatch_via_dst` (method, **unique name**) | `self.…` @ engine.py:1709 | **0** ❌ | **2** ✅ (`process_full` + test) |
| `_make_result` (method) | 53 `self._make_result` sites | wrong twin only ❌ | engine.py callers ✅ |
| `check_citation_compliance` | called via alias in engine.py | **0** ❌ | (resolves on fresh) |

The unique-named methods are the clean control: no same-name ambiguity is possible, the caller is a plain `self.method()` inside the class, and the *stale* index still returned **0**. After a full rebuild it returns the correct callers. **That isolates the cause to index corruption, not a parser limitation.**

### What is genuinely *not* captured (real limitations, present even on a fresh index)

1. **Class instantiation is not a caller edge.** `Supervisor` returns **0 callers** even on the fresh index, yet grep finds **52** `Supervisor(...)` instantiation sites (telegram/bot.py, gchat/bot.py, ask_api/app.py, many tests). If you ask "what would break if I change `Supervisor`'s constructor," CodeGraph won't tell you.
2. **`impact` on a class returns containment, not dependents.** `codegraph_impact Supervisor` → 73 symbols, **all of them Supervisor's own methods**. That is the *inside* of the class, not the code that depends on it. For a Python class this is the opposite of what "blast radius" should mean. ⚠️ **This directly undercuts the `.claude/rules/codegraph-usage.md` rule that mandates `codegraph_impact` before editing `engine.py`.**
3. **Same-name aggregation can't disambiguate by file.** `callers`/`callees`/`trace` union results across every symbol sharing a name (`process` exists as 13 methods; `__init__`, `complete`, `_make_result`, `resolve_uns_path` all collide). Results are tagged with a "aggregated across N symbols" note but you cannot scope to one definition — so a query about `Supervisor.process` returns callees mixed in from `vision_worker.process`, `rag_worker.process`, etc.
4. **`trace` inherits all of the above.** `trace Supervisor → resolve_uns_path` reported "no direct call path" on the stale index (the path runs through `self`-calls that were corrupted) and is unreliable for class→function flows generally.

---

## 4. Staleness — the core operational problem

- **Index timestamp** (`codegraph.db` mtime): Jun 9 00:25. **Latest commit:** Jun 9 01:01. ~36 min behind, but content-fresh for queried files (exact line matches).
- **Git hooks are NOT wired on this checkout.** `git config core.hooksPath` → `/Users/charlienode/MIRA/.git/hooks`, and `.git/hooks/` contains **only `.sample` files**. The repo ships `.githooks/post-merge` and `.githooks/post-checkout` (both run `codegraph sync`), plus `.githooks/pre-commit` — but **none of them execute**, because `core.hooksPath` doesn't point at `.githooks`. (CLAUDE.md claims `git config core.hooksPath .githooks` is "already set"; that is **not** true on CHARLIE — local config drift.) So the documented merge/checkout auto-sync safety net is off; the *only* thing updating the index is the daemon's file-watcher.
- **The file-watcher is corrupting the call-edge layer.** `daemon.log` shows **264** `FOREIGN KEY constraint failed` errors interleaved with `Auto-synced N file(s)`. An FK failure on edge insert = the edge references a node id that no longer exists after a single-file re-parse → the edge is dropped. `engine.py` is auto-synced repeatedly (it's the hottest file in the tree), so its outgoing call edges get progressively lost — which is exactly the 0-callers symptom in §3. The watcher reports success ("Auto-synced … in 800ms") even when edges silently fail.

**Net effect:** the index drifts toward *more nodes, fewer correct call edges* the longer the daemon runs without a full rebuild. `codegraph status` and `codegraph sync` both report "healthy / up to date" the whole time. There is no signal to the user that the call-graph has degraded.

---

## 5. Performance

| Query | CodeGraph | grep baseline | Notes |
|---|---|---|---|
| `search "rate limit"` | 3 ranked symbols (`_rate_limit` fn, 2 `RATE_LIMIT` consts) | 0.05 s, **102 noisy lines** | CodeGraph far more useful output |
| `context "UNS confirmation gate"` | structured (entry points + related + code) in <1 s | — | but see caveat below |
| `impact Supervisor` | 73 symbols, <1 s | — | fast but semantically wrong (§3.2) |
| full `index --force` | **6.9 s** | — | cheap enough to run on a schedule |

Raw latency: CodeGraph reads are sub-second; on a repo this size **grep is also sub-second**, so CodeGraph's win is **not** raw speed — it's **structured output** (kind + signature + location, ranked) versus 100+ unranked text lines, and multi-hop questions (callers/trace) that would otherwise be many grep+read iterations.

**Caveat on `codegraph_context`:** for "UNS confirmation gate" it surfaced `ConnectorConfirmationGate` (connectors), `GateResult` (quality_gate), and `UNSContext` — but **missed** the actual engine gate methods (`_should_fire_uns_gate`, `_handle_uns_confirmation_request/response`). Because `context`'s "related symbols" expansion leans on the call-graph, the same Python edge corruption degrades `context` relevance for Python tasks too.

---

## 6. CodeGraph vs grep vs Graphify — "what calls `Supervisor`?"

| Tool | Answer | Accurate? |
|---|---|---|
| **CodeGraph** `callers Supervisor` | "No callers found" | ❌ misses all 52 instantiations (class-instantiation blind spot) |
| **grep** `Supervisor(` | 52 hits incl. real instantiation sites (telegram/bot.py, gchat/bot.py, ask_api/app.py, benchmarks, tests) | ✅ but noisy (includes class def + `_FakeSupervisor`) |
| **Graphify** `wiki/orchestrator/kg/graph.json` | 3,697 nodes / 5,635 links, function-level (`shared_engine_supervisor_init`, …) with community detection | partial — product-level KG, not a precise call-graph; regenerated periodically (`built_at_commit`) so it goes stale between bootstraps |

- For *symbol lookup and function-level call edges*, **CodeGraph (fresh) wins** — structured, accurate, auto-updating.
- For *class instantiation* specifically, **grep is the only reliable answer** today.
- **Graphify** is a different artifact: a coarse, product-oriented KG for the orchestrator-pulse routine, not a substitute for a live call-graph. It captures things CodeGraph doesn't model (god nodes, communities) but is stale-by-design (snapshot at a commit). Not a replacement.
- **Things CodeGraph finds that grep can't** (on a fresh index): `self.method()` caller edges across files, function call edges through import aliases, and the multi-hop `callers`/`callees` chains — all of which grep can only approximate with many passes.

---

## 7. Known limitations (summary)

1. **Incremental watcher corrupts call edges** (FK failures) — the #1 practical issue. Silent.
2. **Git sync hooks not wired** on this checkout (`core.hooksPath` ≠ `.githooks`) — removes the merge/checkout repair path.
3. **Class instantiation `ClassName()` is not a caller edge** (Python) — `impact`/`callers` on a class are blind to instantiation sites.
4. **`impact` on a class = containment, not dependents** — misleading for the exact use the MIRA rules mandate.
5. **Same-name aggregation** — no way to scope callers/callees/trace to one definition among same-named symbols.
6. **TypeScript is handled as well as Python** for symbol lookup, and **better** for the call-graph in practice (the tested TS symbols have unique names, module-level callers, and weren't churned by the watcher this session). Monorepo structure (mira-bots / mira-hub / mira-relay / mira-mcp / mira-pipeline / mira-crawler) is indexed fine; `.next` build output correctly excluded.

---

## Recommendation: **KEEP — with a mandatory operational fix**

The tool is genuinely valuable for orientation and symbol lookup (A-grade there) and its call-graph is correct on a fresh index. The problem is purely **operational**: the way the index is kept up to date silently destroys the call-graph. Do not replace it; fix the refresh path.

### Specific actions (in priority order)

1. **Stop trusting the incremental watcher as the sole refresh; schedule a periodic full reindex.** Add a routine (Cowork scheduled task or a cron) that runs `npx -y @colbymchenry/codegraph index --force` — daily, and/or on a `post-merge` to `main`. It's 6.9 s. This is the single highest-leverage fix. Until the FK bug upstream is fixed, **`sync` is not sufficient — only `index --force` repairs a corrupted edge set.**
2. **Wire the git hooks that already exist.** `git config core.hooksPath .githooks` on CHARLIE (and verify on Alpha/Bravo). Then upgrade `.githooks/post-merge` to run `index --force` (not `sync`) when the merge touched many files, so merges repair rather than further corrupt. Note this also re-enables the documented pre-commit code-review hook, which is currently dead here too.
3. **Add a corruption canary.** A 2-line healthcheck — `codegraph callers resolve_uns_path` (or any known-good hot-file symbol) must return ≥1 caller; if it returns 0, the index is corrupt → trigger `index --force` and log a line. Cheap, and it converts a silent failure into a self-healing one. (Mirrors the "lock in chronic ops bugs with a canary" pattern already used in PR #1331.)
4. **Correct `.claude/rules/codegraph-usage.md`** to match reality:
   - The "Trust CodeGraph, don't re-verify" rule is **unsafe for `impact`/`callers`/`trace` on Python classes.** For "what breaks if I change `Supervisor`/`InferenceRouter`/any class," CodeGraph misses instantiation sites — **cross-check class blast-radius with grep `ClassName(`** until upstream adds instantiation edges.
   - Note that `codegraph_impact <Class>` returns the class's own members, not its dependents — use `callers` on the constructor/instantiated name plus grep instead.
5. **Prefer querying by unique symbol names; treat aggregated results skeptically.** When `callers`/`callees` prints "aggregated across N symbols," the result is a union you cannot scope — fall back to grep for the specific file.
6. **File an upstream issue** against `@colbymchenry/codegraph` for (a) the `FOREIGN KEY constraint failed` edge drops during incremental sync, and (b) Python class-instantiation not producing caller edges. v0.9.5.

### What "good" looks like after the fix
With a scheduled `index --force` + a corruption canary, the Python call-graph is accurate (verified this session: `resolve_uns_path` → 20 correct callers, unique methods → correct `self`-callers), and the tool earns an **A−** — the remaining gap being the class-instantiation blind spot, which grep covers.
