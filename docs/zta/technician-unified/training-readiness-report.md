# Training-Readiness Decision — Unified Technician Corpus (2026-07-29)

**Decision: NOT READY to spend. Do not launch a paid fine-tune on the unified compile
yet.** The dataset *builds* — that is not the bar (mission §5). No paid call, training
job, merge, or deploy occurred in this mission.

## What behavior would change (claimed, untested)

The unified compile adds the missing majority class: general technician behavior
(ambiguous identity, incomplete symptoms, safety boundaries, evidence-vs-inference,
next-best measurement, escalation, work-order history, correction acceptance,
cross-trade reasoning) + cross-domain bridge records. v1's evals proved the policy
mechanism transfers (discipline lenses swept on held-out equipment); the open question
is whether general-situation behavior transfers the same way — untested until a run.

## Why not yet — ranked blockers

1. **General-family volume is the bottleneck: the compile is 144 records (80
   general+bridge).** The mixture gates hold (55.6% general, all caps green), but the
   ≥50% law means product data is throttled by the scarce class. One $4 job buys ~8.3M
   tokens; spending it on 144 records repeats the exact under-utilization Plan v2 was
   written to stop. **Fix first:** scale the general family via the proven S4 paraphrase
   machinery (agents write surface text, deterministic gate filters, answer keys stay
   deterministic) to ~500–1,000 general records, then recompile — the caps will then
   admit proportionally more product records too.
2. **No human sitting has reviewed any of it.** 0 decisions on the unified manifest
   (`03874d57…`). The review-by-exception console + independent screening make this a
   1–2 h sitting once the corpus is at full size — but it must happen on the FINAL
   compile, not twice.
3. **Provider stop-gate still red:** packing×completion-loss-mask remains NOT PROVEN
   (`docs/zta/2026-07-28-provider-verification-packing-template.md`); Mike has not
   picked the resolution (pre-tokenized Parquet path recommended). Template identity
   and validation-file support are PROVEN/SUPPORTED.
4. **Two eval slices honestly unfilled** (graph reasoning, task-mode consistency) and
   PrintSense's chat-shaped slice is thin — per-slice regression detection is the whole
   point of the mission's eval bar.
5. **Is retrieval the real bottleneck?** The inventory found the retrieval law
   hand-copied in three dialects, an unbackfilled `verified` column that would zero
   retrieval if the approval gate flips on, and evidence that never fuses with live
   state on the one surface that has both. Some of the behavior we'd train for
   (missing-retrieval honesty, conflicting evidence) is *caused* upstream. Training is
   not blocked by this, but spend should follow the context-assembly fixes, not lead
   them.

## Exact spend picture (when justified)

One LoRA SFT job at Together's $4.00 minimum (est. probe first, $0); two-track+slices
eval ≈ $1.50–2.50 (temp deployment + serverless base). Balance declared 2026-07-28:
$12.21; ~$6.5 unspent. **A separate signed authorization request is required** — the
existing two-key ceremony, fresh single-use authorization, none pre-signed.

## Recommended order

1. Mike reviews this PR (ADR-0033 + contract + compiler + inventory).
2. Scale the general family (S4 paraphrase round, $0) → recompile → ONE sitting on the
   final manifest.
3. Resolve the packing proof (Parquet path or Together support answer).
4. Fill/accept the honest eval-slice gaps; freeze the slice manifest.
5. Then — and only then — the training authorization request, with per-slice
   base-vs-adapter results as the acceptance bar.
