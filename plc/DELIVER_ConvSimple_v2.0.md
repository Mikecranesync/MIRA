# ⚠️ SUPERSEDED — see `INSTALL_ConvSimple_v2.0.md`

This card said the V2.0 fix was just "Build → Download into Conv_Simple_1.9
(vars + map already deployed)." **That is no longer correct and is unsafe.**

On 2026-06-13 the `Conv_Simple_1.9` image was found **corrupted** (symbol-table
desync) — downloading it **inverted the e-stop**. Do **not** deploy 1.9.

Use instead:
- **`INSTALL_ConvSimple_v2.0.md`** — the clean rebuild as `Conv_Simple_2.0` from the
  proven-good 1.8 baseline (Path A), or the gated in-place repair (Path B), with the
  **mandatory e-stop re-validation under LOTO** before running.
- **`EVIDENCE_ConvSimple_1.9_corruption.md`** — the file-level proof + the 1.9→2.0
  version-naming fix.

The V2.0 *program* itself (`Prog_init_ConvSimple_v2.0.st`) is correct and unchanged
in intent — only the delivery vehicle changed (clean 2.0 project, not the corrupted
1.9 image).
