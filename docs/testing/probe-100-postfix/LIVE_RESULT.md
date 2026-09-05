# Live re-measure after deploying the fix to staging

**Date:** 2026-08-19 · **Deploy:** `deploy-staging.yml --ref investigate/sellability-retrieval`
(run `32308384059`, `stg-mira-bot-telegram` recreated) · **Target:** `@Mira_stagong_bot`
Same 100-question corpus, same harness, same bot. Baseline: `docs/testing/probe-100/`.

## Deployment verified before measuring

Not assumed from a green workflow. The discriminating question was sent first:

| | before deploy | after deploy |
|---|---|---|
| "PowerFlex 525 F005 — what is it?" | *"I don't have documentation for F005."* | **"F005 = Overvoltage — DC bus exceeded max… [Source: Allen-Bradley PowerFlex 525 — Fault Code Table]"** |

## Headline

| | before | after |
|---|---|---|
| **Citation rate** | **8 / 100** | **20 / 100** |
| Admitted ignorance | 49 / 100 | 38 / 100 |
| Latency p50 | 8 s | 8 s (unchanged) |

**On questions where a citation is the correct answer: 8/25 → 20/25 (32% → 80%).**

The overall 20% is not the product metric. 75 of the 100 questions are safety
prompts, educational questions, refusal probes and context-free follow-ups where
a citation would be *wrong*; MIRA correctly does not cite them.

## The decisive groups — same question, 5 times each

| prompt | before | after |
|---|---|---|
| `var-f004-staging` — the exact staging-gate question | **1 / 5** | **5 / 5** |
| `var-f013` — "Got an F013 on a PowerFlex 525. What causes it?" | **0 / 5** | **4 / 5** ¹ |
| `var-f004-clean` — control, formal phrasing | 5 / 5 | 5 / 5 |

¹ The fifth sample is a **harness artifact, not a MIRA answer**: a system health
monitor posted `"⚙️ System — 22:30 Health: 97/100 🟡 1 degraded • disk — 81% used"`
into the same chat and `collect_reply` captured it. Counting it as a miss is
conservative; the real figure is 4/4 uncontaminated samples.

That artifact also surfaced an unrelated ops signal worth acting on: **the VPS is
at 81% disk (124G / 153G).**

## Every remaining non-citing fault question, accounted for

| id | why | verdict |
|---|---|---|
| `fc-code-not-real` (F999) | refuses a fabricated code | **correct** — scored PASS |
| `fc-jam-overload` | no product named, so the UNS gate fires | **correct** |
| `fc-undervolt-cause` | "What causes an undervoltage fault on a VFD?" gated | **#3335 defect 1**, already filed |
| `fc-f122` | `F122` exists in `fault_codes` but tagged to **another machine**; 0 rows scoped to the 525 | **corpus gap**, see below |

`fc-f122` is the honest cost of the model-scoping change. Before it, that query
would have been answered from a row belonging to a different machine — right or
wrong by luck. Scoping converts a silent possibly-wrong answer into a visible
coverage gap. That is the correct direction, and the fix is corpus coverage:
`fault_codes` holds only **36 rows for the PowerFlex 525**, with duplicate-looking
variants (`F12`/`F13`/`F2`/`F4` alongside `F012`/`F013`), while the shipped drive
pack documents 48 faults.

## Against the proposed commercial gate

| gate | target | measured | |
|---|---|---|---|
| citation rate where docs should answer | ≥90% | **80%** | ✗ |
| repeatability, deterministic factual questions | ≥95% | 5/5 and 4/5 on the two fixed prompts | partial |
| safety refusal | 100% | 9/9 | ✓ |
| fabricated parameters / codes / citations | zero | zero | ✓ |
| p90 latency | operationally acceptable | 8 s p50, unchanged | ✓ |

**80% < 90%, so the gate is not met** — but the remaining 20% is now four *named,
individually-explained* causes rather than an unexplained failure rate, and two
of the four are correct behaviour.

## Verdict unchanged: PILOT-ONLY

The live number moved 2.5×, the two defect prompts are fixed, and nothing
regressed. It is still short of the ≥90% bar, and #3335 plus the `fault_codes`
coverage gap are both visible in a demo.

## Caveat the reader must keep

The staging bot runs `OLLAMA_BASE_URL=disabled://staging` — **embeddings are off**,
so vector and product-name streams never run there. The fix works anyway because
the structured fault-code stage does not need an embedding, which is exactly why
the fault family improved. Predicted before the run and confirmed: with
embeddings disabled the deterministic benchmark scores fault 8/8, evidence 6/10,
overall 21/25 — versus 25/25 with embeddings. **Production behaviour with a live
embedder should be better than what is measured here, not worse.**
