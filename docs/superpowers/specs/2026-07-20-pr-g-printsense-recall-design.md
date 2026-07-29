# PR G — Recall-gate the paid PrintSense `interpret_print` call

**Date:** 2026-07-20
**Status:** Approved (design), implementing
**Base:** `main` @ `0bd50b6ed` (VERSION 3.182.4) — the Materialized Evidence ladder (PRs A–F).
**Branch:** `feat/pr-g-printsense-recall`

## Context

The Materialized Evidence & Recall-First amendment (PRs A–F) shipped the pure
contract/registry/resolver/invalidation layer in `materialized_evidence/`. It is
**runtime-inert** — nothing in the app imports it. This is the first runtime
integration ("PR G").

Two facts drive the design:

1. **`materialized_evidence.resolve_recall(query, registry)` returns a *decision*,
   not a payload** (`EXACT` / `PARTIAL` / `NONE` / `STALE` / `CONFLICTING`). The
   registry stores **manifests** (metadata + economics + lineage); the actual
   payload lives at `manifest.storage_ref`. The shipped `InMemoryRegistry` is
   hermetic — it does **not** survive a process exit, so it gives zero cross-run
   recall.
2. **PrintSense already has an *informal* version of recall.** `printsense/cas.py`
   has a versioned derivation cache (`cache_get/put(source_sha, stage, version)`)
   that `package_pipeline.run_stage()` uses. But the one genuinely expensive call
   — the **paid frontier-vision** `interpret_print()` (~$0.36/call) — is invoked
   **directly by `printsense/cli.py` with no recall at all.** Identical print →
   pay the model again every time.

So PR G proves the formal layer where it matters most: a **formal, typed, durable
recall gate around the paid `interpret_print` call.**

## Goal / non-goals

**Goal:** an identical print (same page bytes + same model/prompt/producer version)
is interpreted **once**, materialized as a typed `EvidenceManifest` (cost + trust +
lineage), stored durably, and **recalled thereafter with no model call.**

**Non-goals (deliberately out of scope):**
- No Neon backend, no Temporal, no approval-mutation surface (those were explicitly
  out of the A–F ladder and stay out).
- No change to `interpret_print`'s prompt behavior (the "two-tier" follow-up).
- No wiring of the Telegram / engine production path — CLI only, as the clean
  first proof.
- Opt-in, **default OFF** — existing users see zero behavior change.

## Decisions (locked with Mike, 2026-07-20)

1. **Target:** recall-gate the paid `interpret_print` call.
2. **Backend:** a durable **file/JSON-snapshot registry** that reuses the tested
   `InMemoryRegistry` query logic; PrintSynthGraph payloads live in
   `printsense/cas.py`'s content-addressed store. (Neon is the later
   concurrent-safe backend.)
3. **Recall key excludes the technician `--question`** — the PrintSynthGraph is a
   complete, question-independent interpretation, reused across questions. (The
   resolver has no per-question gate, so this is also the cleanest contract fit.)

## Architecture (all additive — the pure A–F logic is untouched)

```
materialized_evidence/
  backends/
    __init__.py          NEW  exports FileRegistry
    serialization.py     NEW  manifest_from_dict / overlay_from_dict / overlay_to_dict
    file_registry.py     NEW  FileRegistry(InMemoryRegistry) + atomic JSON snapshot
  schema.py              +1   DatasetType.PRINT_INTERPRETATION = "PrintInterpretationEvidence"
printsense/
  recall.py              NEW  interpret_print_with_recall()  ← the bridge
  cli.py                 edit --recall / --recall-store flags, branch the one call (default OFF)
```

Separation: the **file registry is generic** (the "later concrete backend"
`registry.py`'s docstring anticipates — reusable by any consumer). The
**print-specific logic** (hash pages, build the print manifest, call
`interpret_print` on a miss) lives entirely in `printsense/recall.py`.

## Data flow

```
interpret_print_with_recall(pages, *, registry, cas, tenant_id, environment,
                            question, model, preprocess, interpret_fn):

  page_hashes      = sorted(sha256(raw_bytes) for each page)     # raw input bytes
  producer_version = f"{PROVIDER}|{model}|pp={int(preprocess)}|v1"   # NOT the question
  schema_version   = sha256(canonical PrintSynthGraph.model_json_schema())[:12]

  q = RecallQuery(tenant_id, PRINT_INTERPRETATION, source_hashes=page_hashes,
                  required_schema=("PrintSynthGraph", schema_version),
                  allowed_producer_versions=[producer_version], environment)
  r = resolve_recall(q, registry)

  r.outcome == EXACT → load graph JSON from manifest.storage_ref via CAS → return   ★ no model call
  else               → t0; graph = interpret_fn(pages, question, model, preprocess); compute_ms
                       _materialize(graph, …)   # cas.put + manifest + register
                       return graph
```

### Materialization mechanics (exact)

- `content_hash` in `materialized_evidence.hashing` hashes a **list of
  `EvidenceRecord`s** (sorted by `record_id`). So the graph is wrapped as **one
  `EvidenceRecord`** whose `payload` is `graph.model_dump()`.
- Payload bytes → `CAS.put(graph_json, "printsynth")` → `cas_key`;
  `storage_ref = f"printsense-cas:printsynth:{cas_key}"`.
- Compute `ch = content_hash([record])` **first**, then
  `dataset_version_id = f"{dataset_id}@{ch[:12]}"`, build the manifest with that
  final id, and only then `with_hashes(m, [record])` — so `manifest_hash` is
  stamped over the final id (Gate 6 integrity check `manifest_hash(m) ==
  m.manifest_hash` passes). No re-stamp.
- `dataset_id = sha256(page_hashes + producer_version + schema_name)[:16]` —
  fully deterministic, no RNG. Re-materializing identical output is idempotent
  (`register` is idempotent on the same `manifest_hash`).
- **Economics (no fabricated numbers):** `compute_time_ms` measured with
  `time.perf_counter()` around the real call; `model_input/output_units` from
  `interpret.pop_last_usage()`; `provider_cost_usd` only if a rate is configured
  (env), else `None`. On a hit, the recalled manifest's `compute_time_ms` /
  token counts / cost = exactly what was avoided (logged
  `PRINT_RECALL_HIT avoided_compute_ms=… avoided_cost_usd=…`).
- **Model lineage:** when `pop_last_usage()` reports a provider, set
  `model_provider` / `model_id` / `prompt_contract_version="printsynth-system-v1"`
  (validator rule 6). In tests (mocked interpret, no usage) `model_provider` is
  `None`, so the rule doesn't fire and recall still keys on
  source + producer_version + schema.

## Durable registry design

`FileRegistry(InMemoryRegistry)`:
- `__init__(snapshot_path)` → `super().__init__()` then hydrate `_manifests` /
  `_overlays` from the JSON snapshot if it exists.
- Overrides **only** `register` / `mark_stale` to call `super()` then atomically
  rewrite the snapshot (`tmp` + `os.replace`, matching `cas.py`'s write idiom).
- All reads (`find` / `get` / `effective_stale_state` / `downstream_of` /
  `lineage`) inherited unchanged.

`serialization.py` — the one piece of genuinely new fiddly logic:
- `manifest_from_dict(d)`: filter to `dataclasses.fields(EvidenceManifest)`, coerce
  the six enum fields (`dataset_type`, `environment`, `stage_status`,
  `trust_status`, `approval_status`, `stale_state`) back from `.value` strings,
  and coerce `time_range` list → tuple. `EvidenceManifest.to_dict()` is the
  serializer.
- `overlay_from_dict` / `overlay_to_dict` (StatusOverlay has a `stale_state`
  enum; reuse `schema._enum_safe` for the to-dict side).
- **Locked by a round-trip test:** `manifest_from_dict(m.to_dict()) == m` (frozen
  dataclass equality), enums come back as `Enum` instances, `time_range` as a
  `tuple`.

## Error handling — the non-negotiable

The recall wrapper is an **optimization, never a new failure mode** (the
fast-path-optimization rule: read-only, reuses seams, falls through on any error):
- Recall **lookup** raises → log, fall through to the compute path.
- **Materialize** raises → log, return the computed graph uncached.
- A recall bug can **never** break a print interpretation. Verified by a
  fall-through test (a registry that raises → wrapper still returns a valid graph).

## Testing — $0, no paid inference

Building and validating PR G makes **zero model calls** (recall's whole point):
1. **Serialization round-trip** — `manifest_from_dict(to_dict) == m`; enums/tuple coerced.
2. **Registry durability** — register in one `FileRegistry`, construct a fresh one
   from the same snapshot, `get`/`find` still return the manifest; `mark_stale`
   persists.
3. **End-to-end recall** — register in `r1`, `resolve_recall` in a fresh `r2` → `EXACT`.
4. **Recall hit** — call the bridge twice with a **fake** `interpret_fn`; assert it
   is invoked **once** (2nd is a hit) and the graphs are identical.
5. **Correct recompute** — changed page bytes / model / schema_version → non-EXACT
   → recompute.
6. **Fall-through** — a registry that raises → the bridge still returns a valid graph.
7. **CLI** — `main([img, "--recall", "--recall-store", tmp])` twice with the paid
   boundary mocked → one model call, second run reports a hit, exit 0.

Runner: `PYTHONUTF8=1 PYTHONPATH=<wt-me> <venv>/python.exe -m pytest`.

## Scope boundaries & follow-ups

- **Default OFF** opt-in flag; flip to default-on later once proven.
- Single-writer snapshot — fine because the print path runs serially (photo-batch
  concurrency=1). Neon is the concurrent-safe follow-up.
- Follow-ups (not this PR): two-tier question-neutral prompt; Telegram/engine path;
  Neon backend; recall-savings rollup (PR K economics).

## Workspace / process

- Implemented in the isolated `wt-me` worktree on `feat/pr-g-printsense-recall`
  off `main`. The foreign `codex/dogfood-useful-work` primary checkout is never
  touched.
- Conventional commits (`feat(materialized-evidence)`, `feat(printsense)`),
  `/VERSION` bump + `docs/CHANGELOG.md` note (repo-enforced by `version-gate.yml`).
- CodeGraph note: the target package (`materialized_evidence/`) is not in the
  indexed primary checkout, and all source was read directly from `main`, so the
  call-graph index adds nothing here — no reliance on it.
