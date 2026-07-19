# DriveSense Technician Keypad Workflow — Phone + Keypad + Live Drive

> **Status:** Discovery. The technician-facing arc this phase delivers: a tech at a networked VFD,
> phone in one hand, drive keypad in front of them, gets *fault meaning → related parameter → cited,
> view-only keypad steps* without searching the manual. Grounds the PRD's user stories in a concrete
> walkthrough. Objects: `drivesense_service_pack_schema_proposal.md`.

---

## 1. The scene

A DURApulse **GS10** driving a conveyor motor trips. The line stops. The technician:
- Has **MIRA on their phone** (or is standing at a Perspective "Ask MIRA" HMI panel).
- Is looking at the **physical GS10 keypad** (4-digit display + MODE / ENTER / ▲ / ▼ buttons).
- The drive is **networked** — MIRA already sees its live tags over the UNS-certified connection.
  No one has to type "which machine" — the connection certifies it (`direct-connection-uns-certified`).

The tech does not want to read a 400-page manual on a phone in a noisy plant. They want the answer.

## 2. What flows where

```
        PHONE / HMI (MIRA)                       PHYSICAL GS10
        ─────────────────                        ────────────
  live tags ──▶ CE10 fault detected        ┌── 4-digit display shows "CE10"
        │                                   │   MODE  ENTER  ▲  ▼
        ▼                                   │
  build_drive_diagnostic(snapshots)         │
   ├ assessment: "Modbus comm timeout"      │
   ├ fault_card: meaning/causes/checks       │
   ├ related_parameters: [P09.03] ───────────┼──▶ the tech will navigate to this
   ├ keypad_navigation: steps to view P09.03 ─┼──▶ the tech presses these buttons
   ├ evidence: citations                     │
   ├ unknowns: "manual_cited, not bench-ver" │
   └ safety_warning: (if energized action)   │
        │                                     │
        ▼                                     ▼
  renders ONE DriveDiagnostic on the      tech reads the value on the drive,
  surface (Ask-MIRA text / Hub card)      confirms the setting, decides next step
```

The **live data** (from the drive) and the **guidance** (from the pack) meet on the phone; the
**action** (pressing buttons to *view*) happens on the drive. MIRA never touches the drive — it reads
tags and renders guidance. The tech is the only one who presses a button, and only to **view**.

## 3. The walkthrough (CE10 → P09.03)

**Step 0 — MIRA already knows the machine.** The networked connection certifies the UNS path; no
"are you sure you're looking at the GS10?" (that would be insulting and a latency tax — direct
connections are certified by construction).

**Step 1 — MIRA states the fault and what it means.**
> Drive tripped on a **Modbus comm timeout (CE10)**. The drive stopped talking to its master long
> enough to trip. *Source: GS10 User Manual, Ch.9 Communication (manual_cited).*

**Step 2 — MIRA names the governing parameter.**
> The setting that controls this is **P09.03 — Comm Time-out Detection**: how long the drive waits for
> a Modbus poll before it trips CE10. `0.0` = disabled; any value > 0 = timeout in seconds. Default
> `0.0`, range `0.0–100.0 s`. *Source: GS10 User Manual, Ch.9 (manual_cited).*

**Step 3 — MIRA gives view-only keypad steps.**
> **View P09.03 — VIEW ONLY. Do not press ENTER to change it.**
> 1. Press **MODE** until the display shows a parameter group.
> 2. Use **▲/▼** to select group **P09** (Communication).
> 3. Press **ENTER** to open the group, then **▲/▼** to **P09.03**.
> 4. The value shown is the current comm-timeout setting.
> *Confidence: medium — from the manual, not bench-verified.*

**Step 4 — the tech reads the value on the drive and decides.**
- If `P09.03 = 0.0` but CE10 still tripped → the timeout isn't the cause; check RS-485 wiring / the
  master (MIRA's `first_checks` already said so). 
- If `P09.03` is a small value and the master is slow → the setting may be too aggressive; a control
  engineer can adjust it later (editing is **out of scope for MIRA** — view-only).

**Step 5 — honesty.** MIRA's `unknowns` line said the keypad path is `manual_cited`, not
bench-verified — so the tech knows to sanity-check the button labels against their unit. Once someone
confirms the steps on a real GS10, that card is promoted to `bench_verified` and the confidence rises.

## 4. What makes this different from "chat with the manual"

| Raw manual RAG | DriveSense keypad guidance |
|---|---|
| Quotes a paragraph that *mentions* P09.03 | Names P09.03, decodes its values, links it to CE10 |
| No button steps, or steps buried in prose | Ordered, structured `keypad_steps[]` |
| Citation = "somewhere in this doc" | Section-level (page when provable), `chunk_id` linked |
| No confidence, no safety framing | `confidence_tier` + mandatory view-only warning |
| Same answer whether or not the drive is faulted | Driven by the **live** fault on the actual machine |

## 5. Safety posture (always)
- **View-only.** Every keypad card carries a mandatory non-empty view-only warning; MIRA never gives
  edit steps in beta.
- **Read-only.** MIRA reads tags; it never writes to the drive. No control action.
- **Safety-keyword supremacy.** If the guidance touches an energized-equipment hazard, the
  `mira-industrial-safety` STOP/escalate behavior wins over the keypad render.
- **Honest confidence.** `manual_cited` + `medium` until bench-verified — the tech is told.

## 6. Surfaces (same object, many renders)
- **Ask MIRA text** (engine + Ignition HMI) — ships first; the walkthrough above is this render.
- **Hub / phone card** — a `KeypadNavigationCard` component (later PR), same data.
- **Slack / Telegram** — deferred until the adapter layer is confirmed ready; the `DriveDiagnostic`
  object is surface-agnostic, so it's a small later consumer.

## 7. Cross-references
- `drivesense_manual_keypad_prd.md` (user stories §4, workflow §5), `drivesense_service_pack_schema_proposal.md`,
  `drivesense_manual_keypad_gap_report.md`, `drivesense_manual_parsing_plan.md`,
  `drivesense_subagent_development_plan.md`.
- `.claude/rules/direct-connection-uns-certified.md`, `.claude/rules/fieldbus-readonly.md`,
  `train-before-deploy.md`, `mira-industrial-safety` skill.
