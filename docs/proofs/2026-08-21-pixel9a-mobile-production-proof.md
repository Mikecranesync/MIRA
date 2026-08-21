# Pixel 9a — mobile journey proved on physical hardware against production

**Date:** 2026-08-21
**Device:** Google Pixel 9a (`55081JEBF07026`), Android 16, USB-attached
**Build under test:** `origin/main` @ `c475229b` — fresh install (uninstall + install, not an update)
**Production at test time:** mira-hub `v3.279.0`, gitSha `da1d671e` (latest *code* merge; #3350 was docs-only)
**Tenant:** operator-supplied real tenant, not the smoke tenant — see runbook §4d

This closes the one part of the mobile mission the 2026-08-21 emulator run could not meet. The
emulator covered the Capacitor bridge, SAF picker and cookie handling; this run covers real
hardware, a real fresh-install permission grant, the real device camera path, and the real
photo/vision pipeline.

## Result: the grounded chain holds end to end

| Step | Evidence | Verdict |
|---|---|---|
| Fresh install + launch on device | `2026-08-21_pixel9a-signin-prod-tenant_android.png` | PASS |
| Sign in against `app.factorylm.com` | header renders tenant; real work orders load | PASS |
| Native SAF picker → 5.5 MB PDF upload | `2026-08-21_pixel9a-native-saf-picker_android.png` | PASS (~35 s) |
| Ingest → embed, asserted on prod | table below | **PASS** |
| Grounded, cited answer | `2026-08-21_pixel9a-cited-answer-danfoss-p117_android.png` | PASS |
| Citation resolves to verbatim passage | `2026-08-21_pixel9a-citation-verbatim-p117_android.png` | PASS |
| Nameplate photo → structured extraction | `2026-08-21_pixel9a-nameplate-extraction-siemens_android.png` | PASS (with caveat) |
| **Camera capture** | `2026-08-21_pixel9a-photopicker-no-camera-defect_android.png` | **FAIL — see Defect 1** |

## The document

Deliberately chosen to defeat a false pass: **Danfoss VLT AQUA Drive FC 202 Design Guide**, 214 pp,
sha256 `b08c05b36a2ffcd8a46fb201f034b796ca54e909970e8193f43be8742be25555`.

- **Fresh sha256** — never ingested, so it cannot dedupe into a no-op "proof".
- **Different vendor** from the GS10 / PowerFlex corpus, so retrieval cannot succeed by leaning on
  pre-existing chunks. Grounding had to come from *this upload*.

sha256 was verified byte-identical after `adb push` to `/sdcard/Download/`, so the file that reached
production is provably the file that was staged.

## The embedding assertion (CU-03 regression check)

Measured with the sanctioned read-only probe (`gh workflow run db-inspect.yml -f target=prod`).

| | before | after (settled) | delta |
|---|---|---|---|
| `node_attachment` total | 1414 | 2104 | **+690** |
| `node_attachment` embedded | 187 | 877 | **+690** |
| `node_attachment` dark | 1227 | **1227** | **0** |
| corpus-wide total / embedded / dark | 92490 / 91263 / 1227 | 93180 / 91953 / 1227 | +690 / +690 / **0** |

**New chunks == newly embedded chunks (690 == 690); dark unchanged at exactly 1227.** The CU-03
two-cause fix (migration 079 UPDATE grant + `OLLAMA_BASE_URL` on mira-hub) holds on a genuinely
fresh upload originating from a physical device.

### Near-miss worth recording

The **first** post-upload probe read `+690 total / +176 embedded / +514 dark` — which reads as a
regression. It was the async `EMBED_BATCH(16)` pass mid-flight (~43 batches for 690 chunks).

The tell that it was mid-flight, and not a defect, was **internal inconsistency inside a single
probe run**: the per-source-type query reported `node_attachment` dark = 1741 while the corpus-wide
query — run moments later in the same job — reported total dark = 1693, i.e. *lower than its own
subset*. A subset cannot exceed its superset; the embedder was writing between the two queries.

Re-measuring after settling gave the clean 690/690/0 above. **Never report an embedding delta from a
single immediately-post-upload probe.**

## Grounding was verified against ground truth, not just "a citation appeared"

Question asked: *"When do I need to derate this drive"*. Both cited pages were read out of the PDF
independently **before** the upload, so the answer could be checked rather than trusted.

- **Citation [2] — p.117.** Sheet passage: *"…by selecting a larger motor. However, the design of
  the adjustable frequency drive puts a limit on the motor size. Variable (quadratic) torque
  applications (VT)…"* Page 117 reads *"An alternative is to reduce the load level of the motor by
  selecting a larger motor. However, the design of the adjustabl…"* — **verbatim match**.
- **Citation [1] — p.41.** Answer claimed *"the internal temperature exceeds its limit, causing the
  drive to lower its switching frequency and pattern."* Page 41 reads *"In case of overtemperature
  inside the adjustable frequency drive, it derates the switching frequency and pattern."* —
  **match**.

The citation sheet also carries the honest caveat *"Verify against the manual before acting."*

### Answer completeness gap (not a hallucination)

Page 117 §5.1.1 lists **five** manual-derating conditions: altitude above 1000 m, low-speed
operation, long motor cables, large cross-section cables, high ambient temperature. The answer
surfaced **two** (altitude, plus automatic thermal derating from p.41). Nothing stated was false and
every claim was correctly cited — but a technician asking "when do I derate" got under half the list.

This is the retrieval-recall shape already tracked in **#3218** (BM25 rank ceiling on large
single-manual notebooks), now reproduced on a 214-page manual. It is a recall/coverage issue, not a
grounding failure.

## Defects found

### Defect 1 — "Photograph a component nameplate" cannot photograph anything (P1)

Tapping it prompts for **camera permission** (correctly, on fresh install) and then opens
`com.google.android.photopicker/.PhotopickerGetContentActivity` — the gallery. A UI dump found **no
camera affordance anywhere in the picker**: zero nodes matching camera/capture/take-photo.

So the app asks for camera permission it then never uses, and a technician standing at a machine
cannot photograph the nameplate in front of them — they can only pick a photo taken earlier. That
inverts the intended field workflow, and it is invisible on an emulator (no real camera to miss).

The underlying image path is fine — see Defect 2's result — so this is a launcher/intent problem,
not a pipeline problem.

### Defect 2 — nameplate extraction mislabels a plant designation as a serial number (P3)

Feeding a real Siemens photo returned:

| Field | Extracted | Correct? |
|---|---|---|
| Manufacturer | Siemens | yes |
| Model | SIMATIC ET 200SP | yes |
| Catalog/part number | IM155-69NP/2 H2 | close — OCR noise on the IM155-6 part number |
| **Serial number** | `2A.VL5.+51 =K0.1-0-BA` | **no** — that is the IEC 81346 plant designation from the cabinet label (`=2AVL5+51 -K0.1-0-BA`), not a serial |
| Equipment type | Racks | yes |

Severity is low **because the UI gates on a human**: it presents "Confirm this component — read from
the nameplate, edit anything that's wrong" and writes nothing until confirmed. That is the correct
propose-don't-assert posture. The confirmation was **cancelled** in this run rather than committing a
known-wrong serial to a production tenant.

Worth teaching the extractor that `=` / `+` / `-` prefixed strings are IEC 81346 designations, not
serials.

## Not covered by this run

- **Cellular behaviour.** The device was on Wi-Fi throughout. Cellular remains unproven.
- **Play-installed, release-signed identity.** This was a sideloaded debug build. The previously
  installed 2026-08-14 build was signed with a different key, so an in-place update was refused
  (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) and it was uninstalled first. No release keystore exists in
  the worktree (`keystore.properties` absent), so `assembleRelease` was not possible.
- **Streamed SSE.** Answers still land in one buffered chunk (~25 s here). Known gap, not a defect.

## Reproduction notes (Windows / adb)

Traps hit or avoided this run, beyond those already in the handoff:

- The device **locked itself** while unplugged; `deviceLocked=1` blocks everything and needs a
  physical fingerprint. Set `adb shell svc power stayon usb` immediately after connecting.
- `input text` needs `%s` for spaces. Avoid `?` entirely — it is a shell glob on the device side and
  the percent-encoded form is not decoded.
- The leading-character-duplication trap did **not** fire this run, but every field was still read
  back via `uiautomator dump` before submitting. Keep doing that; it is cheap.
- Parse tap targets from `uiautomator dump` bounds rather than from screenshot pixel math — two taps
  in this run went to `0,0` because a naive grep over unsplit XML returned the root node's bounds.
  Split on the node delimiter first.

## Evidence

All screenshots in `docs/promo-screenshots/`, prefixed `2026-08-21_pixel9a-*_android.png`.

This commit also **rescues the prior emulator run's four `2026-08-21_mobile-*_android.png`
screenshots**, which were untracked in every branch and existed only as loose files in a stale
working tree — the sole evidence that the emulator journey passed, one `git clean` from gone.
