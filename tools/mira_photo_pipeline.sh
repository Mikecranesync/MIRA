#!/usr/bin/env bash
# mira_photo_pipeline.sh — End-to-end: Google Takeout ZIPs -> organized photos -> MIRA KB
#
# Chains takeout-photos (clean/dedup/organize Takeout exports) with MIRA's
# equipment photo ingest (Claude Vision nameplate extraction -> NeonDB).
#
# Usage:
#   doppler run --project factorylm --config prd -- \
#     bash tools/mira_photo_pipeline.sh --workdir /path/to/takeout --local-ingest
#
#   doppler run --project factorylm --config prd -- \
#     bash tools/mira_photo_pipeline.sh --workdir /path/to/takeout --upload
#
#   doppler run --project factorylm --config prd -- \
#     bash tools/mira_photo_pipeline.sh --workdir /path/to/takeout --dry-run

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────

WORKDIR=""
DRY_RUN=false
UPLOAD=false
LOCAL_INGEST=false
WORKERS=4
INCLUDE_LOW=""
LAYOUT="yyyy_mm"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Argument parsing ─────────────────────────────────────────────────────────

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --workdir PATH     Directory containing zips/ with Takeout exports (required)
  --dry-run          Run takeout-photos but skip upload/ingest
  --upload           Upload organized photos to Google Drive via gws
  --local-ingest     Feed organized photos directly to MIRA ingest
  --workers N        Parallel workers for takeout-photos (default: 4)
  --include-low      Include low-confidence classifications in MIRA ingest
  --layout FORMAT    Date layout: yyyy_mm (default) or yyyy

At least one of --upload, --local-ingest, or --dry-run is required.
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --workdir)     WORKDIR="$2"; shift 2 ;;
        --dry-run)     DRY_RUN=true; shift ;;
        --upload)      UPLOAD=true; shift ;;
        --local-ingest) LOCAL_INGEST=true; shift ;;
        --workers)     WORKERS="$2"; shift 2 ;;
        --include-low) INCLUDE_LOW="--include-low"; shift ;;
        --layout)      LAYOUT="$2"; shift 2 ;;
        -h|--help)     usage ;;
        *)             echo "Unknown option: $1"; usage ;;
    esac
done

if [[ -z "$WORKDIR" ]]; then
    echo "ERROR: --workdir is required"
    usage
fi

if ! $DRY_RUN && ! $UPLOAD && ! $LOCAL_INGEST; then
    echo "ERROR: At least one of --upload, --local-ingest, or --dry-run is required"
    usage
fi

# ── Logging ──────────────────────────────────────────────────────────────────

LOG_FILE="${WORKDIR}/mira_ingest.log"
mkdir -p "$(dirname "$LOG_FILE")"

log()       { echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO]  $*" | tee -a "$LOG_FILE"; }
log_warn()  { echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN]  $*" | tee -a "$LOG_FILE" >&2; }
log_error() { echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $*" | tee -a "$LOG_FILE" >&2; }

# ── Prerequisites ────────────────────────────────────────────────────────────

check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        log_error "Required command not found: $1"
        log_error "Install with: $2"
        exit 1
    fi
}

check_cmd takeout-photos "brew tap diegomarino/tap && brew install takeout-photos"
check_cmd exiftool       "brew install exiftool"
check_cmd sqlite3        "brew install sqlite3"
check_cmd jq             "brew install jq"

if $UPLOAD; then
    check_cmd gws "brew install googleworkspace-cli"
fi

# ── Validate workdir ────────────────────────────────────────────────────────

ZIPS_DIR="${WORKDIR}/zips"
ORGANIZED_DIR="${WORKDIR}/organized_media"
PIPELINE_DB="${WORKDIR}/pipeline.db"

if [[ ! -d "$ZIPS_DIR" ]]; then
    log_error "Zips directory not found: $ZIPS_DIR"
    log_error "Place Google Takeout ZIP files in: $ZIPS_DIR"
    exit 1
fi

ZIP_COUNT=$(find "$ZIPS_DIR" -maxdepth 1 -name "*.zip" -type f 2>/dev/null | wc -l | tr -d ' ')
if [[ "$ZIP_COUNT" -eq 0 ]]; then
    log_error "No .zip files found in $ZIPS_DIR"
    exit 1
fi

log "Found $ZIP_COUNT ZIP file(s) in $ZIPS_DIR"

# ── Stage 1: Run takeout-photos ─────────────────────────────────────────────

log "Stage 1: Processing Takeout ZIPs with takeout-photos"

# Record pre-run count (0 if DB doesn't exist yet)
BEFORE_COUNT=0
if [[ -f "$PIPELINE_DB" ]]; then
    BEFORE_COUNT=$(sqlite3 "$PIPELINE_DB" "SELECT COUNT(*) FROM organized_files;" 2>/dev/null || echo 0)
fi

takeout-photos \
    --workdir "$WORKDIR" \
    --layout "$LAYOUT" \
    --workers "$WORKERS" \
    process

TAKEOUT_EXIT=$?
if [[ $TAKEOUT_EXIT -ne 0 ]]; then
    log_error "takeout-photos failed with exit code $TAKEOUT_EXIT"
    exit 1
fi

# ── Stage 2: Query pipeline.db for newly organized files ────────────────────

log "Stage 2: Querying pipeline.db for newly processed files"

if [[ ! -f "$PIPELINE_DB" ]]; then
    log_error "pipeline.db not found at $PIPELINE_DB"
    exit 1
fi

AFTER_COUNT=$(sqlite3 "$PIPELINE_DB" "SELECT COUNT(*) FROM organized_files;" 2>/dev/null || echo 0)
NEW_COUNT=$((AFTER_COUNT - BEFORE_COUNT))

log "Previously organized: $BEFORE_COUNT | Now organized: $AFTER_COUNT | New this run: $NEW_COUNT"

if [[ $NEW_COUNT -le 0 ]]; then
    log "No new files to process. Done."
    exit 0
fi

# Extract new file paths from pipeline.db
# Query files that are organized and join with organized_files for final paths
NEW_FILES_TSV=$(sqlite3 -separator $'\t' "$PIPELINE_DB" "
    SELECT f.final_path, f.content_hash, f.datetime_original
    FROM files f
    INNER JOIN organized_files o ON f.content_hash = o.content_hash
    WHERE f.status = 'organized'
    ORDER BY f.datetime_original ASC;
")

if $DRY_RUN; then
    log "DRY RUN -- would process $NEW_COUNT file(s)"
    echo ""
    echo "Files to process:"
    echo "$NEW_FILES_TSV" | while IFS=$'\t' read -r fpath chash dto; do
        echo "  $fpath  hash=$chash  date=$dto"
    done
    echo ""
    log "Dry run complete. No uploads or ingest performed."
    exit 0
fi

# ── Stage 3: Upload to Google Drive (if --upload) ───────────────────────────

UPLOADED=0
UPLOAD_ERRORS=0

if $UPLOAD; then
    log "Stage 3: Uploading to Google Drive"

    if [[ -z "${MIRA_DRIVE_FOLDER_ID:-}" ]]; then
        log_error "MIRA_DRIVE_FOLDER_ID not set. Add to Doppler factorylm/prd."
        exit 1
    fi

    # Build set of already-uploaded filenames from log (idempotency)
    ALREADY_UPLOADED=""
    if [[ -f "$LOG_FILE" ]]; then
        ALREADY_UPLOADED=$(grep "^.* UPLOAD " "$LOG_FILE" 2>/dev/null | awk '{print $4}' || true)
    fi

    echo "$NEW_FILES_TSV" | while IFS=$'\t' read -r fpath chash dto; do
        [[ -z "$fpath" ]] && continue

        BASENAME=$(basename "$fpath")

        # Skip if already uploaded in a previous run
        if echo "$ALREADY_UPLOADED" | grep -qF "$BASENAME" 2>/dev/null; then
            log "Already uploaded (skipping): $BASENAME"
            continue
        fi

        if [[ ! -f "$fpath" ]]; then
            log_warn "File not found (skipping): $fpath"
            UPLOAD_ERRORS=$((UPLOAD_ERRORS + 1))
            continue
        fi

        # Upload via gws
        UPLOAD_RESULT=$(gws drive +upload "$fpath" \
            --parent "$MIRA_DRIVE_FOLDER_ID" \
            --name "$BASENAME" \
            --format json 2>&1) || {
            UPLOAD_EXIT=$?
            if [[ $UPLOAD_EXIT -eq 2 ]]; then
                log_error "GWS auth failed. Re-run: gws auth login"
                exit 2
            fi
            log_warn "Upload failed for $BASENAME (exit $UPLOAD_EXIT)"
            UPLOAD_ERRORS=$((UPLOAD_ERRORS + 1))
            # Rate limit gap even on failure
            sleep 6
            continue
        }

        DRIVE_FILE_ID=$(echo "$UPLOAD_RESULT" | jq -r '.id // "unknown"' 2>/dev/null || echo "unknown")
        echo "$(date -Iseconds) UPLOAD $BASENAME drive_id=$DRIVE_FILE_ID hash=$chash exif_date=$dto" >> "$LOG_FILE"
        UPLOADED=$((UPLOADED + 1))

        # Rate limit: max 10 uploads/minute
        sleep 6
    done

    log "Uploaded $UPLOADED file(s) ($UPLOAD_ERRORS error(s))"
fi

# ── Stage 4: Local MIRA ingest (if --local-ingest) ──────────────────────────

if $LOCAL_INGEST; then
    log "Stage 4: Running MIRA equipment photo ingest"

    if [[ ! -d "$ORGANIZED_DIR" ]]; then
        log_error "Organized directory not found: $ORGANIZED_DIR"
        exit 1
    fi

    # Point MIRA ingest at the organized output directory.
    # --no-move keeps takeout-photos output intact (files stay in YYYY/MM/).
    # --source-prefix takeout makes source_url = "takeout://filename".
    python3 "$REPO_ROOT/mira-core/scripts/ingest_equipment_photos.py" \
        --incoming-dir "$ORGANIZED_DIR" \
        --source-prefix takeout \
        --no-move \
        $INCLUDE_LOW

    INGEST_EXIT=$?
    if [[ $INGEST_EXIT -ne 0 ]]; then
        log_warn "MIRA ingest exited with code $INGEST_EXIT"
    else
        log "MIRA ingest complete"
    fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "========================================================"
echo "  MIRA Photo Pipeline Complete"
echo "========================================================"
echo "  Takeout ZIPs processed:   $ZIP_COUNT"
echo "  New files organized:      $NEW_COUNT"
if $UPLOAD; then
    echo "  Uploaded to Drive:        $UPLOADED ($UPLOAD_ERRORS errors)"
fi
if $LOCAL_INGEST; then
    echo "  MIRA ingest:              ran"
fi
echo "  Log file:                 $LOG_FILE"
echo "========================================================"
