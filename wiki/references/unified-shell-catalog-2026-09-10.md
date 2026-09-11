---
title: Unified shell Pixel catalog 2026-09-10
type: reference
updated: 2026-09-11
tags: [ui, catalog, pixel, unified-shell]
---

# Unified shell Pixel catalog — 2026-09-10

IR / onboarding must not guess the unified shell. This page is the short catalog index required by `docs/ux/FACTORYLM_UI_DESIGN_POLICY.md` §2 / §12 and the Foreman A+B note on [#3746](https://github.com/Mikecranesync/MIRA/pull/3746#issuecomment-5627490178).

**This checkout cannot see Bravo disk.** Filenames below stay `PENDING Bravo ls`. Do **not** invent names.

**Bravo catalog session status (2026-09-11):** `cao-UX-3746-CATALOG-AB-bfa06c06` handed off + **stopped**. Gateway latch **clear** (`current_session=null`). Task still `done=false` (handoff file `UX-3746-CATALOG-AB.HANDOFF.md`; no `ls` fill landed on this branch). Catalog A is therefore **not PASS**. Light B frames were **not** attached to #3746.

**Pixel dogfood scoreboard (tip `#3746` `f8913760b814`, SHA prefix `b6f001da`, unified).** Pack still at `/Users/bravonode/mira-dogfood/proofs-2026-09-11/` (filenames PENDING `ls` from this checkout). Cron through 14:46 ET. Do **not** claim Pixel-ready. No merge / deploy / OTA.

| Item | Result | Note |
|---|---|---|
| Bound-machine Ask | **PASS** (11:20 ET dogfood) | Harrington UMS3-0335 grounded |
| L0 `What is a VFD?` / no machine | **PASS** (same walk) | Still educational / unbound L0 |
| Camera human tap (`+` → Camera) | **FAIL** | `+` opens **Add sources**, not Camera |
| Nav smoke | OPEN | Not scored in the 11:20 note |
| 12-screen walk | NOT RUN | |

## Build association

| Item | Value |
|---|---|
| Live dogfood PR | [#3746](https://github.com/Mikecranesync/MIRA/pull/3746) (draft, behind `main`) |
| Dogfood head | `f8913760b814d8edadf7375662605759215c7af6` |
| Stack base | #3745 @ `41e8ecc80d9069e88611de70b5ff9ba6799600f1` |
| Shell flag | restored `flm.chatui.v1=unified` |
| Bravo pack | `/Users/bravonode/mira-dogfood/ui-catalog-2026-09-10/` (+ zip on Bravo only) |
| First proof pack (claimed) | `/Users/bravonode/mira-dogfood/proofs-2026-09-11/` (Pixel #3746 `f8913760b814`; filenames PENDING `ls`) |
| Policy | MIRA PR #3748 @ `58b36e2edc8270d9b0d610cab00c5567c1ad6b2a` |
| Inventory | [[../docs/ux/FACTORYLM_UI_DESIGN_SYSTEM_INVENTORY]] (repo path `docs/ux/FACTORYLM_UI_DESIGN_SYSTEM_INVENTORY.md`) |

## What the unified shell is

One product, two modes:

- **Ask** — conversation + composer. Empty Ask on `main` is the paragraph `No turns yet.` (`Conversation.tsx`). No-machine is first-class (`What is a VFD?` **PASS** as L0 educational on this tip).
- **Work** — same shell/tokens/composer; lab empty Work is `No diagnostic run exists for this thread in the lab.`
- **Sidebar** — `Sidebar` + `ProjectTree` drawer/column. Same row grammar for projects/threads/machines.
- **Scan / nameplate** — attachment sheet + native scan/nameplate hosts. Frames may be attached; Camera-open may not.
- **Sensor** — sensor sheet on the unified host, not a second app.
- **Classic Workorders** — continuity / rollback evidence. Frozen legacy presentation. Do not restyle it to match the shell.

## Manifest (filenames PENDING Bravo)

Policy says the catalog is **12 unique screens + classic Workorders**. Do not invent the twelve names from memory. Bravo must `ls` the pack and fill `evidence_file`.

| State | Expected context | Evidence file | #3746 attach? | Acceptance |
|---|---|---|---|---|
| Empty Ask | unified Ask, no turns | PENDING Bravo ls | yes (light B) | frame only; not an interaction proof |
| Work | unified Work | PENDING Bravo ls | yes | frame only |
| Sidebar | nav drawer/column open | PENDING Bravo ls | yes | frame only |
| Scan / nameplate | scan or nameplate sheet | PENDING Bravo ls | yes | frame only |
| Sensor | sensor sheet | PENDING Bravo ls | yes | frame only |
| Classic Workorders | legacy continuity | PENDING Bravo ls | yes | frame only; frozen tree |
| Remaining catalog states (up to 12 unique) | PENDING Bravo ls | PENDING Bravo ls | no (not light B) | listed only after `ls` |
| Camera-open (`+` → Camera) | #3746 exact build | **do not attach** | **no** | **FAIL** — human tap: `+` → Add sources, not Camera |
| `What is a VFD?` / no machine | general Ask, no machine selected | PENDING `ls` in proofs-2026-09-11 | no | **PASS** — L0 still educational on this tip |

## Light B attachment rules

Attach only the six selected frames to #3746, captioned `#3746` / unified shell. Do not attach the zip. Do not attach Camera-open. Do not flip Camera to PASS from a screenshot — the 11:20 walk scored it **FAIL**.

## Open acceptance (keep visible)

- Camera human tap on **this exact #3746 build**: **FAIL** (`+` → Add sources)
- Bound-machine Ask (Harrington UMS3-0335): **PASS**
- `What is a VFD?` with **no machine**: **PASS** (L0 educational)
- Nav smoke: OPEN
- 12-screen regression walk: NOT RUN
- Merge / deploy / OTA / Pixel-ready: **not authorized**
