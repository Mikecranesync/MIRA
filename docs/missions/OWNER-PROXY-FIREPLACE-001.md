# OWNER-PROXY-FIREPLACE-001 — finish the fireplace evidence

Status: **Scoped; acceptance pending**

Governing specification: [Owner Proxy PRD, section 30](../product/OWNER_PROXY_PRD.md#30-first-mission--finish-3999s-evidence).

Product repair: [PR #3999](https://github.com/Mikecranesync/MIRA/pull/3999).

Benchmark: [BENCH-FIREPLACE-001](../../benchmarks/product/BENCH-FIREPLACE-001/README.md).

## Plain-language owner report

The app can receive and retain the tested photos, but an answer can still assign a
component to the wrong manufacturer after the photo reader identified it correctly.
Some small print also remains unreliable. Better loading screens and passing software
tests do not resolve those accuracy failures.

The next repair must follow the evidence from the photo reader through saved context,
retrieved manuals and the final answer. Correct each demonstrated failure at its first
entry point. Leave uncertain print explicitly uncertain when it cannot be established.
The full unchanged-version, five-photo, changed-order and physical phone/web replay
has not yet passed. No safety issue is cleared.

## Ownership, identities and boundaries

- Owner: Mike / FactoryLM; current continuation on CHARLIE in the existing
  `codex/fireplace-repair-loop` worktree/branch, preserving its uncommitted work.
- Published #3999 head at scope capture: `c50f7ba9ca9c83523eee4b947db6d0f98a95fc1c`.
  Local investigation includes uncommitted changes; this is not the frozen candidate.
- Main at scope capture: `f41e57054dda30600246c5f835c46c48df4fa069`.
  Refresh both identities, work claims and overlapping PRs before further edits.
- Authorized environment: existing local Hub, synthetic staging QA account, emulator;
  physical Pixel when reconnected. Keep existing providers and credentials handling.
- Use original protected evidence and neutral prompts. Never send the held-out diagnosis
  or grading facts to MIRA. No public originals, raw transcripts or credentials.
- Execute one bounded repair attempt at a time. Record its predeclared run count and
  evaluation configuration before provider calls. This record is not an unattended
  dispatch: no new recurring job, cost increase or unlimited retries is authorized.
- Stop an attempt at its declared outcome, an ownership conflict, unavailable required
  evidence or a change that crosses the PRD's approval boundary. Missing Pixel proof
  does not prevent independent emulator investigation, but remains UNKNOWN.

## First bounded slice

**Problem:** a follow-up attributes photographed components to a manufacturer that the
raw photo interpretation did not assign to them. The last retained investigation also
contains unreliable small-print text.

**Evidence:** [PR #3999's plain-language report](https://github.com/Mikecranesync/MIRA/pull/3999#issuecomment-5841521419)
and protected emulator runs E/F/G. Preserve every original run and evaluator correction.
These are past live-edit investigations, not a frozen acceptance result.

**First failing layer:** attribution has a demonstrated interpretation-to-answer
mismatch. E (synthesis) is the immediate investigation target. Trace C (assembled and
persisted context) and D (retrieved material) before asserting the precise root cause.
Small-print reading is a distinct B (interpretation) uncertainty unless tracing proves
a later alteration. Do not bundle a vision redesign into the attribution repair.

**Cause hypothesis:** component associations or equipment identity are lost or overridden
between raw interpretation, assembled context/retrieval and the answer. The complete
mechanism must be established from actual captured stages before implementation.

**Existing mechanisms:** the notebook LOOK route, stored photo observations, notebook
chat context/retrieval/answer path, existing diagnostics and their regression suites.
The [reuse audit](../product/OWNER_PROXY_RECONNAISSANCE.md) identifies overlapping work.

**Permitted change:** the smallest general repair at the demonstrated failing boundary.
If existing evidence validation owns that boundary, reuse it. Do not add manufacturer
lists, case-specific prompts, fixture detection, a new reasoning framework or a new
provider. Name the exact allowed files in the attempt record after tracing.

**Likely inspection scope:** `mira-hub/src/app/api/equipment-notebooks/[id]/chat/`,
its existing context/grounding helpers and tests, with LOOK/observation capture read-only
initially. Extend edits into interpretation only under a separately demonstrated slice.

**Opposite controls:** document-only answers, correct manufacturer separation for multiple
components, ambiguous or absent labels, unrelated retrieved manuals, current/historical
photos and text-only follow-up. Preserve legitimate passive description and existing
safety protection independently.

**Acceptance evidence:** red-before/green-after targeted regression and relevant checks,
then actual model output on unchanged source showing supported attributions without
invented facts. Small-print uncertainty must be tied to the uncertain region/claim.
A prompt-string assertion alone cannot prove answer accuracy.

## Ordered completion contract

| Requirement from Mike | Evidence needed | State at scope capture |
| --- | --- | --- |
| Repair interpretation-to-answer attribution | Trace the first mismatch, repair its owning boundary, replay actual answers | FAIL in retained investigation; new candidate not evaluated |
| Address/localize uncertain small print | Original-region comparison; faithful uncertainty instead of invented text | FAIL/uncertain readings retained; acceptance pending |
| Freeze one candidate | Clean commit, build hash/version, backend SHA, environment, model/provider/config and evidence/scorer identities | UNKNOWN; local work remains uncommitted |
| Complete five-photo benchmark | All five original photos, literal prompts and every resulting stage/answer retained | UNKNOWN on frozen candidate |
| Changed-order controls | Predeclared alternate order in a fresh conversation, same frozen candidate | UNKNOWN on frozen candidate |
| Physical Pixel | Actual installed artifact identity and real-device workflow evidence | UNKNOWN until device available and tested |
| Phone → web → phone | Same conversation and new turn visible on both surfaces without loss or duplication | UNKNOWN on frozen candidate |
| Preserve safety blockers | #3984 and each related issue evaluated only against its own clearing contract | #3984 OPEN at scope capture; no closure authorized by this mission |

Before acceptance, freeze the private manifest, literal prompt sequence, original and
changed orders, repeated-run count, required controls, scoring rules and candidate
identity. Keep all failed attempts. Grade A–G separately and record emulator, browser
and Pixel proof separately. A failed answer makes that attempt FAIL even when other
required evidence remains UNKNOWN. The mission cannot PASS with missing physical proof.

## Extraction gate and final handoff

First give #3999 a defensible PASS / FAIL / UNKNOWN outcome, with remaining failures
and missing evidence explicit. Then extract only methodology supported by the actual
runs into existing Owner Proxy tools. A FAIL or UNKNOWN may yield useful lessons but
is not proof the system is operational or that the product defect is fixed.

Publish the twelve-field PR evidence package and six-field plain-language owner report
from the [mission contract](../product/REFINEMENT_MISSION_CONTRACT.md). Stop before
unrelated work. No merge, production deployment, new architecture or safety-policy
change is included in this mission.
