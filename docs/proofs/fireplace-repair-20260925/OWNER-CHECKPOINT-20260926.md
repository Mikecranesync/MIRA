# MIRA overnight owner report — September 26

**Photo summaries improved in two emulator runs, but the app is not yet ready
to call fully working. A database timeout silently lost one saved photo reading.**

[PR #3999](https://github.com/Mikecranesync/MIRA/pull/3999) remains a draft.
Nothing was merged or deployed to production. Original photos and full
conversations remain private. Failed runs have been preserved.

## What improved

- Fixed the local OpenAI comparison setting so it changes answer generation
  without changing the existing safety checker. Three new checks failed before
  repair; 507 selected checks passed afterward, followed by 21 chat-handler
  checks including a new combined answer/safety case. The build passed.
  Claude's independent source review found no source-supported bugs in that repair.
- Two frozen emulator conversations used all five photos, in original order
  **N** and reversed order **O**. Both summaries kept drawings separate from
  actual equipment and explicitly left their exact match and live electrical
  state uncertain. Earlier physical runs **J/K/L remain FAIL**; they were not rewritten.
- On the new emulator candidate, a passive request for useful label photos was
  answered. A request for safety-relay jumper instructions was refused.
  These two controls do not clear all safety requirements or issue #3984.
- Earlier physical Pixel evidence remains: retry kept the question and photo;
  cold reopening kept six answers and five links; original viewing worked;
  saved photo answers retained their unconfirmed-reading captions on build15.

## What remains wrong or unproven

| Result | Meaning |
| --- | --- |
| N: **UNKNOWN overall** | Summary attribution improved, but fine print, retrieved material, broader controls and physical continuity are not fully verified. |
| O: **FAIL — saved context** | Five photos were answered, but only four interpretations were saved. A database connection timed out; the code logged it and continued. The summary received only four stored observations. |
| M: interrupted | Disk exhaustion interrupted recording; its recovered first answer confirms the now-repaired safety-provider mismatch. |
| Physical replay: **UNKNOWN** | Pixel is connected but securely locked. The new backend has not been replayed on it. |
| Phone → web → phone: **UNKNOWN** | Browser sign-in/certificate handoff remains pending. |

Tiny labels and the power-supply rating remain unverified. A faithful summary
of a mistaken image reading would still be a failure. Local service readiness
also remains partial because `INGEST_URL` is absent.

## Extra phone cases and Jev

Private voltage-tester, sideways contactor-label and terminal-wiring photos were
exercised earlier. They provided useful nearby controls: do not claim a circuit
safe to touch, turn printed ratings into measurements, or invent a missing wire.
They do not establish every character or every safety response as correct.

Jev still flags possible overreach and retrieval mismatch. It is useful for choosing
what to inspect next, not for approving safety, deployment or answer correctness.
It flagged N's improved summary for overreach, so score/answer disagreements need
adjudication before any accuracy claims. Deterministic checks remain appropriate
for missing photos, lost turns and broken links.

## Exact candidate and spending

N/O used local backend source `a6375845f89fb15867b33c98009dee1a45120eaf`, built
`2026-09-26T08:04:10Z`; image
`sha256:625407f4d47e837f0cae4220b9feee35dd127dd097fc218996df2847bd1f704f`.
Emulator app: build15, source `054d6c9283f7eca29a91a5a00d3812b5cd2b96c7`, APK
`aa775242b4d86da06974a01fa5d9d8672dbfb7d27a9855fe2d0d759060e23e39`.
Photo interpretation and answer comparison used OpenAI `gpt-5.5-2026-04-23`;
safety judging retained its existing cascade. Later documentation commits do
not change these frozen runtime identities.

OpenAI accounting reserves **$4.339935 of the $8 cap**, including $1 for earlier
uncaptured usage and conservative reservations when usage is absent. No top-up.
Comparisons are evidence to inspect, not answer keys.

## Next bounded repair and release limits

Repair the demonstrated missing-photo-memory path. Reuse the existing tenant
transaction and visual-observation ledger; distinguish connection acquisition
failure from an uncertain commit before considering any retry. Do not replay a
possibly committed write blindly. Prove recovery plus persistent-outage behavior,
freeze again, and replay the affected workflow.

GitHub checks are separate from local builds: the deployment-env documentation
mismatch was corrected and its checker passes locally. DeepEval still reports
three unexpected offline case failures (`de-fd-01`, `de-in-02`, `de-in-05`);
current-main equivalence has not been established. Exact-head/body independent
Codex review and lifecycle rationale remain required. Claude review does not
replace that gate. #3984 stays open. Owner Proxy governance remains in separate
[PR #4001](https://github.com/Mikecranesync/MIRA/pull/4001).
