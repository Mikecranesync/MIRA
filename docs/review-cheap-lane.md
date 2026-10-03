# The cheap review lane — the required gate on every PR

**Owner decision (Mike, 2026-10-03):** every PR's required review is the single-shot
paid lane below. The agentic Codex lane (`scripts/adversarial-review-trusted.sh`,
routed by `tools/review_router/router.py`) runs **only on the owner's explicit
authorization** — for critical paths he names, or to adjudicate a disputed finding.
It is no longer automatic. Nothing else about the gate changes: GREEN is exact-head,
fail-closed, and a merge still needs a human.

## Why

The agentic lane re-reads the repository. Measured 2026-10-02/03:

| PR | diff | Codex (agentic) | this lane |
|---|---|---|---|
| #4202 | 81k chars | $2.91 (critical tier) | **$0.028** (`gpt-5.4-mini`) |
| #4182 | 246k chars | $0.70 (standard tier) | **$0.008** (`gpt-6-luna`) |
| #4203 | 55k chars | — | **$0.017** |

#4182 round 11 consumed 2.6M input tokens for a diff of 67k tokens. One non-agentic
completion over the diff costs diff tokens only.

## Run it

`--paid` is explicit on purpose. Without it, `tools/gate7_review.py` still runs the legacy
**free** Groq/Together cascade (40k-char cap, advisory) — that is what the cost router's
stage B (#4202) invokes, and it must keep spending nothing. The required gate is the
command below, with `--paid`; a run without it is not the gate.


```bash
doppler run --project factorylm --config dev -- \
  python3 tools/gate7_review.py <PR> --paid --post -o .planning/cheap-<PR>-<head>.md
```

- One chat completion, no tools, no retries, the diff **up to 400k chars** (≈100k tokens — every PR so far fits; a larger one is truncated at the tail and the run receipts say `sent < total`).
- Model: the strongest of `gpt-6.1-sol → gpt-5.4-mini → gpt-6-luna` whose **worst-case**
  estimate (no cache, the whole 12k output cap, prices from
  `tools/review_router/prices.json`) fits `--budget-usd` (default **$0.10**). If none
  fits it refuses (exit 3) and spends nothing.
- The real cost (API usage field) goes into the run receipts and the repository's
  shared ledger `.planning/review-costs.jsonl` for **every** launched call — a failed
  call still billed its reasoning tokens.
- `--post` puts the report on the PR as one `[CHEAP-REVIEW]` comment (head, verdict,
  model, cost, run id, findings). GitHub is the durable store.
- No key / failed call / empty completion ⇒ "no review" (exit 2). Never a PASS.

## What it cannot do (so the owner knows what he is buying)

It is single-shot: it reads the diff and the PR text, not the repository. It cannot
run tests, follow imports, or reproduce. In the calibration it found real defects on
#4182 (a substring production guard; an empty `validated_by` counting as sign-off) and
on #4203 (a ledger race; a lost receipt), and it missed one of Codex's #4182 findings
(conversation termination). Its findings carry file:line evidence, which the author
verifies before fixing — the same discipline as the Codex lane.

## When to authorize the agentic lane anyway

Owner's call, case by case: a change on a critical path he wants exhaustively walked
(engine, guardrails, auth, migrations, review tooling), or a cheap-lane finding the
author disputes. Invoke through the router (`python3 tools/review_router/router.py
<PR> --authorized`) so the budget and CI-first checks still apply.
