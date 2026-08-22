# Mobile journey E2E — emulator harness

Replays the MIRA technician journey against a deployed environment **without borrowing a
physical phone**.

```bash
export FLM_EMAIL='...' FLM_PASSWORD='...'
bash tools/mobile-e2e/run.sh ~/Downloads/some-manual.pdf "When do I need to derate this drive" 117
```

`run.sh` boots an emulator (cold, no snapshot), builds the debug APK if it is missing, then
runs `journey.py`. Exit code 0 = the grounded chain verified; non-zero = a named failure.

## Why it exists

The 2026-08-21 Pixel 9a proof
(`docs/proofs/2026-08-21-pixel9a-mobile-production-proof.md`) tied up a real phone for about
90 minutes. Reviewing what actually needed hardware: **almost none of it**. Sign-in, upload,
ingest, retrieval, citation rendering and citation resolution are all device-agnostic — the
mobile app is not a fork, it calls the same Hub route the desktop does
(`POST /api/equipment-notebooks/{id}/chat/`).

So this harness covers the whole chain, and is explicit about the three things it cannot.

## Coverage

| Leg | Emulator | Note |
|---|---|---|
| Fresh install + permission grant | yes | uninstall-then-install, so the grant is re-exercised |
| Sign in | yes | cold boot each run, so the cookie jar cannot mask a broken sign-in |
| SAF picker + multipart upload | yes | the picker is the same system component |
| Ingest → embed | yes | server-side; assert separately with the DB probe below |
| Grounded cited answer | yes | |
| Citation resolves to a passage | yes | |
| Nameplate → extraction | partial | needs a **real photo** via `--nameplate`; see below |
| **Cellular behaviour** | **no** | emulator uses the host network |
| **Camera capture** | **no** | and see the P1 defect below |
| **Release-signed Play identity** | **no** | needs a keystore + `assembleRelease` |

Those last three are the only legitimate reasons to reach for real hardware again.

## Design decisions worth keeping

**Find elements by text, never by pixel coordinates.** The physical run hardcoded taps
computed from Pixel screenshots (1080x2424); none of that transfers to another screen. The
harness parses `uiautomator dump` and matches on text.

**Match the *smallest* node containing the text.** Ancestors inherit descendant text, so a
first-match lookup returns the root element and you tap `0,0`. Two taps were lost to this
during the physical run. `Device.tap()` now hard-refuses `0,0` rather than silently missing.

**Read fields back before submitting.** The first `input text` after a tap can duplicate its
leading character (`pprod.smoke...`). `type_into()` verifies; the masked password field can't
be read back, so sign-in asserts on the *outcome* instead.

**No `?` in questions.** `input text` does not decode `%3F`, and a bare `?` is a glob on the
device shell. `type_text()` raises rather than let a literal `%3F` reach the chat box.

**Cold-boot the emulator.** With a snapshot, a surviving session cookie turns "sign in" into
a no-op that passes forever without testing anything.

**Skip, never fake.** No `--nameplate` means the leg reports SKIP. A generated nameplate image
would not exercise real-photo OCR — synthetic fixtures pass while real photos fail.

## Verifying the embedding assertion

`journey.py` proves retrieval works; it does not read the database. For the CU-03 assertion,
pair it with the sanctioned read-only probe, **before and after**:

```bash
gh workflow run db-inspect.yml -f target=prod
```

Assert **new chunks == newly embedded chunks, dark unchanged**.

Two traps, both hit for real on 2026-08-21:

1. **Do not trust an immediately-post-upload reading.** Embedding is an async
   `EMBED_BATCH(16)` pass. The first probe after a 690-chunk upload read `+690 total /
   +176 embedded / +514 dark`, which looks exactly like a regression. Settled, it was
   `+690 / +690 / 0`. Re-measure before reporting anything.
   The tell was an internal contradiction inside one probe run: the per-type query said
   `node_attachment` dark = 1741 while the corpus-wide query moments later said total
   dark = 1693 — lower than its own subset, which is impossible.
2. **A `cancelled` run conclusion is not invalid output.** `db-inspect.yml` has
   `timeout-minutes: 5`; against prod the later steps get cancelled while the grants and
   coverage steps have already printed.

## Known defect this harness documents

**P1 — "Photograph a component nameplate" opens the photo picker, not a camera.** It requests
camera permission and then launches
`com.google.android.photopicker/.PhotopickerGetContentActivity`, which has no capture
affordance at all. A technician at a machine cannot photograph the nameplate in front of them.
The `nameplate()` step logs this rather than hiding it. When the defect is fixed, that branch
should start failing — which is the point.

## Requirements

- Android SDK with `platform-tools` and `emulator`, plus at least one AVD
- Python 3.12
- JDK (Android Studio's bundled `jbr` is fine) only if the APK needs building
- `FLM_EMAIL` / `FLM_PASSWORD` in the environment — never hardcoded, never committed

A tenant whose trial has expired is paywalled off `/equipment/` and sign-in will fail; see
`docs/runbooks/hub-embedding-production-rollout.md` §4d.

## Emulator caveats (learned the hard way validating this)

**Give the AVD 4 GB and 4 cores.** The default 2 GB AVD ran at 1.88/2.0 GB with 1.09 GB
swapped, and SystemUI + the launcher ANR'd continuously under that pressure. Every ANR is a
modal that blocks the next tap. `run.sh` does not set these -- configure the AVD, or launch
with `-memory 4096 -cores 4`.

**Error dialogs are suppressed, not tolerated.** `install()` sets
`settings put global hide_error_dialogs 1` and zeroes the three animation scales. Reactively
dismissing ANRs does not work: they recur faster than the poll loop clears them. This hides
the *dialog*, not the condition -- a genuine app hang still surfaces as a step timing out.

**The chat composer has no accessible placeholder on an emulator.** On a real Pixel the input
exposes `text="Ask a question..."`; on the emulator that node's text is empty. Label lookup
therefore works on hardware and silently fails on an emulator, which is why `ask()` targets
the bottom-most `EditText` structurally via `bottom_edit_text()`.

**Bugs this harness found in its own first runs** -- worth keeping, because each is a trap any
future adb driver will hit:

| Symptom | Real cause |
|---|---|
| `field 'Email' read back 'mimikk'` | full-string `input text` outruns the WebView; chunk it and verify-retry |
| `field 'Email' read back 'mmike@...'` | the documented leading-character duplication -- caught by read-back, fixed by retry |
| tapped `0,0` | ancestors inherit descendant text; match the *smallest* node, and refuse to tap `0,0` |
| `Sign in` did nothing | the heading TextView is smaller than the Button; restrict to `clickable` |
| `Chat` toggled a checkbox | "Include this source in notebook chat" contains "Chat" and is smaller; prefer an EXACT label match |
| `never appeared: 'Manufacturer'` | one-directional scroll overshoots; scroll to top first, then walk down |
| `never appeared: 'Uploading'` | a small PDF finishes before the spinner is observable; never assert a transient state |
| `cannot stat` a local path | `MSYS_NO_PATHCONV=1` (needed for device paths) also stops local-path conversion; normalize at the argument boundary |

## Validated

Full green run 2026-08-21 on `Medium_Phone_API_36.1` (4 GB) against production, no physical
device: sign in -> notebook -> upload (sha256 verified) -> searchable -> cited answer citing
the expected page -> citation sheet returning the verbatim passage -> nameplate honestly
SKIPped. Exit 0.
