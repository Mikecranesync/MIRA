# CV-101 — V7 technician confirmations (provenance for OI-27 close + supply)

Direct technician (Mike) confirmations given in the 2026-07-11 working session, recorded here so the
sheets' "technician-confirmed" claims cite a real source (closes an auditor-flagged provenance gap
where E-003/E-009 cited `PHOTO_EVIDENCE_V6.md`, which predated these confirmations and still showed
the 480 V / pending state).

## Confirmations (technician, 2026-07-11, working session)
1. **Supply is 230 V single-phase (2-wire).** "it's two thirty coming in … only two wires, high
   voltage on the MLC contactor." → E-003 input = 230 V 1φ (verified by technician). Supersedes the
   earlier "3-phase in" and the "supply voltage/phase NOT DOCUMENTED" caveat wording.
2. **MLC1 is the drive-supply switch.** "MLC1, when it turns on, turns on the VFD by supplying the
   incoming voltage." Its two NO contacts (13-14, 43-44) switch the 230 V 1φ into the GS10; coil
   A1/A2 (24 V) from O-02. → E-003 power path + E-006 coil (already applied V6).
3. **Motor is 230 V.** Asked directly whether the reported "480 V out" held (a 230 V 1φ GS10 outputs
   230 V 3φ — it cannot boost), the technician replied **"it's 230."** → OI-27 CLOSED: the GS10 is a
   standard 230 V 1φ-in / 230 V 3φ-out drive; the earlier 480 V was a verbal slip. E-003 letters
   230 V 3φ output as **technician-confirmed** (not merely an engineering deduction).

## Effect on the record
- OI-27 → RESOLVED, cite THIS doc (not V6, which only holds the pre-confirmation 480 V/pending note).
- E-003 supply caveat: supply voltage/phase count is now **CONFIRMED 230 V 1φ** — only the GS10 exact
  model/frame, breaker rating, and wire gauge remain undocumented (do not keep listing supply
  voltage/phase as "NOT DOCUMENTED").
- Still open (unaffected): everything in E-009 except OI-21 and OI-27.
