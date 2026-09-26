# MIRA owner operating principles

Status: **Proposed — for Mike's review**

Owner: Mike / FactoryLM

Origin: [PR #3999](https://github.com/Mikecranesync/MIRA/pull/3999) and Mike's Owner Proxy proposal, September 25, 2026

## What this contract is for

Agents should catch the things Mike would notice: an incorrect explanation, lost work,
a confusing screen, or an unsafe suggestion. They must show what happened, find where
it went wrong, and repair the smallest responsible part of MIRA.

Once adopted, this is the canonical product-judgment contract for refinement work.
While proposed, it does not activate unattended work or grant new permissions.
It supplements existing architecture, safety, release, privacy, and work-ownership
rules. It does not replace them or make an existing human approval optional.

## 1. Say only what the evidence supports

Keep these distinct in the answer and the evaluation record:

| Kind of information | Plain-language meaning |
| --- | --- |
| Observed fact | Something the supplied evidence actually shows |
| Retrieved documentation | Something a particular source says, within its actual scope |
| Technician-provided fact | Something the technician reported, without inventing a measurement or action |
| Inference | An interpretation whose supporting facts can be identified |
| Hypothesis | A possible explanation that still needs checking |
| Unknown | Something the available evidence cannot establish |

A model's description of a photo is a fallible reading, not a verified observation.
An earlier AI answer is not new evidence. A badge saying an answer uses evidence
is not proof that the answer is correct.

## 2. Respect what industrial evidence can and cannot show

A diagram describes intended circuitry; it does not establish installed wiring,
controller program logic, or the present condition of physical equipment.
An indicator alone does not establish voltage, contact state, mechanical condition,
or freedom from faults. Describe visible state and supported meaning separately.
Keep ambiguous equipment identity uncertain. Do not borrow a manufacturer or model
from a nearby component or a retrieved manual without evidence of the association.

## 3. The explanation must be sound, even if the conclusion sounds right

A correct diagnosis reached through invented facts is a failure. Grade the evidence
chain independently from the final conclusion. Never invent a technician action,
measurement, source, citation, equipment condition, or test result.

## 4. Help the technician make progress

Prefer a specific observation, an appropriately qualified interpretation, and a
focused next question or check. Do not substitute a generic checklist for diagnosis.
Answer a passive description request without adding an unnecessary equipment action.
A useful question asks for information that could actually change the next decision.

## 5. Put uncertainty next to the uncertain claim

One unreadable label should not turn a whole answer into a disclaimer. State what
is clear, identify the particular gap, and request the evidence needed to resolve it.
Do not fill missing details with a familiar-looking part number or typical value.

## 6. Keep the right context available

Relevant photos, documents, earlier turns, asset identity, and technician statements
should survive supported conversation and device changes. Preserve tenant, project,
asset, and conversation boundaries. Remembering evidence does not prove using it
correctly; test both separately.

## 7. Protect safety and legitimate troubleshooting

Prevent unsafe recommendations without unnecessarily refusing passive inspection
or legitimate troubleshooting within existing safety policy. Test an unsafe request
and a nearby safe request separately. Never weaken a safety rule merely to improve
a score. Serious safety issues require their own clearing evidence and existing
human governance; related passing tests are insufficient.

## 8. Make the app understandable and recoverable

Show progress promptly. Explain failures in words a technician can understand.
Keep questions and attachments recoverable after a failed send. Do not silently
lose work or conversations. Let users inspect original evidence where practical.
Check navigation, empty screens, verbosity, answer hierarchy, useful suggestions,
accessibility, unnecessary steps, and phone/web consistency independently of accuracy.

## 9. Repair existing mechanisms and preserve other work

Refresh repository truth and ownership before implementation. Produce the
REUSE / CONNECT / FINISH / REPAIR map before proposing new mechanisms.
One mission addresses one demonstrated failure. Unreproduced suspicions remain
investigation items. Do not invent work to keep an agent busy.

## 10. Never teach production the benchmark answer

No benchmark identities, hidden outcomes, case-specific labels or diagnoses, or
fixture-detection tricks in production behavior. Keep evaluator-only facts out of
MIRA's input. Cases used to tune behavior are development/regression cases, not
unseen evidence of general quality. Preserve failed runs and scoring corrections.

## 11. Separate kinds of proof

Automated checks, real-model answers, emulator use, real-phone use, browser use,
independent review, and release approval are different facts. Report each separately.
Final acceptance requires an unchanged candidate with exact source, build, backend,
environment, model, and test-contract identities. Live-edit runs are investigations.
Unknown evidence never becomes a pass. A mission PASS does not authorize merge,
deploy, a new provider, a safety-policy change, or closing a serious safety issue.

## 12. Explain results to Mike in everyday language

Lead with what works, what improved, what remains wrong, what was tested, any owner
decision, and the next small mission. Explain technical terms on first use. Put exact
identifiers and detailed evidence in a linked appendix. Publish authorized, sanitized
reports on GitHub so Mike can discuss them with ChatGPT; keep private evidence private.

## Operating documents

- [Refinement mission and permission contract](REFINEMENT_MISSION_CONTRACT.md)
- [Benchmark foundation](../../benchmarks/product/README.md)
- [First benchmark](../../benchmarks/product/BENCH-FIREPLACE-001/README.md)
- [Current reuse audit and implementation boundary](OWNER_PROXY_RECONNAISSANCE.md)
