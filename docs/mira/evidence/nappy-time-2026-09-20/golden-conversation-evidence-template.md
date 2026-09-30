# Golden Conversation evidence sheet — TEMPLATE (copy per run; never edit the template in place)

One run = one **artifact** on one **physical device** against one **production SHA**. A row is `PASS` only with the
named evidence attached; `NOT TESTED` is the default and stays until the check actually ran on this artifact. Emulator
runs are component evidence: keep them in a separate copy of this sheet labelled `EMULATOR — NOT ACCEPTANCE`.
No credentials, cookie values, customer data, or personal-photo content in this sheet — IDs, hashes, counts, timestamps only.

## A. Identity (fill every cell before step 1; blank = the run is invalid)

| Field | Value |
|---|---|
| Run label | `golden-<yyyy-mm-dd>-<artifact-short-sha>` |
| `approved_rc_sha` (40 hex) | |
| Built from (`git rev-parse HEAD` in the build worktree; must equal the row above) | |
| Native fingerprint (`scripts/native-fingerprint.mjs`) | |
| APK sha256 | |
| APK signer cert SHA-256 (`apksigner verify --print-certs`) | expected `2395b96050c510a5c787465b83256f381b1ff5e4833d2fa88db73579293f92a9` (CN=FactoryLM upload key) |
| `versionName` / `versionCode` (`aapt dump badging`) | |
| `application-debuggable` present? | must be **no** for acceptance |
| Installed proof (`adb shell pm path` → `adb pull` → sha256 equals APK sha256) | |
| Device (serial, model, Android) | |
| Production `/api/health/` `gitSha` + `builtAt` at run start | |
| Production `/api/health/` `gitSha` at run end (must be unchanged) | |
| Tenant type (synthetic / owner; never the tenant id of a customer) | |
| Account role | |
| Project (notebook) ID | |
| Thread ID | |
| Manual: filename, sha256, page count, **expected page read from the PDF before asking** | |
| Driver | session / peer id |
| Start / end (UTC) | |

## B. Rows (PASS / FAIL / NOT TESTED)

| # | Check | Expected | Evidence to attach | Result | Notes |
|---|---|---|---|---|---|
| B1 | Sign in, create Project from the New-project form | project opens; **drawer lists it with `Sources (0)` without relaunch** (#3895) | a11y dump / screenshot | NOT TESTED | |
| B2 | New project reachable **from inside a conversation** (#3896) | form opens, no "Not available in this workspace yet." | screenshot | NOT TESTED | |
| B3 | Upload the manual → searchable | `POST …/files/` 201 → `…/sources/` → "Searchable source" ≤ 3 min | netlog path/status + screenshot + elapsed | NOT TESTED | |
| B4 | **Text-first** manual question | answer + citation chip to the **pre-read expected page**; body carries `sourceDocIds ≥ 1`, no `mode:"general"` | netlog body keys + screenshot | NOT TESTED | |
| B5 | Citation opens the correct passage | sheet shows the expected page text; "Open original at cited page N" | screenshot | NOT TESTED | |
| B6 | Grounding badge honest | cited → "Grounded in this notebook's sources."; **uncited → NOT badged grounded** (#3900) | screenshot per turn | NOT TESTED | #3900 open |
| B7 | **Photo-first**: camera capture → chip → send with a photo question | `/look/` 200 → `/chat/` `visualEvidence.fileId` == `/look/` fileId → PHOTO OBSERVATION card with the same id; **answer uses the observation** (needs #3874 on prod) | netlog fileIds + screenshot | NOT TESTED | |
| B8 | Photo hazard (structured LOOK STOP, #3907) | a positive hazard observation yields a STOP, not an answer | screenshot | NOT TESTED | |
| B9 | **Upload failure + retry** (radios off on send) | banner; Try again re-sends **with the photo**; one `/look/` per attempt; no stale photo rides the next unrelated send (#3863) | netlog sequence + screenshots | NOT TESTED | |
| B10 | **Evidence association** | the card's fileId / capturedAt equals the persisted turn's `visualEvidence` after reload (server truth via `GET …/?threadId=`) | JSON excerpt (ids only) | NOT TESTED | |
| B11 | **Close / reopen safety state** (#3912) | a STOP turn re-hydrates as STOP (banner + LOTO text, no answer/provider card) after `force-stop` + relaunch + open | before/after screenshots | NOT TESTED | |
| B12 | Cold restart resumes the **last-viewed** thread (#3851) | open a non-latest thread → restart → project opens on it; pointer unchanged | screenshots | NOT TESTED | |
| B13 | Cold restart restores the full thread | all turns, chips, cards render | screenshot | NOT TESTED | |
| B14 | **Simultaneous phone + web sends** (same thread) | both turns persist, each once, in causal order; `clientRequestId` dedup holds (088/089) | turn ids from the server + both screenshots | NOT TESTED | needs prod migrations |
| B15 | Web `/v3` shows the same Project + thread | prior messages, photo/evidence state, citations render on the **shared shell** (not the legacy page) | screenshot | NOT TESTED | needs #3879 |
| B16 | Web follow-up → persisted turn id | turn id recorded | JSON excerpt | NOT TESTED | |
| B17 | **Phone → web → phone** continuity | the web turn appears **exactly once** on the phone after relaunch, with its citation | `innerText` match count + screenshot | NOT TESTED | |
| B18 | OTA "Check now" honest | reports the real manifest state (today the store 404s — must not read "Up to date") | screenshot + manifest URL status | NOT TESTED | store not migrated |
| B19 | No credential in logcat (#3903) | zero `session-token` / `Capacitor`-tag lines over the run | counts only | NOT TESTED | |
| B20 | Restore + release | original APK reinstalled byte-verified (or RC left installed by Mike's decision), fixture files removed, `adb forward --remove-all`, PHONE RELEASED posted | sha + hub announcement link | NOT TESTED | |

## C. Verdict block

```text
Outcome proven:
Issue / criterion: #3881 (artifact) / #3882 (cross-surface)
Primary / backup:
Worktree / branch:
Base SHA / exact tested head (== approved_rc_sha):
Files changed or inspected:
Commands, UTC timestamps, exit codes, artifact locations:
PASS / FAIL / NOT TESTED rows: (count each)
Independent verdict and reviewed SHA:
Remaining blocker:
Next action and owner:
Exact approval required:
Unauthorized operations confirmation:
```

A sheet with any `NOT TESTED` row in B4–B17 is **not** physical-device acceptance. A sheet run on an emulator is never
acceptance regardless of rows.
