#!/usr/bin/env bash
# ============================================================================
# WARNING: DESTRUCTIVE OPERATION
# This script DELETES all knowledge_entries for the configured tenant
# and re-ingests from scratch with sentence-aware chunking + Docling.
#
# Prerequisites:
#   1. Run backup_knowledge_base.sh FIRST
#   2. Verify backup in backups/ directory
#   3. Ensure Ollama is running with nomic-embed-text loaded
#
# Usage:
#   doppler run --project factorylm --config prd -- ./remediate_knowledge_base.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="${REPO_ROOT}/logs"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
LOG_FILE="${LOG_DIR}/reingest_${TIMESTAMP}.log"

mkdir -p "$LOG_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"; }

# ---- Step 1: Preflight checks ----

log "=== MIRA Knowledge Base Remediation ==="
log "Timestamp: ${TIMESTAMP}"

if [ -z "${NEON_DATABASE_URL:-}" ]; then
    log "ERROR: NEON_DATABASE_URL not set"
    exit 1
fi

if [ -z "${MIRA_TENANT_ID:-}" ]; then
    log "ERROR: MIRA_TENANT_ID not set"
    exit 1
fi

TENANT_ID="$MIRA_TENANT_ID"
log "Tenant: ${TENANT_ID}"

# Check backup exists
BACKUP_DIR=$(ls -td "${REPO_ROOT}/backups/"*/ 2>/dev/null | head -1)
if [ -z "$BACKUP_DIR" ]; then
    log "ERROR: No backup found in backups/. Run backup_knowledge_base.sh first."
    exit 1
fi
log "Latest backup: ${BACKUP_DIR}"

# Verify NeonDB connection
if ! psql "$NEON_DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    log "ERROR: Cannot connect to NeonDB"
    exit 1
fi
log "NeonDB connection OK"

# Check Ollama
OLLAMA_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
if ! curl -s "${OLLAMA_URL}/api/tags" | grep -q "nomic-embed-text"; then
    log "ERROR: nomic-embed-text not found on Ollama at ${OLLAMA_URL}"
    exit 1
fi
log "Ollama OK (nomic-embed-text available)"

# Confirmation prompt
CURRENT_COUNT=$(psql "$NEON_DATABASE_URL" -t -A -c \
    "SELECT COUNT(*) FROM knowledge_entries WHERE tenant_id = '${TENANT_ID}'" 2>/dev/null)
log "Current knowledge_entries count: ${CURRENT_COUNT}"

echo ""
echo "WARNING: This will DELETE all ${CURRENT_COUNT} knowledge_entries for tenant ${TENANT_ID}."
echo "Type YES to continue or Ctrl+C to abort."
read -r CONFIRM
if [ "$CONFIRM" != "YES" ]; then
    log "Aborted by user"
    exit 0
fi

# ---- Step 2: Extra fault_codes backup ----

log "Backing up fault_codes (extra safety)..."
FC_COUNT=$(psql "$NEON_DATABASE_URL" -t -A -c \
    "SELECT COUNT(*) FROM fault_codes WHERE tenant_id = '${TENANT_ID}'" 2>/dev/null || echo "0")
log "fault_codes: ${FC_COUNT} rows (NOT being deleted)"

# ---- Step 3: Purge knowledge_entries ----

log "PURGING knowledge_entries for tenant ${TENANT_ID}..."
DELETED=$(psql "$NEON_DATABASE_URL" -t -A -c \
    "DELETE FROM knowledge_entries WHERE tenant_id = '${TENANT_ID}' RETURNING 1" 2>/dev/null | wc -l)
log "Deleted ${DELETED} rows"

log "Running VACUUM ANALYZE..."
psql "$NEON_DATABASE_URL" -c "VACUUM ANALYZE knowledge_entries" 2>/dev/null
log "VACUUM complete"

# ---- Step 4: Reset source_fingerprints ----

log "Resetting source_fingerprints (atoms_created = 0)..."
SF_RESET=$(psql "$NEON_DATABASE_URL" -t -A -c \
    "UPDATE source_fingerprints SET atoms_created = 0 RETURNING 1" 2>/dev/null | wc -l)
log "Reset ${SF_RESET} source_fingerprints rows"

# ---- Step 5: Seed manual_cache with known direct PDF URLs ----

log "Seeding manual_cache with known direct PDF URLs (bypasses Apify for crawler-blocked vendors)..."
cd "$REPO_ROOT"
python3 mira-core/scripts/seed_manual_cache.py 2>&1 | tee -a "$LOG_FILE"

# ---- Step 6: Re-ingest ----

log "Starting re-ingest with Docling + sentence-aware chunking..."
log "Log file: ${LOG_FILE}"

cd "$REPO_ROOT"
python3 mira-core/scripts/ingest_manuals.py 2>&1 | tee -a "$LOG_FILE"

# ---- Step 7: Post-ingest verification ----

log ""
log "=== Post-Ingest Verification ==="

NEW_COUNT=$(psql "$NEON_DATABASE_URL" -t -A -c \
    "SELECT COUNT(*) FROM knowledge_entries WHERE tenant_id = '${TENANT_ID}'" 2>/dev/null)
log "New knowledge_entries count: ${NEW_COUNT}"

log "Chunk quality distribution:"
psql "$NEON_DATABASE_URL" -c \
    "SELECT metadata->>'chunk_quality' as quality, COUNT(*) as count
     FROM knowledge_entries
     WHERE tenant_id = '${TENANT_ID}'
     GROUP BY 1 ORDER BY count DESC" 2>/dev/null | tee -a "$LOG_FILE"

FALLBACK_COUNT=$(psql "$NEON_DATABASE_URL" -t -A -c \
    "SELECT COUNT(*) FROM knowledge_entries
     WHERE tenant_id = '${TENANT_ID}'
       AND metadata->>'chunk_quality' = 'fallback_char_split'" 2>/dev/null || echo "0")
FALLBACK_PCT=$((FALLBACK_COUNT * 100 / (NEW_COUNT > 0 ? NEW_COUNT : 1)))
if [ "$FALLBACK_PCT" -gt 5 ]; then
    log "WARNING: Fallback rate ${FALLBACK_PCT}% exceeds 5% target"
else
    log "Fallback rate: ${FALLBACK_PCT}% (target < 5%)"
fi

log "Manufacturer distribution:"
psql "$NEON_DATABASE_URL" -c \
    "SELECT manufacturer, COUNT(*) as chunks, COUNT(DISTINCT source_url) as sources
     FROM knowledge_entries
     WHERE tenant_id = '${TENANT_ID}'
     GROUP BY manufacturer ORDER BY chunks DESC LIMIT 15" 2>/dev/null | tee -a "$LOG_FILE"

# ---- Step 7: Re-extract fault codes ----

log "Re-extracting fault codes from clean chunks..."
python3 mira-core/scripts/extract_fault_codes.py 2>&1 | tee -a "$LOG_FILE"

NEW_FC=$(psql "$NEON_DATABASE_URL" -t -A -c \
    "SELECT COUNT(*) FROM fault_codes WHERE tenant_id = '${TENANT_ID}'" 2>/dev/null || echo "0")
log "fault_codes: ${NEW_FC} rows (was ${FC_COUNT})"

# ---- Step 8: Reminder ----

log ""
log "=== REMEDIATION COMPLETE ==="
log "Before: ${CURRENT_COUNT} chunks → After: ${NEW_COUNT} chunks"
log ""
log "NEXT STEP: Run the HNSW index migration:"
log "  psql \$NEON_DATABASE_URL -f mira-core/scripts/migrate_to_hnsw.sql"
log "  See: docs/HNSW_MIGRATION.md"
