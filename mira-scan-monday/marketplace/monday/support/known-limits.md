# MIRA Scan — Known Limitations

Honest, current as of 2026-05-05.

## Vision-extraction limits

- **Multi-line model numbers** (`PowerFlex 525\n22A-D2P3N104`) are sometimes concatenated into one field. Split before saving.
- **Hand-written nameplates** (post-replacement field labels) often misread.
- **Plates entirely behind a guard** can't be extracted — try lifting the guard or photographing through the gap.
- **Non-Latin character sets** (Cyrillic / Japanese / Chinese) work but at lower confidence; we recommend reviewing extracted values carefully on imported equipment.

## Manual-coverage limits

- **OEM coverage today:** Yaskawa, Allen-Bradley / Rockwell, Siemens, ABB, Beckhoff, Schneider, Omron, AutomationDirect, Mitsubishi, Phoenix Contact, Danfoss, Lenze, SEW, Eaton, Fluke, Panduit, IDEC, MEAN WELL, Festo, ifm, Balluff, Banner, Pepperl+Fuchs, Baldor, WEG, SMC.
- **OEMs not yet covered** auto-trigger a real-time web search; if the OEM doesn't publish their manuals as direct PDFs, the panel will say "no manual found automatically" and offer an FactoryLM-side review path.
- **Multi-page manual viewer is not yet built.** Today the chat returns cited answers but doesn't render the page itself in the panel.

## Monday integration limits

- **Per-board column mapping is server-side only** during beta. If your columns don't match the defaults, email support@factorylm.com.
- **No bulk operations.** One scan, one item write. Bulk-scanning a whole rack is roadmap.
- **The panel doesn't trigger automations.** Monday's automation engine fires on column updates, so saving from MIRA Scan does trigger them — but the scan event itself isn't a Monday trigger you can build automations against.

## Authentication limits

- **OAuth tokens are long-lived.** If your monday admin rotates the org-level OAuth grant, the panel surfaces a "please reinstall" state and the user has to redo the install.
- **No per-user granular permissions.** Once a workspace admin installs, every user can scan and write to monday columns. Fine-grained ACL is post-beta.

## Compliance / certifications

- **Not SOC 2 audited directly.** Inherited compliance via monday.com, AWS (NeonDB host), OpenAI, Groq, Cerebras, Google Cloud — all SOC 2.
- **No HIPAA / FedRAMP / ITAR clearance.** If your environment requires these, contact us for an enterprise pilot.

## Performance limits

- **Vision extraction:** typically 2-4 seconds per scan.
- **Chat first-token latency:** typically 500-1500 ms; full response 3-8 seconds.
- **Real-time manual search:** 5-15 seconds end-to-end on a KB miss.
- **Heavily-loaded NeonDB:** queries time out at 5 seconds (configurable via `DB_QUERY_TIMEOUT_MS`); if you see "queue unavailable" errors, contact support.

## Roadmap

- Multi-page manual viewer in-panel (post-launch)
- Per-board column-mapping UI (post-launch)
- Bulk rack scan (post-launch, requires phone+laptop split UX)
- SOC 2 Type II audit (when revenue justifies it)
- Native UpKeep variant of the same product (Phase 2 of the marketplace plan)
