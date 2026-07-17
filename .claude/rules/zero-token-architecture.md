# Zero-Token Architecture (the spend law)

**"Infer once, export, and run without inference."** Use a model at build time to discover
a stable procedure; export it as a versioned, tested, deterministic artifact (code, data,
config, or cache); run the artifact with zero tokens; reopen inference only when the
procedure's requirements actually change. Source: Kelsey Hightower, PlatformCon 2026 —
research note `docs/research/2026-07-16-kelsey-hightower-zero-token-architecture.md`.
Evidence this matters here: `docs/research/2026-07-17-printsense-inference-burn-study.md`
(~$10 of gpt-5.5 credit consumed in one night, ~90% reasoning-output tokens).

## Hard Rule 1 — Paid inference is a validation instrument, never a development tool

Owner directive (Mike, 2026-07-17): *"inference should only go to test the item being
developed for ZTA, never used for other things; use Claude to fix any developmental
issues."*

- Metered paid inference (gpt-5.5 or any $-billed model) runs ONLY as the bounded
  acceptance test of the artifact currently being developed or promoted — a phase gate, a
  calibration decision, a qualification run.
- Every paid lane declares a dollar budget BEFORE it runs and hard-stops at the budget.
- Debugging, iterating, exploring, and fixing are Claude's job (the coding agent, already
  paid for), done against hermetic fixtures and the deterministic spine. If a development
  question seems to need a paid call, a fixture is missing — build the fixture.
- Re-validation on UNCHANGED inputs is banned. Frozen evidence (sha256 truth sets) and
  content-addressed interpretation artifacts stand until an invalidation trigger fires.
- Free-tier cascade calls are not dollar-metered but follow the same discipline below;
  they are the product runtime, not a dev crutch.

## Hard Rule 2 — The 5-question decision rule

Any PR that adds (or knowingly keeps) a runtime LLM call must be able to answer:

1. What varies on each invocation?
2. What part of the reasoning is actually stable?
3. Can the stable part become code, data, configuration, or a cache?
4. Can we test it well enough to trust repeated execution?
5. What exact change invalidates it and reopens inference?

If the stable part has concrete answers, promote it to a deterministic artifact. If the
call is genuinely perception or novel synthesis (reading a NEW print photo, a novel
diagnosis turn), runtime inference is doing real work — keep it, and say so. The honest
default is **hybrid**: deterministic common path, explicit inference fallback — the same
shape `.claude/rules/fast-path-optimization.md` already enforces for bot adapters.

## Hard Rule 3 — Exported artifacts pass the same gates as human code

"Generated" is not "compiled," and "compiled" is not "correct." Every promoted artifact
needs: a narrow input/output contract, representative cases + edge cases, hermetic tests,
human approval proportional to risk, versioning, and a DECLARED invalidation trigger
(model/effort/prompt/schema version, source-doc change, threshold change). Never weaken
truth to make something deterministic — a judge may explain a failure, never clear one.

## Exemplars already in-repo (teach by pointing)

- `printsense/designations/` — 9-module deterministic decoding engine (lexer→semantics,
  `contact_markings.classify`).
- `printsense/xref_extractor.py` — deterministic cross-sheet chains; 3/3 on the real
  corpus where every vision model scored 0.
- Frozen sha256 graders/cases across `printsense/benchmarks/` — zero-token truth.
- `is_print_question` signal logic (#2760) — phrase-whitelist inference-shaped problem
  exported as deterministic routing, 34%→100% recall.
- Effort ladder → `PRINT_VISION_EFFORT=medium` (#2764) — build-time inference exported as
  a config artifact; permanent ~3× cost/latency cut.
- A0–A12 in-gateway anomaly rules; drive packs (data-not-code); distillation flywheel.

**Counter-example (the gap):** Phase-3 finding — a ~$0.15–0.50 interpretation package is
produced per album, then discarded; follow-ups re-infer. The fix (CAS-keyed interpretation
artifacts) is backlog item ZTA-3 in `docs/plans/2026-07-17-zero-token-audit-backlog.md`.

## When this applies

- Any PR touching a runtime LLM/vision/embedding call site (see the seam inventory in the
  audit backlog), any new paid lane, any bench that spends dollars, any feature whose
  reasoning repeats across invocations.

## When this does NOT apply

- Genuine perception/novel synthesis at runtime (a new photo, a novel technician turn) —
  keep inference, subject to Rules 1 and 3.
- One-off research with no stable loop to export.
- Claude Code sessions themselves (development reasoning is the tool working as intended).

## Anti-patterns

- ❌ A paid call inside a dev/debug loop ("just to see what it says") — build the fixture.
- ❌ A paid lane with no `--budget-usd`-style bound or with only a call-count bound.
- ❌ Re-running a paid sweep on unchanged inputs for reassurance.
- ❌ A cache without an invalidation rule (staleness is the failure mode).
- ❌ Weakening a grader/threshold so a deterministic path can "pass" — truth first.
- ❌ Cost-invisible spend: a paid provider absent from the bench cost table
  (`_COST_PER_MTOK`) so envelopes print est-$0 while burning.

## Cross-references

- `docs/research/2026-07-16-kelsey-hightower-zero-token-architecture.md` — the source.
- `docs/research/2026-07-17-printsense-inference-burn-study.md` — the evidence + price list.
- `docs/plans/2026-07-17-zero-token-audit-backlog.md` — seam inventory + build backlog.
- `.claude/rules/fast-path-optimization.md` — the hybrid pattern at the adapter layer.
- `.claude/rules/karpathy-principles.md` — evidence beats assertion; simplicity first.
