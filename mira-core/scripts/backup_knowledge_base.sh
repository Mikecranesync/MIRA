#!/usr/bin/env bash
# Backup NeonDB tables required for safe rollback before re-ingest.
# Usage: ./backup_knowledge_base.sh [output_dir]
#
# Requires: NEON_DATABASE_URL env var (via Doppler or direct)
# Tables backed up: knowledge_entries, fault_codes, source_fingerprints, manual_cache, manuals

set -euo pipefail

BACKUP_ROOT="${1:-backups}"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

if [ -z "${NEON_DATABASE_URL:-}" ]; then
    echo "ERROR: NEON_DATABASE_URL not set. Run via: doppler run -- ./backup_knowledge_base.sh"
    exit 1
fi

# Preflight — verify connection before creating any files
echo "Verifying NeonDB connection..."
if ! psql "$NEON_DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo "ERROR: Cannot connect to NeonDB. Check NEON_DATABASE_URL."
    exit 1
fi
echo "Connection OK."

mkdir -p "$BACKUP_DIR"

TABLES=(knowledge_entries fault_codes source_fingerprints manual_cache manuals)
MANIFEST="${BACKUP_DIR}/MANIFEST.txt"

echo "MIRA NeonDB Backup" > "$MANIFEST"
echo "Timestamp: ${TIMESTAMP}" >> "$MANIFEST"
echo "---" >> "$MANIFEST"

for table in "${TABLES[@]}"; do
    echo "Backing up ${table}..."
    count=$(psql "$NEON_DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM ${table}" 2>/dev/null || echo "0")
    echo "${table}: ${count} rows" >> "$MANIFEST"

    pg_dump "$NEON_DATABASE_URL" \
        --table="${table}" \
        --no-owner \
        --no-privileges \
        --data-only \
        --format=plain \
        2>/dev/null | gzip > "${BACKUP_DIR}/${table}.sql.gz"

    size=$(du -h "${BACKUP_DIR}/${table}.sql.gz" | cut -f1)
    echo "  → ${count} rows, ${size} compressed"
done

echo "---" >> "$MANIFEST"
echo "Restore command:" >> "$MANIFEST"
echo "  gunzip -c ${BACKUP_DIR}/<table>.sql.gz | psql \$NEON_DATABASE_URL" >> "$MANIFEST"

echo ""
echo "Backup complete: ${BACKUP_DIR}/"
echo "Manifest: ${MANIFEST}"
cat "$MANIFEST"
