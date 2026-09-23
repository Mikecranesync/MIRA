# The answer gate was eating the LOTO clause it demands

**Measured on live staging**, `app-staging.factorylm.com`, `MIRA_PERSONA_CONTRACT=1`,
deployed SHA `5c19e56c8141c843bdcb7a8510117958ac5fee7c` (2026-09-22 21:49Z).

## What the technician saw

Question (the one from the complaint): *"why would a contactor chatter instead of
pulling in cleanly"*

Answer served:

> I can't verify that machine-specific detail from the evidence in this conversation,
> and I won't guess.
>
> What I can tell you honestly:
> - Confirm the exact code and any text shown on the display …

A canned refusal, with a fault-code template, to a question that mentions no code and
is pure general electrical knowledge.

## The safety stop was NOT the cause

The packet for that turn:

```
answer_gate.safety_classification : "none"
context.system_prompt_kind        : "augmented"
answer_gate.reason                : "unsupported-specificity:exact-rating"
answer_gate.decision              : "blocked"
```

The safety-pause change worked — no `SAFETY_STOP`, no terminal refusal. The answer
was destroyed one layer later, by `validateAnswer`.

## Root cause

Six drafts sampled directly from the same provider with the same composed system
prompt (Groq `openai/gpt-oss-120b`, ~$0.004 total). **Four of six were blocked**, and
every one of the four was blocked on the same construction:

| draft | matched excerpt |
|---|---|
| 0 | `voltage** – With the line isolated, locked out and verified at 0 V` |
| 2 | `power isolated, locked out, and verified at 0 V` |
| 3 | `power isolated, locked out, and verified at 0 V` |
| 5 | `voltage verified at 0 V` |

`unsupportedExactRating` reads `QTY("voltage"/"power"/"supply") … "at" … 0 V` as a
declarative machine rating. But `MIRA_CORE` **requires** exactly that clause:

> state the required energy-isolation state IN THE SAME SENTENCE as the instruction …
> e.g. "With the drive isolated, locked out and the DC bus verified at 0 V, …"

So the contract and the answer gate were in direct conflict, and the conflict was
asymmetric: **the safer the answer, the more certainly it was replaced.**

## Fix

An all-zero magnitude is a verification of *absence*, never a rating — exempt.
A range keeps both endpoints, so `"the operating range is 0…+50 °C"` (the real
staging fabrication this rule was built for, trace `8906786b…`) still blocks.

Negative control: reverting the one-line guard fails the new test and leaves the
preservation test green.

## Second defect found by the same probe

A no-`mode`, no-sources turn returned `{"error":"no_sources_selected"}` (422) under
the contract, while the identical turn carrying the legacy `mode:"general"` answered.
The prompt stopped reading that flag; the zero-source gate had not. Fixed and
flag-gated; authorization is untouched (only `no_sources_selected` reaches those
sites — every other error still returns 403/404 above them).

## Commits

- `a0318b21b00425d4931a3cd3ea700164e0ef0a17` — the rating-gate exemption
- `48301c66ba1645381836dc65a9f16244fecd162f` — the empty-notebook routing fix

Gates: 3339/3339 green flag OFF and flag ON; `npm run build` exit 0.
