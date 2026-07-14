# Run C — independent review (fixed extractor vs the manual)

An independent Sonnet agent (separate context) verified the LL1/LL2 fix against the source manual
(144-25085, sha256 re-confirmed). Adversarial — instructed to falsify the fix and find regressions.

## Verdict: PASS

- **LL1 / LL2 fixed**, verified against manual **p137**:
  - `LL1` → **"Lower Limit 1—SLOW DOWN Indicator"** (manual: "LL1 Lower Limit 1—SLOW DOWN Indicator.
    Lower Limit 1—SLOW DOWN is input (switch status is changed).")
  - `LL2` → **"Lower Limit 2—STOP Indicator"**
- **77 fault entries**, **no regressions** (spot-checked oC, oV, Uv1, oH, oL1, oL2, GF, CE, CPF02,
  oPE03 — all names still match the manual).
- **`code is None` for every entry** (no invented integers); source casing preserved.
- **Negatives correct:** `SE1` absent everywhere; `BE2` not a fault code (manual has BE0/BE4/BE5).
- **Whole-table garble scan:** none — no trailing `')'`, no duplicated word runs. The only long
  `name` is `EF`, which the reviewer classified as **correct taxonomy** (EF's description has no
  sentence-ending period before the numbered actions, so the full description is the `name`;
  `secondary_label`="External Fault" is the short label) — **not a bug**.

No confirmed defects → no fix/rerun required.
