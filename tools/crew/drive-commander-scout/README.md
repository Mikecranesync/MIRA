# Drive Commander self-eval scout

The Drive Commander analogue of the PrintSense / PLC-laptop autonomous testing
loop. Each run:

1. **Fetches a real, previously-unseen OEM VFD manual off the internet** — a drive
   family that is NOT in `tools/drive-pack-extract/gold/` (so every run is a
   genuine generalization test, not a curated one). Targets rotate day to day.
2. **Runs it through the production pipeline** — `extractor.extract()` (whole-doc,
   position-aware fault/parameter parsing) → a schema-valid staged candidate
   `pack.json` → the scientific grading harness (`grading/grade_scientific.py`),
   gold-independent (schema + cite-integrity + domain-invariant layers).
3. **Emails a complete evaluation** via RESEND (grade, per-layer scores, extracted
   counts, provenance: source URL + sha256 + timing, and an honest interpretation
   — an *empty* pack is reported as a recall/generalization gap, never sold as a
   good grade).

It is **read-only and staged**: it downloads a PDF, never opens a fieldbus, never
writes the live served `packs/` tree, and promotes nothing. See
`tools/drive-pack-extract/self_eval_scout.py` for the full doctrine and
`.claude/rules/fieldbus-readonly.md` / ADR-0025.

## Run it

```bash
# dry-run — write the evaluation artifact, do NOT email:
python3.12 tools/drive-pack-extract/self_eval_scout.py --dry-run

# send the real evaluation email (RESEND_API_KEY from Doppler prd):
doppler run --project factorylm --config prd -- \
  python3.12 tools/drive-pack-extract/self_eval_scout.py --send

# pin a specific target instead of rotating:
python3.12 tools/drive-pack-extract/self_eval_scout.py --dry-run --target durapulse_gs4
```

Artifacts land in `dogfood-output/drive-commander-scout/` (`latest-eval.md`,
timestamped `eval-*.md`, `history.log`).

## Schedule it (Bravo launchd, daily)

```bash
cp tools/crew/drive-commander-scout/com.factorylm.drive-commander-scout.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.factorylm.drive-commander-scout.plist 2>/dev/null
launchctl load   ~/Library/LaunchAgents/com.factorylm.drive-commander-scout.plist
launchctl start  com.factorylm.drive-commander-scout   # run once now
```

**Prereq:** launchd's non-login env can't read the keychain Doppler token, so
store a prd-scoped read-only service token (0600):

```bash
mkdir -p ~/.doppler
doppler configs tokens create scout-prd --project factorylm --config prd --plain \
  > ~/.doppler/drive-commander-scout-prd.token
chmod 600 ~/.doppler/drive-commander-scout-prd.token
```

Same host + rationale as `tools/crew/dogfood/` (the dogfood judge) and the RBAC
weekly job — Bravo is the autonomous-eval fleet host.

## Add a target

Append to `SCOUT_TARGETS` in `self_eval_scout.py`: `pack_id`, `manufacturer`,
`series`, `aliases`, `match_keywords`, a **direct** manual-PDF `url` (stable CDN,
no session/redirect), and a `doc_label`. Do **not** add a family that already has
a `gold/<pack_id>/` set — that would stop being an unseen test (the scout refuses
it, fail-loud).

## Known finding (2026-07-13)

First run against **DURApulse GS20** recovered **0 fault codes / 0 parameters** —
the position-aware parser is tuned to the PowerFlex 520-series table shapes and
does not yet recognise GS20's layout. That is the loop working as intended: it
found a real generalization gap. Closing it = capture GS20's fault/parameter page
ranges + header shape and extend the parser (or add a gold set), same play as GS10.
