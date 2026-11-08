# JEV + Decisions API: expansion map (brief for Claude)

Repo: Mikecranesync/MIRA. Inspected at main `3e093430`. Main has since moved to `ac9579c8` after #4861 merged.
Sellable path: mira-mobile → Hub `POST /api/equipment-notebooks/[id]/chat` → manual-rag → citation SSE.

## Recommendation
Expand JEV in REUSE → CONNECT → FINISH order, as a **shadow discovery layer** that feeds **human-confirmed regression fixtures** and decision-trace feedback. Do **not** make it a runtime safety authority. Ship #4858 as the deterministic twin of restart-advisory; that work is already in flight. After #4858, the highest-leverage step is closing the candidate→fixture loop and finishing the offline #3981 fuzzer. That way phrase-list patches and long Codex rounds stop being the default fix.

**Why:**
- On wrong-family and observation contradictions, the decision fabric scored 11/11. Deterministic class overlap scored 0/11.
- The weak-evidence badge (PR #4381) already shows one safe consulted use, and it never withholds an answer.
- `buildReplayFixture` already requires a named human confirmer.

**Cautions:**
- JEV is not a safety oracle. On #3973 it flagged numbers and overreach, but it missed the energized instruction (#3981).
- #3957 nearly inverted authority by skipping `semanticSafetyCheck`. #3969 had to lock JEV to shadow-only.
- Turning on `MIRA_JEV_DECISION` in prod is Mike's data-egress decision.

## What JEV is today
TypeSafe System One `jev-1.13.0`, called at `POST https://api.typesafe.ai/v1/systemone`. Flags live in `mira-hub/src/capabilities/observability/config.ts`.

| Lane | Flag | When | Decides / records | Mode |
|---|---|---|---|---|
| Sufficiency shadow `jev-shadow.ts` | `MIRA_JEV_SHADOW` | After retrieval (route.ts ~3618) | Whether the evidence is sufficient for this equipment (sufficiency-v2) → `answer_gate.jev_*` | Shadow |
| Weak-evidence badge `jev-weak-evidence.ts` | `MIRA_JEV_WEAK_EVIDENCE_BADGE` | After the stream, when basis is `oem_documentation` (~4674) | Relabels the evidence frame if `jev_sufficient` < 0.30; never withholds | Consulted (UI only) |
| Decision fabric `jev-decision.ts` | `MIRA_JEV_DECISION` | After `controller.close` on answered turns (~1411) | 12 questions (follows_evidence, wrong_family, contradicts_obs, failure_class…) → `packet.jev_decision` | Shadow |
| Hazard triage `answer-safety-check.ts` | uses the shadow score | Beside `semanticSafetyCheck` (~4355) | would_skip / would_proceed telemetry only; `semanticSafetyCheck` ALWAYS runs | Observational |
| Candidates `jev-candidates.ts` | post-process | Offline | `JEV_*` candidate codes; fixtures need `confirmedBy` | Shadow → human |

History: #3949 → #3951 → #3956/#3954 → #3964 → #3957 (authority inversion) → #3969 (remounted shadow-only) → #3970 → #3975 → #4380 → #4381. Still open: #3958 and #3981.

Logs:
- OTel attributes `mira.evidence.jev_*` and `mira.jev.*`.
- Turn Evidence Packet fields.
- `tools/qa/jev_shadow_report.py` and `.github/workflows/jev-shadow-report.yml`.

The packet stores scores only, never question or answer text.

## Decisions surfaces
| Surface | Endpoints / writers | Storage | Readers |
|---|---|---|---|
| TypeSafe decision fabric | `evaluateTurnDecision`, called from notebook chat `finishAndPersist` | Request is a scrubbed `TurnDecisionState`; response becomes a `JevDecisionRecord` | Candidates and reports only |
| Hub decision-trace API | `GET /api/decision-trace/[id]`, `POST /api/decision-trace/[id]/feedback` | Postgres `decision_traces` (ADR-0022, append-only); `decision_trace_feedback` with good / bad / missing_context / needs_review | Why-MIRA-Thinks panel; bots `prior_decisions.py`; adjudication SQL |
| Turn Evidence Packet | route.ts answer_gate and jev_decision stages | In memory and OTel | Collectors; the weak badge |
| Proposals decide (unrelated) | `POST /api/proposals/[id]/decide` | `ai_suggestions` tag mapping | Tag-mapping workflow |

The functions already exist; the ops loop that connects candidates → feedback confirmation → `buildReplayFixture` does not.

## Wiring
- `safety-classifier.ts`: the deterministic question classifier, where the phrase-list pain comes from.
- `restart-advisory.ts`: `RESTART_BANNER` pattern from #4645, the template for the #4858 twin.
- `answer-shape.ts`: `ISOLATION_STEP_RULE`, which is only a soft prompt rule.
- `answer-validation.ts`: the authority (unsafe / ENERGIZED_WARNING / hazard_warning). Banners never withhold an answer.
- `step-energy.ts`: the LOTO↔power contradiction check for #4122.
- `answer-safety-check.ts`: `semanticSafetyCheck` always runs; its triage is shadow-only.
- `observability/jev-*.ts`: record data, plus one UI badge.
- `turn-decision-state.ts`: a scrubbed view that is never persisted as text.

**Invariant:** `evaluateTurnDecision` runs only after `controller.close`. Safety-stop, abstained and cancelled turns get no `jev_decision`. This is pinned by `jev-route-invariant.test.ts`. Never put a vendor call in front of a hazard stop.

## Issue → mechanism map
| Issue | Board | Fit | How expansion helps | Evidence |
|---|---|---|---|---|
| #4858 | #4372 | Partial | Deterministic banner beside restart-advisory; JEV only measures residual misses | restart-advisory.ts:62–78; answer-shape.ts:9–28 |
| Phrase-list safety patches | #4372 C01 | Structural | #3981 offline fuzzer finds bypasses; a human pins the cases | safety-classifier.ts:184–256, :380 |
| #4122 / #4831 | #4732 / #4372 | Partial | step-energy stays deterministic; JEV measures offline | step-energy.ts:79+; answer-validation.ts:1129–1226 |
| #3973 / #3975 | #4372 C01 | Partial | ENERGIZED_WARNING stays authority; the fuzzer finds Unicode bypasses | answer-validation.ts:1043; #3981 |
| Hazard banner wording (#4565) | #4732 | None | Wording/UX only; align with #4858 | safety-classifier.ts:602–638 |
| #3950 / #3966 / #4379 | #4372 C02/C12/C19 | Structural | Fabric Q3/Q7 → candidate→fixture loop; optional wrong_family badge | jev-decision.ts; jev-candidates.ts:88–92; jev-weak-evidence.ts:71–77 |
| #3962 photo drift | #4372 C19 | Structural | Q7 contradicts_obs → human-confirmed fixtures | docs/proofs/2026-09-23-jev-decision-fabric.md |
| Codex rounds that drag | process | Structural | Candidates plus feedback become a pre-Codex corpus | `buildReplayFixture`; `/api/decision-trace` |
| #4842 / #4859 | #4372 | None | Retrieval/chunking problem | #4859 work order |
| #4732 work-order gaps | #4732 | None | Product workflow; #4730 can store evidence in decision_traces | #4725–#4731 |
| #3957 / #3969 | mission-jev | Structural (lesson) | Triage stays observational | answer-safety-check.ts:28–86 |
| #3981 | open | Structural | Offline fuzz → disagreement report → human pin | #3981 |

## Expansion slices
1. **REUSE: candidate→fixture loop.** Run staging `jev_decision` packets through `jevCandidates` into `buildReplayFixture`, using `decision_trace_feedback` (bad / needs_review) as the human confirmation. Output: pinned replay cases in `tools/qa`, each attributed to a person.
2. **CONNECT: nightly decision-fabric report.** Extend the jev_shadow_report collector to aggregate failure_class / wrong_family / contradicts_obs rates, joined to decision_traces. It goes to ops only and changes nothing in the answer path.
3. **FINISH: #3981 offline adversarial fuzzer.** JEV generates paraphrases of hazardous intents, and `validateAnswer` stays the only authority. Disagreements become human-reviewed pins. Acceptance: it rediscovers the U+2011 bypass when the fold is removed.
4. **#4858: don't fork it.** Keep it as the restart-advisory twin with Mike's wording. A shadow question that measures residual misses can come later.
5. **CONNECT (needs Mike's OK): a second consulted badge for wrong_family.** It changes the caption only, never withholds, sits behind its own staging flag, and waits until the false-positive rate has been measured.
6. **BUILD last: a JEV safety rubric.** Only if #3981 proves its value. Offline corpus only, never runtime enforcement.

## Hard rules
- JEV never sits in `validateAnswer` or in the safety-stop path.
- No OpenRouter `:free` models for customer or JEV state.
- Prod `MIRA_JEV_DECISION` and the prod weak badge need Mike's go.
- No claim on the shared UI lane (#3626).
- No phrase-list patches.
- Gate-7 runs first, Codex runs last with Mike's OK, and only Mike merges.
- MIRA stands alone: with the flags off, chat behaves as it does today.
