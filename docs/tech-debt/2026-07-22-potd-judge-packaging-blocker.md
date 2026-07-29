# POTD judge packaging — production-activation blocker (2026-07-22)

**Status:** BLOCKER for POTD production activation. Investigated as part of the
dense-sheet robustness PR; **not fixed in that PR** (see "Why not fixed here").
The missing judge is now a **non-silent** degraded signal, not a quiet downgrade.

## Finding

The independent free-cascade judge does not run inside the POTD container. Every
containerized run in the 2026-07-22 benchmark recorded:

```
judge_error: "InferenceRouter unavailable: No module named 'shared'"
```

Root cause (verified, not assumed):

* `tools/internet_print_test/judge.py` imports the judge model via
  `from shared.inference.router import InferenceRouter` (line ~114).
* `tools/print_of_day/Dockerfile` COPYs `printsense/`, `factorylm_ai/`,
  `config/providers/`, `materialized_evidence/`, `tools/internet_print_test/`,
  `tools/print_of_day/`, `tools/canary_fixtures/`, `VERSION` — but **not**
  `mira-bots/shared/`. So `import shared` fails and the judge falls back.

## Is packaging feasible? Yes — the import closure is small

`mira-bots/shared/inference/router.py` imports **only** stdlib + `httpx` + `yaml`
(both already installed in the image), and `mira-bots/shared/__init__.py` /
`mira-bots/shared/inference/__init__.py` are empty. So the *code* closure to make
`import shared.inference.router` resolve is three files:

```
mira-bots/shared/__init__.py
mira-bots/shared/inference/__init__.py
mira-bots/shared/inference/router.py
```

A minimal Dockerfile change would be roughly:

```dockerfile
COPY mira-bots/shared/__init__.py                 ./shared/__init__.py
COPY mira-bots/shared/inference/__init__.py       ./shared/inference/__init__.py
COPY mira-bots/shared/inference/router.py         ./shared/inference/router.py
# WORKDIR /app is already on sys.path[0], so `import shared` resolves.
```

## Why not fixed in this PR

Making the judge **actually run** (not merely import) needs three things that are
out of scope for a hermetic robustness PR that must not touch live inference,
staging, or deployment:

1. **A container rebuild** to verify the COPY + import closure resolves at
   runtime, and that `InferenceRouter()` does not read a config file the image
   lacks (it imports `yaml`; its provider-config load path must be verified in
   the container, not assumed).
2. **Free-cascade provider keys** (`GROQ_API_KEY` / `CEREBRAS_API_KEY` /
   `TOGETHERAI_API_KEY`) present in the container env — otherwise the judge
   returns `"InferenceRouter not enabled (no provider keys in env)"`. That is a
   staging/prod Doppler activation concern, not a code change.
3. **A live judge call** to prove end-to-end behavior — which is exactly what
   this PR's directive forbids (no live inference / no deployment).

Coupling the POTD image to `mira-bots/shared` also widens the container's
dependency surface; doing it *without* verifying the runtime closure and image
build would trade one silent gap for a subtler one.

## What this PR does instead (non-silent)

* The missing/errored judge is recorded as an explicit **`judge_unavailable`**
  entry in the manifest's `degraded` list (`tools/print_of_day/run.py`).
* `judge_ok=false` **blocks `gold_candidate`** in the three-state eligibility
  (`printsense/print_of_day/eligibility.py`) — a run with no independent judge
  can never be an automatic gold candidate; a human must review.

So the judge's absence is visible and consequential, never a quiet downgrade.

## Recommended activation path (when POTD goes to production)

1. **Option A (preferred):** COPY the three-file `shared` subset + confirm
   `import shared.inference.router` resolves in a rebuilt image; verify
   `InferenceRouter()` init has no missing config-file dependency; provide the
   free-cascade keys via `factorylm/stg` → `factorylm/prd`; run one staging judge
   call under a declared budget to confirm `judge_independence` is recorded.
2. **Option B:** extract a minimal free-cascade judge client into `printsense/`
   with no `mira-bots/shared` dependency. More code, but no cross-package image
   coupling.

Until one of these ships and is verified live, POTD must not auto-promote gold —
which the eligibility gate now enforces.

## Cross-references

* `docs/benchmarks/2026-07-22-potd-downloads-benchmark.md` — where the gap surfaced.
* `printsense/print_of_day/eligibility.py` — the gate that blocks gold on a missing judge.
* `tools/print_of_day/run.py` — records `judge_unavailable` in `degraded`.
* `tools/print_of_day/Dockerfile` — the image that would carry the COPY.
