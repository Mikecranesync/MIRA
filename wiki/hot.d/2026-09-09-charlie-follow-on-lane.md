## 2026-09-09 — CHARLIE follow-on lane (session_013qHdfeCVeFpHsZWwmdpN36)

Four PRs opened, none merged (Mike's word): #3715 (#3708 Python asset bridge mirror + Contract 7 — every Python `INSERT INTO cmms_equipment` must go through `bridge_asset`), #3716 (#3712 `/api/hub/ask/` slash), #3717 (`/api/hub/ask` behavioural contract, M5/M6), #3718 (#3707 item-3 probe: tokens declared at runtime — prod measured web 78 / **hub 0**).

⚠️ #3704 was a **false gate failure**, not a prod defect: the Scenario-2 fixture is byte-identical across runs, content-dedup lists it under the 2026-08-18 name. Red since Aug 18. Fix is in Bravo's #3710 (label-gated on its workflow half). Corrected on the issue.

⚠️ The rows `cmms_equipment_uns_backfill.py` stamped tonight have a **column but no `kg_entities` node** — Hub consumers read the node (`resolveAssetUnsPath`), so they still have no machine memory. Follow-up on #3708. Fourth bypass in TS: `mira-web/src/routes/m-register.ts:264` (guarded).

New: #3719 — canonical `factorylm-tokens.css` and mira-web's served `/_tokens.css` share ~27 of 74/78 names.

Label-gated / Mike: #3706, #3709 (per-merge prod bot restart), #3711 (Cerebras 402), #3707 items 1–2, #3693. Handoff: /tmp/HANDOFF-2026-09-09-follow-on-lane.md.
