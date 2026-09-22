# Live staging acceptance — MIRA Intelligence Contract

**Staging:** `https://app-staging.factorylm.com` · **Flag:** `MIRA_PERSONA_CONTRACT=1`
in `factorylm/stg` only (prod unset ⇒ compose default `0`)
**Deployed SHAs:** `b89018c31` → `8e172f3e2` → `076ab7371` (all via `deploy-staging.yml`,
`approved_rc_sha` pinned to the branch head — staging accepts any repo SHA, so this
proved the RC **without merging to main**)

Raw artifacts: `run2-before-fix.json` (at `8e172f3e2`), `run3`–`run7.json` (at `076ab7371`).
Every row carries its Langfuse trace id and turn id.

## What live traffic caught that 3329 green unit tests did not

### Defect 1 — the acceptance loop asserted a persona it no longer chooses

`retrieval_acceptance.py` pinned `system_prompt_kind in ("grounded","machine")`.
Under the contract a normal turn reports `augmented`, so scenarios 2 and 3 failed
on an assertion, not on behaviour. Found by the Gate 7 reviewer, fixed in
`65738d699`.

**Also learned:** `retrieval-acceptance.yml` checks out the **default branch**, so
CI ran *main's* script against a *branch* deployment. A pre-merge RC therefore
cannot be validated by the CI job alone — the script must be run from the branch,
which is how runs 2–7 were produced.

### Defect 2 — the specificity rule silenced a DOCUMENTED identifier

Scenario 3: technician attaches a manual, asks "what tags does the PLC expose for
the VFD conveyor and what does each one mean". The chunk reached the model
(`chunk_count=1`, `prompt_chars=8643`, 8 content frames) — and the answer shipped
**zero citations** badged *"General guidance — not grounded in this machine's
documents."*

Tag names and meanings are exactly the identifier class the UNSUPPORTED SPECIFICS
rule withholds. It fired even though the technician's own manual was in the prompt
answering the question. **Priority 1 was suppressing priority 2**, and only live
traffic showed it. Scoped the rule to absence-of-evidence in `076ab7371`.

## Measured result — and the trade-off that needs a decision

| scenario | before fix (`8e172f3e2`) | after fix (`076ab7371`) |
|---|---|---|
| 1 blank chat, generic question | PASS | **5/5 PASS** |
| 2 OEM corpus cited | 2/2 | **4/5** |
| 3 attached manual cited | **0/2** | **3/5** |
| 4 photo → text-only follow-up | PASS | **5/5 PASS** |
| 5 unsupported exact rating withheld | PASS | **5/5 PASS** |

The fix moved scenario 3 from never citing to citing most of the time, at a small
cost to scenario 2.

**The honest finding: under augmented-by-default, citing PARTIAL coverage is
probabilistic (~60–80%) where grounded mode was deterministic.** Grounded said
"answer ONLY from the excerpts", so the model had no judgement to make. Augmented
asks it to decide whether an excerpt supports the answer, and with one to six
partial chunks that judgement is unstable at `temperature 0.2`.

This is not a bug introduced by carelessness — it is the direct consequence of the
product law "attaching evidence is not consent to document-only answers". The law
is right. The cost is that citation becomes a model judgement rather than a
constraint.

**Decision needed (not taken autonomously):** accept probabilistic citation on
partial coverage, or route to `grounded` specifically when the technician
*explicitly attached sources* AND chunks came back — which would restore
determinism for the attached-manual case while still never refusing when nothing
matched. The second is a change to the routing rule that was specified, so it is
Mike's call, not mine.

## Scenarios 1, 4 and 5 are 5/5 — the golden rule holds

- **1** blank chat, no project or machine, no sources → answered, `general_reasoning`.
- **4** photo turn then a text-only follow-up → the earlier photo is recalled
  server-side (`prior_visual_observations_considered=1`), `workspace_evidence`.
- **5** exact rating with no evidence → no unit-bearing value escapes as fact.

Every row also passed: trace id identical across header/packet/diagnostics, first
SSE frame is the trace frame, environment attributed `staging`, provider/model
recorded (`Groq / openai/gpt-oss-120b`), token usage present, and **no secrets or
answer text in any packet**.
