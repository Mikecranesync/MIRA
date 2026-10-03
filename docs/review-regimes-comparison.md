# Two review regimes, compared — the agentic Codex lane vs the single-shot lane

Measured 2026-10-02/03 on PRs #4182, #4202, #4203. Companion to
`docs/review-cheap-lane.md` (the policy) and `docs/adversarial-review-workflow.md`
(the agentic lane). Numbers come from `.planning/review-costs.jsonl` and the PR threads.

## The two lanes in one table

| Dimension | Agentic (Codex via `scripts/adversarial-review-trusted.sh`) | Single-shot (`tools/gate7_review.py --paid`) |
|---|---|---|
| What the reviewer sees | The whole repository, from a detached base worktree; it can follow imports, run tests, reproduce | The diff and the PR text only; nothing else |
| Cost per review (measured) | $0.64–$0.84 standard tier; $1.60–$2.91 critical tier | $0.008–$0.028 per PR; ≈$0.004 per fixture case |
| Tokens per review | 0.9M–2.6M input (it re-reads the repo) | 25k–67k input (the diff) |
| Billing | ChatGPT workspace credits when logged in via ChatGPT; API key otherwise | OpenAI API key, pay-as-you-go |
| Model | `gpt-6-astra` (critical), `gpt-6.1-sol` (standard), `gpt-5.4-mini` (low) via the router | strongest of `gpt-6.1-sol → gpt-5.4-mini → gpt-6-luna` whose worst-case fits the budget |
| Cutoffs, input side | 2400 s timeout; the prior review fed as context is sliced to 6,000 chars; Codex's own context window | 400k-char cap; **refuses** over it (exit 4), names the heaviest files, suggests `--paths` |
| Cutoffs, output side | Envelope schema; a malformed/missing envelope is "no review" | 12k-token cap at low effort; `finish_reason=length` is "no review", never PASS |
| Accounting | GitHub-backed round ledger (reservations, verdicts); dollar ledger via the router | Dollar ledger row per launched call, written after the verdict; failed calls charged at the estimate |
| Durable record | `[CODEX-ADVERSARIAL-REVIEW]` comment, exact-SHA, counts rounds | `[CHEAP-REVIEW]` comment with head, verdict, model, cost, run id |
| Rounds | Max 3 autonomous, then the owner | Unlimited; cents each |
| Failure modes seen | Reservation consumed by a tooling crash (new head needed); the Codex binary moving under a ChatGPT update; the router's estimate floor compounding with its safety factor ($4.36 size-independent) | Reasoning eating the output cap (fixed: low effort, 12k cap); redaction placeholders reported as defects (fixed: redactor no longer rewrites identifiers); chars/token estimate was not a bound (fixed: tokenizer-with-margin or bytes) |

## Finding quality, head by head

| Head | Agentic | Single-shot |
|---|---|---|
| #4202 `76e0af3e7` | r2: F8 BLOCKER (pre-filter executed the candidate tree), F5, F9 — all real, $2.08 | — |
| #4202 `b80c256dc` | r3: F10 relative ledger paths, F11 UNKNOWN→PASS — real, $2.17 | — |
| #4202 `5d4c128bc` | r4: F12 rename sources — real, $2.91 | — |
| #4202 `ba0640b00` | — | 3 items, speculative (case-sensitive globs), $0.028 |
| #4182 `0aecbc423` | r11: F20 case-sensitive prod guard, F21 no termination — real, $0.70 | 4 items: substring prod guard (real, cookie to an attacker host), negation-cue bypass (real), extension-only path check (real), empty `validated_by` scorable (real) — $0.008. Missed F21. |
| #4182 `148f5f904` | — | plaintext-http cookie (real, high); `[IP]` redaction FP; budget comment FP — $0.008 |
| #4203 `3c55f7437` **(same head, both lanes)** | r1: F1 quoted literals exempted, F2 length-truncated PASS, F3 chars/token, F4 Windows fcntl — **4 real** | 2 items, both non-defects — $0.023 |
| #4203 self-reviews ×8 | — | found the ledger race, the lost receipt, the no-usage spend gap, the pending-row window, the stale PR text — all real; plus recurring redaction FPs until the redactor was fixed |

Read across: the single-shot lane finds **real, local, pattern-shaped defects** (a substring guard, a blank sign-off, a missing scheme check, a race in the file it is reading) at ~1% of the cost. The agentic lane finds **defects that need the rest of the repository** — what a function's caller does (F8), where the runner chdirs (F10), how renames reach the router (F12), that a conversation never terminates (F21), that an exemption leaks through a quoted literal (F1). On the one head both reviewed, Codex found four real defects the cheap lane missed.

## The light review fixture

`tests/review_fixtures/<case>/` holds six small unified diffs with ONE defect physically in the text (a `planted` regex must match the diff — a fixture whose defect is not in its text proves nothing, and the first orchestrated implementer shipped four of those). `tools/review_fixture.py` scores any `provider(prompt)` against them: hit = a finding at or above the case's severity floor containing an expected keyword; the control counts strong findings as false positives. Hermetic tests use a fake provider; `--live` runs the paid lane under a declared budget and records every call.

Live calibration (2026-10-03, `gpt-5.4-mini`, ≈$0.02 total): **recall 5/5, 0 control false positives.** The classes: substring production guard, plaintext http, empty sign-off marker, unhashable `kind` crash, length-truncated PASS. The agentic lane cannot be run hermetically on a fixture (it needs a PR); its calibration is the head-by-head table above.

## Avoiding the cutoff — what changed

- Input side, single-shot: no truncation in `--paid`; over 400k chars it refuses with the heaviest files listed; split with `--paths` for one PASS per scope. The free cascade still truncates (advisory lane) and says so in its receipts (two hashes: sent bytes and the full scoped diff).
- Output side, single-shot: 12k-token cap at `low` reasoning effort (medium consumed a 6k cap as hidden reasoning and returned nothing); `finish_reason=length` ⇒ no review, billed and recorded.
- Agentic: the 6,000-char prior-review slice and the 2,400 s timeout are unchanged and visible in `scripts/adversarial-review.sh`; the router's size-independent estimate floor is recorded on #4202 for its next round.

## How to use them together (owner decision, 2026-10-03)

The single-shot lane is every PR's required gate — run it on every head, cents each, verify its findings in the code. Ask for the agentic lane when the change needs the rest of the repository read: engine, auth, migrations, review tooling, or a cheap-lane finding the author disputes. Tonight that split cost ≈$0.30 for twelve cheap reviews against ≈$11 for seven agentic rounds, and both kinds of review earned their money.
