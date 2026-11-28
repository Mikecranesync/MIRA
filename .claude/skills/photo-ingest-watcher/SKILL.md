---
name: photo-ingest-watcher
description: Monitor Google Drive for new equipment photos and trigger MIRA ingest pipeline
---

## Overview

Watch for new equipment photos and trigger the MIRA equipment photo ingest
pipeline. Supports two modes: Google Drive monitoring (remote) and local
Takeout ZIP processing.

## Full Pipeline (Takeout ZIPs -> MIRA KB)

For bulk ingest from Google Takeout exports:

```bash
doppler run --project factorylm --config prd -- \
  bash tools/mira_photo_pipeline.sh --workdir /path/to/takeout --local-ingest
```

Dry run first to see what would be processed:

```bash
doppler run --project factorylm --config prd -- \
  bash tools/mira_photo_pipeline.sh --workdir /path/to/takeout --dry-run
```

## Drive Folder Monitoring

### 1. List new files in the MIRA Drive folder

```bash
doppler run --project factorylm --config prd -- \
  gws drive files list \
    --params "{\"q\": \"'${MIRA_DRIVE_FOLDER_ID}' in parents and mimeType contains 'image/'\", \"pageSize\": 50, \"orderBy\": \"createdTime desc\"}" \
    --format table
```

### 2. Download new files to incoming/

For each file not already in `mira-core/data/equipment_photos/processed/`:

```bash
gws drive files get \
  --params "{\"fileId\": \"FILE_ID\", \"alt\": \"media\"}" \
  > mira-core/data/equipment_photos/incoming/FILENAME
```

### 3. Run MIRA ingest (dry run first)

```bash
doppler run --project factorylm --config prd -- \
  python3 mira-core/scripts/ingest_equipment_photos.py --dry-run
```

Review output. If results look correct, run without `--dry-run`:

```bash
doppler run --project factorylm --config prd -- \
  python3 mira-core/scripts/ingest_equipment_photos.py
```

### 4. Verify NeonDB insertion

```bash
doppler run --project factorylm --config prd -- \
  python3 -c "
import sys; sys.path.insert(0, 'mira-core/mira-ingest')
from db.neon import health_check
hc = health_check()
print(f'Knowledge entries: {hc[\"knowledge_entries\"]}')"
```

## Rate Limits

- Max 10 GWS API calls per minute (Drive list + download)
- 1s sleep between Claude Vision classification calls (built into ingest script)
- Daily Drive API quota: ~12,000 queries/user/day

## Error Handling

- **GWS auth expired (exit 2):** Re-authenticate with `gws auth login -s drive`
- **Drive folder not found:** Verify `MIRA_DRIVE_FOLDER_ID` in Doppler
- **Claude Vision rate limit:** The ingest script has built-in 1s sleep between calls
- **NeonDB connection error:** Verify `NEON_DATABASE_URL` in Doppler, check network

## Post-Run Summary

After ingest completes, report to the user:
1. Number of photos processed
2. Confirmed nameplates (high/medium/low confidence counts)
3. Equipment types found (motor, vfd, pump, etc.)
4. Any errors or warnings
5. Current NeonDB knowledge_entries total count
