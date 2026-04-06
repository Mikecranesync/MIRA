#!/usr/bin/env python3
"""Purge and re-ingest knowledge base with sentence-aware chunking + Docling.

WARNING: DESTRUCTIVE — deletes all knowledge_entries for the configured tenant.

Usage:
    doppler run --project factorylm --config prd -- \
      python3 mira-core/scripts/remediate_knowledge_base.py
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("remediate")


def _get_engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool
    url = os.environ["NEON_DATABASE_URL"]
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


def _sql_scalar(engine, query: str, params: dict | None = None):
    from sqlalchemy import text
    with engine.connect() as conn:
        return conn.execute(text(query), params or {}).scalar()


def _sql_exec(engine, query: str, params: dict | None = None):
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text(query), params or {})
        conn.commit()


def _sql_fetchall(engine, query: str, params: dict | None = None):
    from sqlalchemy import text
    with engine.connect() as conn:
        return conn.execute(text(query), params or {}).mappings().fetchall()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    # --- Preflight ---
    neon_url = os.environ.get("NEON_DATABASE_URL")
    tenant_id = os.environ.get("MIRA_TENANT_ID")
    ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

    if not neon_url:
        log.error("NEON_DATABASE_URL not set")
        sys.exit(1)
    if not tenant_id:
        log.error("MIRA_TENANT_ID not set")
        sys.exit(1)

    engine = _get_engine()

    # Verify NeonDB
    try:
        _sql_scalar(engine, "SELECT 1")
        log.info("NeonDB connection OK")
    except Exception as e:
        log.error("Cannot connect to NeonDB: %s", e)
        sys.exit(1)

    # Verify Ollama
    try:
        resp = httpx.get(f"{ollama_url}/api/tags", timeout=10)
        models = [m["name"] for m in resp.json().get("models", [])]
        if not any("nomic-embed-text" in m for m in models):
            log.error("nomic-embed-text not found on Ollama. Available: %s", models)
            sys.exit(1)
        log.info("Ollama OK (nomic-embed-text available)")
    except Exception as e:
        log.error("Cannot reach Ollama at %s: %s", ollama_url, e)
        sys.exit(1)

    # Check backup exists
    backup_dir = Path("backups")
    backups = sorted(backup_dir.glob("*/MANIFEST.txt")) if backup_dir.exists() else []
    if not backups:
        log.error("No backup found. Run: python3 mira-core/scripts/backup_knowledge_base.py")
        sys.exit(1)
    log.info("Latest backup: %s", backups[-1].parent)

    # Current counts
    current_ke = _sql_scalar(
        engine, "SELECT COUNT(*) FROM knowledge_entries WHERE tenant_id = :tid",
        {"tid": tenant_id},
    )
    current_fc = _sql_scalar(
        engine, "SELECT COUNT(*) FROM fault_codes WHERE tenant_id = :tid",
        {"tid": tenant_id},
    ) or 0
    log.info("Current knowledge_entries: %s", current_ke)
    log.info("Current fault_codes: %s (will NOT be deleted)", current_fc)

    # Confirmation
    if not args.yes:
        print(f"\nWARNING: This will DELETE all {current_ke} knowledge_entries for tenant {tenant_id}.")
        confirm = input("Type YES to continue or Ctrl+C to abort: ")
        if confirm != "YES":
            log.info("Aborted by user")
            sys.exit(0)
    else:
        log.info("--yes flag set, skipping confirmation for %s entries", current_ke)

    # --- Step 3: Purge knowledge_entries ---
    log.info("PURGING knowledge_entries for tenant %s...", tenant_id)
    _sql_exec(
        engine,
        "DELETE FROM knowledge_entries WHERE tenant_id = :tid",
        {"tid": tenant_id},
    )
    log.info("Purge complete")

    # VACUUM requires autocommit
    try:
        from sqlalchemy import text
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text("VACUUM ANALYZE knowledge_entries"))
        log.info("VACUUM ANALYZE complete")
    except Exception as e:
        log.warning("VACUUM failed (non-fatal on NeonDB): %s", e)

    # --- Step 4: Reset source_fingerprints ---
    log.info("Resetting source_fingerprints...")
    _sql_exec(engine, "UPDATE source_fingerprints SET atoms_created = 0")
    log.info("source_fingerprints reset")

    # --- Step 5: Re-ingest ---
    log.info("Starting re-ingest (Docling primary, sentence-aware chunking)...")
    script = Path("mira-core/scripts/ingest_manuals.py")
    result = subprocess.run(
        [sys.executable, str(script)],
        env=os.environ.copy(),
    )
    if result.returncode != 0:
        log.error("Ingest failed with exit code %d", result.returncode)
        # Continue to verification anyway

    # --- Step 6: Post-ingest verification ---
    log.info("")
    log.info("=== Post-Ingest Verification ===")

    new_count = _sql_scalar(
        engine, "SELECT COUNT(*) FROM knowledge_entries WHERE tenant_id = :tid",
        {"tid": tenant_id},
    )
    log.info("New knowledge_entries count: %s (was %s)", new_count, current_ke)

    # Chunk quality
    log.info("Chunk quality distribution:")
    quality_rows = _sql_fetchall(
        engine,
        "SELECT metadata->>'chunk_quality' as quality, COUNT(*) as cnt "
        "FROM knowledge_entries WHERE tenant_id = :tid GROUP BY 1 ORDER BY cnt DESC",
        {"tid": tenant_id},
    )
    for row in quality_rows:
        log.info("  %s: %s", row["quality"] or "(null)", row["cnt"])

    fallback_count = _sql_scalar(
        engine,
        "SELECT COUNT(*) FROM knowledge_entries "
        "WHERE tenant_id = :tid AND metadata->>'chunk_quality' = 'fallback_char_split'",
        {"tid": tenant_id},
    ) or 0
    if new_count and new_count > 0:
        pct = fallback_count * 100 // new_count
        if pct > 5:
            log.warning("Fallback rate %d%% exceeds 5%% target", pct)
        else:
            log.info("Fallback rate: %d%% (target < 5%%)", pct)

    # Manufacturer distribution
    log.info("Manufacturer distribution:")
    mfr_rows = _sql_fetchall(
        engine,
        "SELECT manufacturer, COUNT(*) as chunks, COUNT(DISTINCT source_url) as sources "
        "FROM knowledge_entries WHERE tenant_id = :tid "
        "GROUP BY manufacturer ORDER BY chunks DESC LIMIT 15",
        {"tid": tenant_id},
    )
    for row in mfr_rows:
        log.info("  %s: %s chunks (%s sources)", row["manufacturer"], row["chunks"], row["sources"])

    # --- Step 7: Re-extract fault codes ---
    log.info("Re-extracting fault codes...")
    fc_script = Path("mira-core/scripts/extract_fault_codes.py")
    subprocess.run([sys.executable, str(fc_script)], env=os.environ.copy())

    new_fc = _sql_scalar(
        engine, "SELECT COUNT(*) FROM fault_codes WHERE tenant_id = :tid",
        {"tid": tenant_id},
    ) or 0
    log.info("fault_codes: %s rows (was %s)", new_fc, current_fc)

    # --- Done ---
    log.info("")
    log.info("=== REMEDIATION COMPLETE ===")
    log.info("Before: %s chunks → After: %s chunks", current_ke, new_count)
    log.info("")
    log.info("NEXT STEP: Run the HNSW index migration:")
    log.info("  See: docs/HNSW_MIGRATION.md")


if __name__ == "__main__":
    main()
