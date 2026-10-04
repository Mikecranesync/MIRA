# Pixel device walk — fresh on-device upload→cite (delta #1)

**Date:** 2026-10-04 ~19:00–19:34 EDT
**Device:** Pixel 9a (`55081JEBF07026`), prod `com.factorylm.mira` **v1.2.0 / vc15**, release cert `23:95:B9:60…`, not debuggable, live prod backend (`app.factorylm.com`), account `mike@cranesync.com`.
**Goal:** Close delta #1 from #3881 — prove a *freshly* uploaded manual (not pre-staged) cites on a real device.
**Fixture:** `mira-hub/tests/e2e/fixtures/zephyr-zx9000-service-manual.pdf` — synthetic "Zephyr ZX-9000", stamped "Not a real product (MIRACUSTOMERTEST-7731)", so a citation can **only** come from the upload, never the OEM corpus.

## Verdict — split capability from gate (do not conflate)

- **Capability (upload→ingest→ground→cite→resolve): ✅ PROVEN, content-verified.** A freshly uploaded manual on a real device grounds, cites the uploaded PDF p.1, and the chip resolves to the verbatim passage — same bar as the Micro810 walk, now for a *fresh* upload of a synthetic manual.
- **Beta gate as a stranger experiences it: ❌ STILL BLOCKED by #3920.** The gate's literal scenario is "upload a manual, ask, get a cited answer — no manual fixing." Here the stranger's **first question reliably fails ungrounded** ("not grounded — upload the manual," which they just did) and only works after a **force-quit/relaunch**. A naive stranger bounces. The pipe works; the out-of-the-box product moment does not.

This split is deliberate — overclaiming "gate met" here would repeat the 2026-09-07 recon's "measuring the pipe, reporting it as the product."

| Step | Result | Evidence |
|---|---|---|
| Create notebook on device (New project → machine form) | ✅ (Zephyr / ZX-9000) | 03,04,19–21 |
| Attach PDF via native Android picker (+ → File → DocumentsUI) | ✅ "…pdf · captured for no machine · attached" | 07–11,22 |
| First question right after attach | ❌ **ungrounded** — "General guidance — not grounded in this machine's documents" / "I couldn't find anything…upload the manual" | 13,14,17,23 |
| Sources drawer right after attach | ❌ shows **Sources (0)** (persisted >5 min, 2 asks, in-app nav) | 15,16,18 |
| **After full app reload** | ✅ drawer flips to **Sources (1)** on both test notebooks | 26,27 |
| Re-ask ZX-451 after reload | ✅ **grounded + cited** | 28 |
| Answer content vs ground truth | ✅ exact: "Hydraulic Pressure Sensor Drift on PT-7… recalibrate PT-7 to 4.2 mA; torque 4 manifold bolts 38 Nm cross-pattern; cycle E-stop twice; confirm DECK 210 bar/60 s" | 28 |
| Citation target | ✅ **FILE zx9000-device-upload-test-2026-10-04.pdf p. 1** (the uploaded file) | 28 |
| Citation chip resolves to passage | ✅ verbatim source text + "Open original at cited page 1" + "Verify against the manual before acting" | 29 |
| BACK ladder (sheet → notebook) | ✅ BACK closes citation sheet, notebook stays | 30 |

## What the device actually isolates (reload, not elapsed time)

I did **not** see server state (no prod DB access — prohibited), so I don't claim "upload persists instantly." What the device cleanly shows is that **client visibility, not ingest time, was the gate** — the drawer flip tracked the *reload*, not the *clock*:

- Notebook **A**: uploaded 19:13:55 (no machine fields, "captured for no machine"). Ungrounded at 19:18; **Sources(0) through 19:29 — ~16 min, no reload**. Force-quit/relaunch ~19:31 → **Sources(1)**. Re-asked 19:40 (no new upload, no reload) → **grounded + cited to …pdf p.1**. 16 min >> any 2 KB-PDF embed, and nothing grounded until the relaunch.
- Notebook **B**: same shape; grounded + cited after reload, content-verified, chip resolves.
- A grounding with **no machine fields** also kills the earlier "captured for no machine" confound — machine identity is irrelevant to whether the upload grounds.

This is **consistent with #3920's prior evidence** (server reported `sourceCount:1`, `status:parsed`, `user_confirmed` while the client still showed Sources(0)); the server-side mechanism is #3920's finding, not something this session proved. "Client-refresh bug" vs "slow async ingest" is further supported by the reload-tracking above, though only #3920's server trace fully nails the mechanism.

**#3437 contradiction worth escalating:** #3437 is an **open P0** asserting *no fresh per-tenant upload is citable on prod* (`MIRA_ENFORCE_APPROVED_RETRIEVAL` + `verified=true` gate). This session cited **three** fresh uploads on live prod (A, B, and the content matched). Either #3437 is **stale / since-mitigated**, or the mobile upload path sets `user_confirmed`/`verified` and bypasses the gate. Not confirmable from the device — but a live-prod data point contradicting an open P0's premise warrants a backend check and possibly a re-scope/close of #3437.

## Honesty contract: solid on mobile (contrast with #4224)

Every ungrounded answer was clearly labeled ("not grounded in this machine's documents"); with machine identity set, MIRA **refused to guess** and asked for the manual. This is the *opposite* of the #4224 quickstart violation — on this surface, when it can't cite, it says so.

## Also corroborated (fresh device evidence, prod v1.2.0)

- **#3920 (P1)** — composer-attach first answer ungrounded + drawer stuck at Sources(0) until reload. **Primary corroboration.**
- **#3923 (P2)** — tapping a notebook's "Sources (N)" entry while that notebook is open is inert (returns to chat, no source manager). Observed.
- **#4025** — the Micro810 citation chip shows the raw basis key "oem_documentation". Observed (screenshot 25).

## On-device retrieval (control): works for sourced notebooks

Fresh question in the pre-staged QA Micro810 notebook (Sources 1): grounded "0 °C up to 55 °C", cited **oem-manual.pdf p.62/57**, "Grounded in this notebook's sources", chips present (24,25).

## Not closed this session

- **Delta #2 (cold stranger / new tenant, #2909)** — remains; blocked on-device tonight by the no-prod-user-seeding rule (`project_hermes_qa_account.md`). This walk used Mike's established account.
- Cold-start "Network problem" (#3924) did **not** reproduce this session (clean cold launch at 19:31).

## Housekeeping

- Two clearly-named disposable test notebooks left on the tenant (never deleted, per real-device etiquette): `ZX9000 device upload test 2026-10-04` (confound: machine fields mis-entered via keyboard-scroll drift) and `ZX9000 upload test B 2026-10-04` (machine fields correct — the proof notebook). The keyboard-scroll field-drift on the New-project form is a minor UX nit worth noting.
- Device restored: rotation auto, stay-awake off, returned HOME. No work orders touched.

## Committed screenshots (this PR)

- `docs/promo-screenshots/2026-10-04_device-fresh-upload-cite-grounded_android.png` — grounded + cited answer from the fresh upload (notebook B, post-reload)
- `docs/promo-screenshots/2026-10-04_device-fresh-upload-cite-citation-resolves_android.png` — citation chip resolves to the verbatim source passage (p.1)
- `docs/promo-screenshots/2026-10-04_device-upload-citable-after-reload-no-machine-fields_android.png` — notebook A (no machine fields) grounds after reload; kills the "captured for no machine" confound
- `docs/promo-screenshots/2026-10-04_device-3920-first-answer-ungrounded_android.png` — the #3920 first-answer-ungrounded state right after attaching

Raw 31-shot evidence set + dumps live on the Bravo node at `dogfood-output/device-upload-zx9000-2026-10-04/` (not committed).
