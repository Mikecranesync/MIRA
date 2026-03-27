#!/usr/bin/env python3
"""Backfill manufacturer + model_number for metadata-orphan chunks in NeonDB.

Maps Rockwell catalog number prefixes in source_url to proper metadata.
Run inside bot container: docker exec mira-bot-telegram python3 /tmp/kb_backfill_metadata.py
"""
import os

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

url = os.environ["NEON_DATABASE_URL"]
tid = os.environ["MIRA_TENANT_ID"]
engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})

# Rockwell catalog prefix → (manufacturer, model_number / product name)
ROCKWELL_CATALOG = {
    "22b": ("Rockwell Automation", "PowerFlex 40"),
    "22a": ("Rockwell Automation", "PowerFlex 70"),
    "22c": ("Rockwell Automation", "PowerFlex 400"),
    "22d": ("Rockwell Automation", "PowerFlex 40P"),
    "22f": ("Rockwell Automation", "PowerFlex 4M"),
    "520": ("Rockwell Automation", "PowerFlex 525"),
    "20b": ("Rockwell Automation", "PowerFlex 700"),
    "440c": ("Rockwell Automation", "GuardMaster"),
    "750": ("Rockwell Automation", "PowerMonitor 5000"),
    "1756": ("Rockwell Automation", "ControlLogix"),
    "1769": ("Rockwell Automation", "CompactLogix"),
    "150": ("Rockwell Automation", "SMC-3"),
}

total = 0
with engine.connect() as conn:
    # Show current orphan count
    orphans = conn.execute(text(
        "SELECT count(*) FROM knowledge_entries "
        "WHERE tenant_id = :tid AND (manufacturer IS NULL OR manufacturer = '')"
    ), {"tid": tid}).scalar()
    print(f"Orphan chunks (empty manufacturer): {orphans}")

    for prefix, (mfr, model) in ROCKWELL_CATALOG.items():
        pattern = f"%{prefix}-%"
        result = conn.execute(text(
            "UPDATE knowledge_entries "
            "SET manufacturer = :mfr, model_number = :model "
            "WHERE tenant_id = :tid "
            "AND (manufacturer IS NULL OR manufacturer = '') "
            "AND (source_url ILIKE :pat OR source_url ILIKE :pat2)"
        ), {
            "tid": tid,
            "mfr": mfr,
            "model": model,
            "pat": pattern,
            "pat2": f"%{prefix}-um%",
        })
        if result.rowcount > 0:
            print(f"  {prefix} → {mfr} / {model}: {result.rowcount} chunks updated")
            total += result.rowcount

    # Also tag the 520-um001 PDF uploads (no dash in prefix)
    result = conn.execute(text(
        "UPDATE knowledge_entries "
        "SET manufacturer = :mfr, model_number = :model "
        "WHERE tenant_id = :tid "
        "AND (manufacturer IS NULL OR manufacturer = '') "
        "AND source_url ILIKE :pat"
    ), {"tid": tid, "mfr": "Rockwell Automation", "model": "PowerFlex 525", "pat": "520-um%"})
    if result.rowcount > 0:
        print(f"  520-um → Rockwell Automation / PowerFlex 525: {result.rowcount} chunks updated")
        total += result.rowcount

    conn.commit()

    # Verify remaining orphans
    remaining = conn.execute(text(
        "SELECT count(*) FROM knowledge_entries "
        "WHERE tenant_id = :tid AND (manufacturer IS NULL OR manufacturer = '')"
    ), {"tid": tid}).scalar()
    print(f"\nTotal updated: {total}")
    print(f"Remaining orphans: {remaining}")
