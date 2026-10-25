# Publication workflow proposal: weekly batch

Status: proposal retained for Mike's decision, 2026-10-25. The governing review sequence is [STYLE-GUIDE section 10](STYLE-GUIDE.md#10-review-and-publication). This file does not create a second approval process.

## What Grokbot relayed

The original draft recorded “Blog posts publish once they pass the fact check” as relayed intent. That relay did not establish which exact revision, publishing mechanism or release authority was approved. Apply any direct, applicable approval already recorded; do not ask Mike to approve the same action twice.

## Proposed mechanism

Content Studio supplies corrected posts and source records. Search Steward completes technical/editorial checks and records the exact reviewed revision. Foreman packages ready posts in one weekly PR. Mike's authorized merge or other explicit release instruction can approve publication of that reviewed batch under the existing repository policy.

A passing fact check means ready for the owner/release decision; it does not itself authorize publication. Use separate technical-review, owner-approval and publication records even if the existing front matter exposes only a single `status` field.

Scheduled dates only work after the visibility mechanism is implemented and verified across direct routes, index, sitemap, feeds and related links. Dates in filenames do not schedule delivery. Later edits require rechecking the affected evidence; unrelated valid checks can be reused.

This style-guide PR approves neither the three attached posts nor a daily publishing automation. Keep the existing authority until the publishing mechanism and applicable approval are established.
