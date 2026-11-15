# Drive + MLC: quick verification pilot

> Publication note (2026-11-15): archived research and observations from the date stated below, not a current release-status report or new authorization. See the [collection index](../../README.md) and [private-evidence policy](../../PRIVATE-EVIDENCE.md).


Prepared 2026-11-14, 17:32 ET; updated after the physical tablet run at approximately 18:05 ET. This remains the broader test card. The bounded passing receipt and observed gaps are in [tablet-first-proof/RESULT.md](tablet-first-proof/RESULT.md).
**User correction and later observation:** the user could not find ZZ-BENCH. The tablet's signed-in project list did contain it below many expanded conversations; it was not required for this run. We followed ordinary onboarding into a new MLC project. The run proved a cited datasheet answer, unconfirmed-identity refusal, page-reload persistence and stale-selection refusal/retry between MLC and Whole machine. Installed identity, drive/MLC separation and saved jobs remain unproven in this receipt. Conveyor 1 already has a bound project, so the fresh General project could not create a machine job. Use the existing machine notebook for that next step; do not change tenant ownership or fabricate another machine.

**Immediate claim to test:** the user can onboard the MLC from its actual identity
and source, obtain a cited answer, and reopen the saved work. Cross-component
selection/retry verification follows only when the drive and Q1 are actually
available together in a project the user can access.

## Start here: repeat the morning flow

1. Use https://app-staging.factorylm.com in the user's normal account to exercise
   the new staging build. Follow the same New project flow used this morning;
   name this project **Workbench – MLC**.
2. Add the MLC nameplate photo and its manufacturer datasheet using the ordinary
   onboarding controls. Check the manufacturer's catalog identity against the
   physical label; leave unsupported installation details unknown.
3. Press Send manually: **“Identify this device from the attached nameplate and
   datasheet. What is its exact catalog number and coil/control voltage? Cite the
   source page, and say unknown for anything the source does not establish.”**
4. Compare the answer with the actual label and datasheet, open the citation,
   save a short verification note, then close/reopen the project and check it.
5. Record actual results. This establishes onboarding, answer grounding and
   persistence only for the cases exercised. It does not by itself prove the new
   two-component scope interlock. Continue that check below once its prerequisites
   are visible in the user's project. Missing normal-user setup is a product/setup
   gap to record, not a reason to require an invisible seed project.

## What is actually available

Fresh version read: staging **3.452.0 / eab62164db37b18c824a47de897e89fa6fce1f01**,
which includes [#5504](https://github.com/Mikecranesync/MIRA/pull/5504).
Production remains 3.446.3 / 15695e9682453595ff149c592cecfebf4481802e.
Re-read staging version immediately before and after this walk. If it changes,
split the receipts by build; arrange a stable acceptance window through the
existing coordinator, CHARLIE Codex.

| Work | What the evidence supports now | What this quick pilot can claim |
|---|---|---|
| #5504 component checklist, confirmation and server-checked selection | Merged and staging version verified; owner reports 19 seeded rows, all initially unconfirmed | Actual technician selection/reload/stale-screen behavior, if the cases below pass |
| Saved assets, projects, notes/photos, recovery and guide | Earlier Pixel synthetic run and current staging desktop run reported passes; these are mostly existing capabilities | Regression evidence for the exercised path, not newly invented features |
| #5510 model applicability | Published 9d404675a and CI pass; round 2 still has two HIGH findings; next correction and final round already granted | Cannot claim this repair is accepted or deployed |
| #5517 machine-owned prints + #5512 page cautions/citation cleanup | Drafts included in local combined candidate 982f8aa4b; not staged | Later print-question pilot after integration/review/deployment |
| #5500 catalog punctuation + #5415 honest safety attribution | Not merged; #5415 refreshed local candidate differs from its published head | Later regression on whichever exact candidate is accepted |
| #5530 / #5539 ontology coverage and real-database contracts | Draft test work; #5539 reviewed; its Hub database suites are not in CI | Engineering evidence, not a new technician action |
| #5543 corrected graph relationships | Draft; last repair reported local; remaining review finding; no application caller for retirement | No claim yet that correcting a fact through the app retires its graph relationship |
| #5544 PDF recovery / #5545 onboarding runbook | Both draft; one application repair and one document | Use the runbook as a plan, not evidence that the repair shipped |

The coordinator's local 982f8aa4b combined build passed 16,685 unit tests, but is
not a reviewed/deployed release and includes the still-blocked #5510 snapshot.
Refresh its composition against current main and the next #5510 repair before
requesting acceptance. Do not reapply migration 115: its earlier application
receipt already exists. Rollback compatibility across it remains a reviewed decision.

## Follow-up: five component-scope checks

Use the real tablet or phone yourself, in a project visible to the user's account
that actually contains both VFD1 and **Q1/MLC**. Do not assume a new single-component
project has this checklist. ZZ-BENCH is an optional agent fixture only; it is not
the user's required starting point. Use Q1, not PLC1 or project P-PLC.
Only confirm identity fields supported by the actual nameplate and approved
component source. The local tag “MLC” does not by itself establish catalog type
or electrical function. Keep unknown values unknown. No equipment operation is
needed for this software pilot.

Before starting, have the retained passing drive question/answer/page and the
correct Q1 manufacturer datasheet open. Pick one clearly printed Q1 fact, such as
its control-circuit voltage, and note the expected value/page before asking MIRA.
If either source is missing/not ready, mark that answer check BLOCKED and continue
selection/recovery checks. Do not spend the short pilot rebuilding a large manual.

| Time | Action | Pass condition and receipt |
|---|---|---|
| 0–2 min | Record staging version, device/browser, account role and project. Select/confirm VFD1 using known evidence. | Selected tag and identity agree with the record. Screenshot; record any unknowns. |
| 2–5 min | Ask the previously accepted drive baseline question by pressing Send yourself. Open its citation. Reload the page. | A request actually sends; answer agrees with retained baseline; citation opens the correct drive page; selection survives reload. A tap that sends nothing means the answer/citation checks are NOT TESTED. |
| 5–9 min | Leave screen A on VFD1. Open the same conversation on screen B and select Q1. On A, send: “For the selected component, what catalog number and [the fact selected above] does its attached manufacturer source specify? Cite the page; say unknown if unavailable.” | A refuses the stale selection before answering. Use its normal reload/Retry path; the screen now identifies Q1, and the answer and citation concern Q1 only. Never accept a silent whole-machine fallback. Capture refusal, updated selection and cited page. |
| 9–12 min | Select Whole machine explicitly, then Q1 again. Save a timestamped bench-verification note (and a photo if convenient). Close/reopen the project. | Scope changes are visible; record returns once and unchanged; selection is coherent. This proves persistence only—do not call it approved-memory recall. |
| 12–15 min | Re-read staging version and complete the receipt below. | Each case has an observed verdict, evidence and next owner. Record any intervention or blocked navigation. |

[#5546](https://github.com/Mikecranesync/MIRA/issues/5546) currently reports floating
controls obstructing the side menu on narrow screens. If this happens, record a
navigation FAIL. A separate landscape/desktop pass can still be useful, but a
left-edge tap workaround does not turn the phone journey into an unassisted pass.
[#5542](https://github.com/Mikecranesync/MIRA/issues/5542) concerns simultaneous
identity corrections; that separate case remains outside this short walk.

This walk exercises two answered questions if it succeeds; use the already
approved pilot allowance. It does not start paid reviews or grant new spending.
If request retries fail, preserve the first useful reproduction instead of
repeatedly spending on the same failure.

## Receipt and verification loop

Copy into the existing pilot acceptance ledger/handoff, not a competing ledger:

```text
Pilot: drive + Q1 selection and recovery
Tester / human or synthetic:
UTC start/end:
Device/browser/orientation:
Staging SHA before/after:
Project and component tags (no credentials):
Case | PASS / FAIL / BLOCKED / NOT TESTED | actual observation | evidence
1 identity:
2 drive answer + citation + reload:
3 stale selection refusal + Q1 retry/citation:
4 explicit scope + persistence:
Interventions / workarounds:
Remaining unproven behavior:
Failure owner / issue / exact retest:
Bounded acceptance claim:
Mission Control source comment / readback status:
```

Loop: expected result → actual user action → observed receipt → compare → assign
failure → repair → rerun that case on the new build → reconcile handoff and
Mission Control. The implementation owner repairs; the coordinator assembles and
records the candidate; the acceptance owner runs the journey; the human confirms
what actually worked. A skill file alone does not cause already-running sessions
to reload instructions.

The full #5504 rehearsal is larger than this smoke test. Attachment survival,
conversation races, simultaneous identity corrections, sign-in recovery and any
conditional progress-stream cases still need their applicable acceptance rows.
Second-technician access needs a real second account. Do not label those passed
from this walk.

## After this pilot

1. BRAVO Codex completes the already-authorized #5510 correction; BRAVO Claude
   performs the granted final review against that new snapshot.
2. CHARLIE Codex refreshes the single integration candidate, reconciles owners and
   versions, and obtains the applicable database execution, review and hosted CI
   for that exact composition. Arrange deployment and device work only under the
   existing grants or a concrete release request.
3. On the deployed accepted combination, repeat these same two component questions
   plus machine-print grounding, page cautions and citation honesty. Include
   negative model/tenant and corrected-evidence cases at the layer that actually
   enforces them. Capture the current database/CI gaps rather than implying they ran.
4. For the next memory increment, finish #5543 review, wire retirement into the
   actual correction path, and test correction → approval → retrieval end to end.
5. Before any live-state/UNS demonstration, assign and fix #5540: command is not
   feedback; an unread fault register is unknown; readings need time and quality.
   Then prove the same contextualized data reaches an independent consumer. A
   notebook/component pilot alone is not proof of a complete UNS or Industry 5.0
   system, and it cannot establish any named expert's endorsement.

## Reporting finding from this review

CHARLIE Mission Control /healthz and /api/snapshot.json were reachable. Its lane
cards included stale BRAVO-CODEX ownership, a stale CHARLIE-CLAUDE card with
unparsed fields, and a fresh BRAVO-CLAUDE card whose top summary still said the
coordinator was unstaffed. Some newest updates were appended below stale fields.
The parser accepts one plain [DELIVERY-UPDATE: LANE] marker and the first field
of each name. Owners must replace the current block and verify consumer readback;
refreshing the timestamp alone is insufficient. This review did not overwrite
another session's live report.
