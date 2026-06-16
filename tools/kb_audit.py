#!/usr/bin/env python3
"""Quick audit of NeonDB knowledge_entries — run inside bot container."""
import os
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

url = os.environ["NEON_DATABASE_URL"]
tid = os.environ["MIRA_TENANT_ID"]
e = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})

with e.connect() as c:
    # 1. Top manufacturers/models by chunk count
    print("=== KB SUMMARY ===\n")
    rows = c.execute(text(
        "SELECT manufacturer, model_number, count(*) as n, "
        "count(CASE WHEN embedding IS NOT NULL THEN 1 END) as emb "
        "FROM knowledge_entries WHERE tenant_id = :tid "
        "GROUP BY manufacturer, model_number ORDER BY n DESC LIMIT 25"
    ), {"tid": tid}).fetchall()
    for r in rows:
        mfr = r[0] or "(none)"
        mdl = r[1] or "(none)"
        print(f"  {mfr:<30} {mdl:<25} {r[2]:>5} chunks  {r[3]:>5} embedded")

    # 2. PowerFlex entries
    print("\n=== POWERFLEX ENTRIES ===\n")
    pf = c.execute(text(
        "SELECT manufacturer, model_number, source_url, count(*) "
        "FROM knowledge_entries WHERE tenant_id = :tid "
        "AND (content ILIKE :p1 OR model_number ILIKE :p2 OR model_number ILIKE :p3) "
        "GROUP BY manufacturer, model_number, source_url ORDER BY count(*) DESC"
    ), {"tid": tid, "p1": "%powerflex%", "p2": "%22B%", "p3": "%22A%"}).fetchall()
    if pf:
        for r in pf:
            print(f"  mfr={r[0]}  model={r[1]}  chunks={r[3]}")
            print(f"    url={r[2][:80]}")
    else:
        print("  NONE!")

    # 3. PowerFlex 40 + temperature
    print("\n=== PF40 + TEMPERATURE ===\n")
    p40 = c.execute(text(
        "SELECT content, manufacturer, model_number, source_url "
        "FROM knowledge_entries WHERE tenant_id = :tid "
        "AND content ILIKE :p1 AND content ILIKE :p2 LIMIT 5"
    ), {"tid": tid, "p1": "%powerflex 40%", "p2": "%temperature%"}).fetchall()
    if p40:
        for i, r in enumerate(p40, 1):
            print(f"[{i}] mfr={r[1]} model={r[2]}")
            print(f"    {r[0][:200]}\n")
    else:
        print("  NONE — PowerFlex 40 temp specs not in KB!")

    # 4. 22B catalog number (PF40)
    print("\n=== 22B CATALOG (PF40) ===\n")
    b22 = c.execute(text(
        "SELECT count(*), source_url FROM knowledge_entries "
        "WHERE tenant_id = :tid AND (content ILIKE :p1 OR source_url ILIKE :p2) "
        "GROUP BY source_url"
    ), {"tid": tid, "p1": "%22B-%", "p2": "%22B%"}).fetchall()
    if b22:
        for r in b22:
            print(f"  {r[0]} chunks — {r[1][:80]}")
    else:
        print("  22B-UM001 NOT INGESTED!")

    # 5. What chunks does vector search actually return for this query?
    print("\n=== VECTOR SEARCH: 'powerflex 40 ambient temperature' ===\n")
    import httpx
    resp = httpx.post(
        "http://host.docker.internal:11434/api/embeddings",
        json={"model": "nomic-embed-text:latest",
              "prompt": "What is the maximum ambient operating temperature for the PowerFlex 40 drive?"},
        timeout=30,
    )
    emb = resp.json()["embedding"]
    hits = c.execute(text(
        "SELECT content, manufacturer, model_number, source_url, "
        "1 - (embedding <=> cast(:emb AS vector)) AS sim "
        "FROM knowledge_entries WHERE tenant_id = :tid AND embedding IS NOT NULL "
        "ORDER BY embedding <=> cast(:emb AS vector) LIMIT 5"
    ), {"emb": str(emb), "tid": tid}).fetchall()
    for i, r in enumerate(hits, 1):
        print(f"[{i}] sim={r[4]:.3f}  mfr={r[1]}  model={r[2]}")
        print(f"    url={r[3][:70]}")
        print(f"    {r[0][:150]}\n")
