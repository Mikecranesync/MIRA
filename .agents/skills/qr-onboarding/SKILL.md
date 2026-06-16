# qr-onboarding

Generate QR label sheets, register assets in NeonDB, and produce customer onboarding packs for MIRA.

## Modes

### Mode 1 — Demo sheet (sales tool, zero-account)
Generates a 5-VFD Avery 5163 sheet pre-loaded with demo tags. No NeonDB needed.

```bash
cd /Users/charlienode/MIRA
python3 tools/qr-label-pdf.py \
  --demo \
  --tenant "FactoryLM Demo" \
  --format 5163 \
  --output tools/demo-sheet-5163.pdf
```

Output: `tools/demo-sheet-5163.pdf` — 10 labels (2 cols × 5 rows), each encoding `https://app.factorylm.com/m/<TAG>`.

### Mode 2 — Customer onboarding pack (from explicit tag list)
```bash
cd /Users/charlienode/MIRA
python3 tools/qr-label-pdf.py \
  --tags VFD-07,PUMP-03,COMP-01 \
  --tenant "Acme Manufacturing" \
  --format 5163 \
  --output tools/acme-labels.pdf
```

For address-size labels (30/sheet, Avery 5160):
```bash
python3 tools/qr-label-pdf.py \
  --tags VFD-07,PUMP-03 \
  --tenant "Acme" \
  --format 5160 \
  --output tools/acme-small.pdf
```

### Mode 3 — Pull all customer assets from NeonDB
```bash
cd /Users/charlienode/MIRA
doppler run --project factorylm --config prd -- python3 tools/qr-label-pdf.py \
  --from-db \
  --tenant-id 00000000-0000-0000-0000-000000000003 \
  --tenant "Acme Manufacturing" \
  --format 5163 \
  --output tools/acme-full-pack.pdf
```

### Mode 4 — Bulk-register new assets into NeonDB
From CLI:
```bash
doppler run --project factorylm --config prd -- python3 tools/qr-register-assets.py \
  --tenant-id 00000000-0000-0000-0000-000000000003 \
  --tags VFD-07,PUMP-03,COMP-01
```

From CSV (`asset_tag,asset_name` columns):
```bash
doppler run --project factorylm --config prd -- python3 tools/qr-register-assets.py \
  --tenant-id 00000000-0000-0000-0000-000000000003 \
  --csv tools/assets-import.csv
```

The tool is idempotent — safe to re-run; existing tags are skipped silently.

## QR scan URL format
All labels encode: `https://app.factorylm.com/m/<ASSET_TAG>`

Unauthenticated scan → channel chooser (Telegram / Open WebUI / Guest Report)
Authenticated scan → `/c/new` with pending scan cookie (asset context pre-loaded)

## Label layouts

| Format | Size | Per sheet | Best for |
|--------|------|-----------|----------|
| 5163 | 4" × 2" | 10 | Large asset tags, shipping labels, demo sheets |
| 5160 | 2.625" × 1" | 30 | Small assets, equipment tags, bulk rollout |

## Dependencies
```bash
python3 -m pip install reportlab "qrcode[pil]"
```

## Files
- `tools/qr-label-pdf.py` — PDF generator
- `tools/qr-register-assets.py` — NeonDB asset registration
- `tools/sample-labels.pdf` — 3-tag sample (VFD-07, VFD-CHOOSER, PUMP-REPORT)

## Related issues
- #429 — Polish QR test page into reusable branded template
- #430 — Avery label PDF generator (this tool)
- #431 — Wire Avery PDF into /admin/qr-print
- #432 — Unknown-asset auto-register PLG loop
- #433 — qr-onboarding Cowork skill
- #434 — Sales demo mode zero-account sheet
