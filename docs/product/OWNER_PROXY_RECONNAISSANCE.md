# Owner Proxy — what we already have and what to do first

Status: **Proposed documentation slice; no runtime activated**

Checked: September 25, 2026

Main: `f41e57054dda30600246c5f835c46c48df4fa069`

PR #3999 code on GitHub: `c50f7ba9ca9c83523eee4b947db6d0f98a95fc1c`

## Owner summary

MIRA already has much of the machinery needed to run controlled repair missions and
record how an answer was produced. We should connect and finish it, not create another
agent manager or evaluation architecture. These documents describe the proposed rules;
they do not prove the new system is running.

The first known product problem is still in the photo-to-answer work of PR #3999.
Its latest local answers mix some component manufacturers and misread some small text.
Those local changes have not been pushed as code. The physical Pixel was absent during
the emulator continuation; reconnecting it remains necessary for physical acceptance.
See the [full plain-language report](https://github.com/Mikecranesync/MIRA/pull/3999#issuecomment-5841521419).

## REUSE / CONNECT / FINISH / REPAIR

| Decision | Existing work | How it serves this proposal | Limit or collision |
| --- | --- | --- | --- |
| REUSE | [Foreman mission contract](../missions/AUTONOMOUS-FOREMAN-V1.md), `mira-bots/foreman/mission_loop.py`; merged #3567/#3572/#3573 | Work ownership, one implementer, independent review and verification, exact-version records, human gates | Policy existence does not prove a live continuous driver; retain distinct roles and existing limits |
| REUSE | [Answer Radar records](../../answer_radar/schema.py), freeze/scoring/report modules; merged #3584/#3599 | Rights, development versus unseen cases, immutable evaluation identities, grading/report concepts | Existing question benchmark is not a demonstrated native-phone multi-photo runner |
| REUSE | [Turn Flight Recorder](../architecture/observability/2026-09-22-turn-flight-recorder.md), [runbook](../runbooks/turn-flight-recorder.md) | Trace evidence, interpretation, identity, retrieval, assembled context and final answer through existing diagnostics | Verify actual capture availability; unavailable external telemetry is not evidence of no failure |
| CONNECT | Existing `tools/mobile-e2e/`, app tests, browser/phone workflows and protected PR #3999 evidence | Exercise the actual app and connect screen evidence to the existing answer records | Do not replace the UI or fabricate a trace when a stage was not captured |
| FINISH | PR #3999 and the governing [Unified Technician PR #3990](https://github.com/Mikecranesync/MIRA/pull/3990) | First real workflow, narrow repairs, frozen replay, phone/web continuation | Preserve the dirty repair worktree; no fresh acceptance claim from its live-edit runs |
| CONNECT, after owner coordination | Open [#3589](https://github.com/Mikecranesync/MIRA/pull/3589), head `347ed6f56a754f2b04cd699f95536195d70fabc0` | Existing Answer Radar agent/adapter/mission-record integration | Not merged; do not recreate its implementation or assume its live proof applies here |
| CONNECT, after owner coordination | Open [#3674](https://github.com/Mikecranesync/MIRA/pull/3674), head `25b5f9f0b9cbeb98f37d4a2d8e92eeb05d0ca9d0` | Existing proposed continuous mission driver | No new recurring service; refresh ownership/readiness before use |
| REUSE/FINISH, after owner coordination | Open [#3669](https://github.com/Mikecranesync/MIRA/pull/3669), head `073161a5b5dc948d31f9c0b4940f8a93b0a410c6` | Existing proposed mechanical UX checks and fixtures | Its checks are not a replacement for evidence accuracy or physical testing |
| REPAIR, bounded separately | Existing PR #3999 interpretation/context/retrieval/answer path | Repair the first demonstrated wrong label/association at its source | Do not modify vision when the raw interpretation is right and synthesis introduced the error |

These are point-in-time GitHub/file inventories, not an assertion that every session is
idle. Relevant open work also includes #3836 (independent verdict contract), #3970
(model/family retrieval scope), #3959 (intelligence contract), #3845/#3807 (phone and
Sources work), and #3984 (serious safety issue). Refresh exact heads, comments, files,
active claims and local ownership before any implementation mission. The old 90-day
plan's in-flight table contains historical entries; it cannot alone certify no collision.

## This proposed change

- `OWNER_OPERATING_PRINCIPLES.md`: Mike's product judgment in one canonical place.
- `REFINEMENT_MISSION_CONTRACT.md`: input/output, seven layers, one-failure workflow,
  permissions, freeze/replay/challenge, outcomes and a plain-language owner report.
- `benchmarks/product/`: a catalog contract and BENCH-FIREPLACE-001 registration,
  with private evidence kept separate from scoring and deterministic fixtures.
- This reuse audit: current identities, existing owners/mechanisms and the first boundary.

No runtime code, model selection, production prompt, database, dependency, test runner,
agent dispatch, scheduled job, customer data, deployment or active repair branch changes.
The new documentation is in a separate worktree based on the main SHA above.

## Remaining decisions and missing evidence

The supplied proposal stops in section 30 at “Repair remaining interpretation-t…”.
The exact remainder is requested; it is not reconstructed here. The complete first
mission, its execution/cost limits, required repeated-run contract and any activation
schedule remain to be specified before unattended execution. Do not treat “Proposed”
as proof of adoption or operational readiness.

Recommended next action: review this documentation against the completed First Mission
text, then run one narrowly scoped PR #3999 mission using the existing machinery.
A proposed contract can be ready for review while the product and automation remain
unproven. PASS for one repair never clears the broader release or safety gates.
