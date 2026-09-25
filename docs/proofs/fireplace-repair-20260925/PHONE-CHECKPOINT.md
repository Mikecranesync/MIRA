# Pixel repair checkpoint

2026-09-25, local HTTPS candidate over USB, designated staging QA account. This is a development checkpoint, not exact-head release acceptance. APK 1.2.1-fireplace-local/build13, sha256 `446d56c55a645ff1a4317deef8835ce6b32e8e460f6a236d0c9077740109555a`, built from89e21505d. Hub development server changed during checks; full answer acceptance must be repeated after freezing the final source.

Fresh project: Fireplace phone repair B — Sept25. Actual Pixel native photo picker selected original sensor-panel photo. Private media and exact transcripts remain only in private-run-b; do not publish those directories.

Observed:
- Mounted-project Sources navigation opens the Sources panel and Add sources sheet.
- Photo preparation status appears29ms after Send and remains visible while processing.
- Photo submission succeeds and draft clears. First response visible within15.2s.
- Open original photo retrieves and displays the authenticated3000x4000 original in the app sheet. Visually confirmed on physical screenshot; not merely a resolved URL.
- First answer still FAILS correctness: unsupported power-supply brand, setpoint enumeration mistaken for amp values, and unsupported inference of actual electrical output with unrequested meter advice. Reported to backend owner for raw-extraction-versus-synthesis diagnosis. This is not accepted as correct.

Earlier local-origin authentication and localhost routing failures were test-environment setup failures. They are not counted as fresh product defects or successful diagnostic turns. Production app and existing owner conversations remain untouched.

Additional physical checks:
- Legacy photo chat→New chat with completed greeting→legacy photo chat→named chat succeeds, with both sidebar entries retained.
- Deliberately removed only this candidate's USB backend reverse. Native photo send failed honestly; original text returned and Try again appeared. Restored reverse and tapped Try again once: the retained Honeywell photo uploaded, one question/answer was recorded, and answered draft cleared. The new answer still contains questionable label readings, so this is a retry-flow pass only.
- Force-stop/relaunch of staging app preserved both chats; opening the named chat restored greeting and photo exchange, including its photo ID. Persisted badge reads “Grounded in workspace evidence.” Exact local transcripts retained.
- Draft PR3999 created for review. Initial CI includes passing Hub/mobile/sharedUI tests; Legacy UI Lifecycle Guard remains red for missing substantive rationale/exact-head/exact-body ledger. No bypass, merge, release acceptance or deployment attempted.
