# Review cost ladder

How MIRA gets the most independent PR reviews out of a small OpenAI API budget
without weakening the gate. The tooling is `tools/review_router/`; the gate itself
(`scripts/adversarial-review*.sh`) is **unchanged**.

## 1. Where the money goes today

The Codex lane (`scripts/adversarial-review.sh`) runs an **agentic** `codex exec`
in a read-only sandbox. The prompt asks it to read the full PR diff, the
surrounding code, the tests, the contracts, `CLAUDE.md` and the relevant rules, and
the call sites. It then explores with tool calls, and **every tool call resends the
whole growing conversation** to the model.

| Driver | Measured |
|---|---|
| Fixed overhead per model call (system prompt plus tool definitions) | **~12k input tokens** (`gpt-5-nano` probe, 2026-10-02) |
| #4182 diff vs main | **236k chars ≈ 59k tokens**, half of it tests |
| Root `CLAUDE.md` + `.claude/CLAUDE.md` (the prompt says to read them) | 61k chars ≈ 15k tokens |
| Default model under `--ignore-user-config` | `gpt-6-astra`, reasoning effort **none** |
| One full round, #4182 r7 | **≈ $2.80** (balance $24.92 → $22.10) |

So the cost is input tokens from repeated exploration, not reasoning. Every round
**re-reviews the entire PR**, even when only a few kilobytes changed. #4182
needed 8 rounds, and several were spent finding *validation invariants* that a
test catches for free.

Prices: <https://developers.openai.com/api/docs/pricing>, Standard tier, fetched
2026-10-02 (`tools/review_router/prices.json`), in USD per 1M tokens:

| Model | Input | Cached input | Output |
|---|---|---|---|
| `gpt-6-astra` | 10.00 | 1.00 | 50.00 |
| `gpt-6.1-sol` | 2.00 | 0.10 | 10.00 |
| `gpt-5.4-mini` | 0.75 | 0.075 | 4.50 |
| `gpt-5.4-nano` | 0.20 | 0.02 | 1.25 |

## 2. The ladder

| Stage | What | Cost | Model / effort |
|---|---|---|---|
| **A. Deterministic** | Every **required CI check** must be green at the exact head (lint, tests, guards). A required check that never reported counts as pending. Plus the **finding→test rule**: after a round with findings, the next paid round is refused until a test file changed. CI executes the candidate's code; the router never does. | $0 | none |
| **B. Free pre-filter** | `tools/gate7_review.py` (Groq/Together free cascade) runs inside the route, **advisory**: its verdict and finding count are recorded with the run, and an unavailable cascade — or a machine without `doppler` — is recorded as `unavailable`, never as a pass. It executes from a detached checkout of the **captured base SHA** (the same immutable tree the trusted entrypoint uses), never from the caller's checkout, so a candidate's own `gate7_review.py` or `mira-bots` imports never run under credentials; the candidate is reached only as git objects. It does not block, because free models false-positive (#4182: one flagged its own redaction as a syntax error). For a whole-file read, run it by hand with `--paths <file>`. | $0 | free cascade |
| **C. Codex gate, low tier** | Only tests, docs, `*.md` or `tools/qa/` changed | ≈ $0.25 | `gpt-5.4-mini`, effort `low` |
| **C. Codex gate, standard tier** | Product code outside the critical list | ≈ $0.56 | `gpt-6.1-sol`, effort `medium` |
| **C. Codex gate, critical tier** | Engine, guardrails, inference, hazard and answer validation, session/middleware, migrations, auth/security/safety/secret paths, workflows, hooks, the review tooling, relay, plc | ≈ $2.80 | `gpt-6-astra`, **today's defaults**, never cheapened |

**Escalation: one tier up, never down, only on evidence.** A prior round with a
`speculative` finding, an operator-flagged disagreement between reviewers, or a
change spanning 3 or more top-level modules each escalate. Critical stays critical.

**Integrity guarantees (from the #4202 round-1 review):**
- **Snapshot binding:** CI is read for the routed commit SHA, not "the PR's current
  head". The shim refuses (exit 65, before any paid call) unless the base and head
  the trusted wrapper captured (`ADV_REVIEW_TRUSTED_BASE_SHA` /
  `ADV_REVIEW_CANDIDATE_SHA`) equal the ones that were routed and CI-checked.
- **Killable spend:** the shim `exec`s Codex, so the trusted watchdog's kill hits
  the paid process itself.
- **No unproven zeros:** a launched run with no usage record is charged its
  estimate and flagged `usage_unknown`. A run the shim refused is a proven zero.
- **Concurrent runs:** the budget check and a reservation of the estimate happen
  atomically under an exclusive `flock`. The run settles to its actual cost, and
  a crashed run stays charged at the estimate.
- **Trusted routing evidence:** prior-round evidence comes only from review
  comments the authenticated owner posted as a `User`, newest by comment id. A
  forged comment can neither suppress escalation nor skip the finding→test rule.

**Budget:**
- **Pre-run:** refuse when the worst-case estimate exceeds the per-round ceiling
  (default $3), or when spent plus estimate exceeds the budget (default $20). The
  estimate is the larger of a fixed-plus-per-character calibration, fitted to two
  measured astra runs and scaled by price, and the worst cost this model has
  actually run at; ×1.5 either way. The fixed term matters: #4202 r1 cost $1.60
  on a 44.7k-char diff, about twice a per-character-only estimate.
- **Post-run:** record exact usage per call (`codex --json` → `turn.completed.usage`:
  input, cached input, output, reasoning) and the cost to
  `.planning/review-costs.jsonl`.

An agentic run cannot be stopped at a token count mid-flight. The hard stop is
therefore *never start a run that could exceed the ceiling*, plus the existing
2400 s timeout.

**What stays exactly as before:** GREEN still comes only from the trusted Codex
lane, at the exact head, with the full-diff `files_reviewed` coverage check, the
3-round cap, and the human-authorized post-cap rule.

## 3. Cost per round, current vs proposed

Estimates scale the measured $2.80 by each model's most expensive price ratio,
which is conservative.

**First measured run (#4182 r9, standard tier, `gpt-6.1-sol` medium, 236k-char diff):**
2,835,472 input tokens (96% cached), 11,293 output + 2,446 reasoning = **$0.64**
(estimate $0.84). The same tokens on `gpt-6-astra` would cost about $4.57. Codex
re-read about 48× the diff, which is why delta review (§5) is the biggest saving left.

| PR kind | Current (`gpt-6-astra`, every round) | Proposed |
|---|---|---|
| Tests/tooling only | $2.80 | ≈ $0.25 |
| Product code | $2.80 | ≈ $0.56 |
| Safety/security/engine/migration | $2.80 | $2.80 (unchanged) |

## 4. Reviews from $20

| Routing | Reviews |
|---|---|
| Current: astra every round | **≈ 7** |
| Proposed, all low tier | ≈ 80 |
| Proposed, all standard tier | ≈ 35 |
| Proposed, realistic mix (50% low / 35% standard / 15% critical) | **≈ 27** |

Stages A and B also cut the *number* of paid rounds per PR. Every invariant-class
finding turned into a test is one class no future round pays to rediscover.

## 5. Not done, needs an owner decision (coverage-relevant)

**Delta review.** Re-review only what changed since the last reviewed SHA, plus the
code it touches. This is the biggest remaining saving: #4182 rounds 2–8 each
re-read 236k chars to check a few-KB fix. But the current gate requires
`files_reviewed` to cover the **full** diff for GREEN, so a delta GREEN reduces
coverage. It is not implemented.

## 6. Tests

`tests/review_router/test_router.py` has 56 hermetic tests, run in CI by a named
`ci.yml` step. They cover:
- the CI-based stage A (green/skipped pass; fail/cancel fail; never-reported is pending);
- trusted tooling (base match, a tampered shim refused, absent-from-base refused);
- spend accounting, a blocking-lock proof, a 6-process reservation race, run-cost
  rules, CI buckets by SHA, forged/bot/older review comments ignored;
- shim snapshot refusal before launch, and a SIGTERM to the shim killing Codex itself;
- tiering, including that a single critical path wins and an empty set fails closed;
- one-step escalation that never goes down;
- routes, and refusal of an unpriced model;
- usage summing and cost math on published prices;
- the estimate floor and history, both ceilings, and the ledger round trip;
- the finding→test rule;
- the shim against a fake `codex`: flag insertion, stdin passthrough, exit-code
  propagation, an effort allowlist that rejects injection, and non-`exec`
  passthrough.

Every decision point was mutation-checked: reverting it turns its tests red.

## Usage

```bash
python3 tools/review_router/router.py <PR> --plan        # route + estimate, spends nothing
python3 tools/review_router/router.py <PR> [--authorized] # stages A → C, inside the budget
```

Run it from a checkout of the **base branch**; it fetches the PR objects
itself. It refuses when its own files (`router.py`, `codex_shim.sh`,
`prices.json`) differ from `origin/<base>`, because a PR must not be able to
supply its own routing or shim. `--bootstrap` overrides that only before the
router exists on main. The Codex login comes from `CODEX_HOME`; on an API key,
see the memory `reference_codex_via_api_key_fallback`.
