"""Second-pass vendor KB ingest — DuckDuckGo search + targeted product URLs.

For vendors where pass-1 (direct manufacturer doc pages) returned empty or
single nav pages. Uses DDG HTML search → follows result links (depth 1 via
cheerio) to find actual technical content.

Also tries known direct product-page URLs as primary before DDG fallback.
"""

from __future__ import annotations

import logging
import os
import time
import uuid

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("vendor-pass2")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://192.168.1.11:11434")
EMBED_MODEL = "nomic-embed-text:latest"
APIFY_API_KEY = os.getenv("APIFY_API_KEY", "")
NEON_DATABASE_URL = os.getenv("NEON_DATABASE_URL", "")
SHARED_TENANT_ID = os.getenv("MIRA_TENANT_ID", "78917b56-f85f-43bb-9a08-1bb98a6cd6c3")

APIFY_BASE = "https://api.apify.com/v2"
APIFY_ACTOR = "apify~website-content-crawler"

MIN_PAGE_CHARS = 800
MIN_CHUNK_CHARS = 400
MAX_CHUNK_CHARS = 5000
POLL_INTERVAL = 30
MAX_WAIT = 300  # 5 min per job — these are simple searches


# ---------------------------------------------------------------------------
# Targets: primary URL + DDG query fallback
# ---------------------------------------------------------------------------

TARGETS = [
    {
        "name": "Pilz",
        "manufacturer": "Pilz",
        "models": ["PNOZ X3", "PNOZ X4", "PSEN 1.1"],
        "primary_url": "https://www.pilz.com/en-US/products/protective-devices/pnoz",
        "ddg_query": "Pilz PNOZ X safety relay fault diagnostic manual",
        "crawl_type": "cheerio",
        "max_pages": 20,
        "depth": 1,
    },
    {
        "name": "Danfoss",
        "manufacturer": "Danfoss",
        "models": ["VLT FC302", "VLT FC301", "FC51"],
        "primary_url": "https://www.danfoss.com/en/products/dds/drives/vlt-drives/",
        "ddg_query": "Danfoss VLT FC302 drive alarm fault code troubleshooting",
        "crawl_type": "cheerio",
        "max_pages": 20,
        "depth": 1,
    },
    {
        "name": "Omron",
        "manufacturer": "Omron",
        "models": ["MX2", "CJ1M", "CP1E"],
        "primary_url": "https://www.ia.omron.com/products/category/control-components/inverters/",
        "ddg_query": "Omron MX2 inverter VFD fault code troubleshooting manual",
        "crawl_type": "playwright:chrome",
        "max_pages": 20,
        "depth": 1,
    },
    {
        "name": "Yaskawa",
        "manufacturer": "Yaskawa Electric",
        "models": ["V1000", "J1000", "A1000"],
        "primary_url": "https://www.yaskawa.com/products/drives/ac-micro-drives/v1000",
        "ddg_query": "Yaskawa V1000 VFD fault code OC OV OL parameter troubleshooting",
        "crawl_type": "playwright:chrome",
        "max_pages": 20,
        "depth": 1,
    },
    {
        "name": "ABB",
        "manufacturer": "ABB",
        "models": ["ACS310", "ACS355", "ACS580"],
        "primary_url": "https://new.abb.com/drives/low-voltage-ac-drives/acs310",
        "ddg_query": "ABB ACS310 ACS355 drive fault code alarm troubleshooting",
        "crawl_type": "playwright:chrome",
        "max_pages": 20,
        "depth": 1,
    },
]


# ---------------------------------------------------------------------------
# NeonDB
# ---------------------------------------------------------------------------

def _engine():
    return create_engine(
        NEON_DATABASE_URL,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def count_chunks(manufacturer: str) -> int:
    with _engine().connect() as conn:
        r = conn.execute(
            text("SELECT COUNT(*) FROM knowledge_entries WHERE tenant_id=:tid AND manufacturer ILIKE :pat AND LENGTH(content) > 500"),
            {"tid": SHARED_TENANT_ID, "pat": f"%{manufacturer.split()[0]}%"},
        ).fetchone()
    return r[0] if r else 0


def already_exists(content: str) -> bool:
    with _engine().connect() as conn:
        r = conn.execute(
            text("SELECT 1 FROM knowledge_entries WHERE tenant_id=:tid AND LEFT(content,200)=:p LIMIT 1"),
            {"tid": SHARED_TENANT_ID, "p": content[:200]},
        ).fetchone()
    return r is not None


def write_chunk(content: str, embedding: list[float], manufacturer: str, model: str, url: str) -> bool:
    if already_exists(content):
        return False
    with _engine().connect() as conn:
        conn.execute(
            text("""
                INSERT INTO knowledge_entries
                  (id, tenant_id, source_type, manufacturer, model_number, content,
                   embedding, is_private, source_url, chunk_type, created_at)
                VALUES
                  (:id, :tid, 'equipment_manual', :mfr, :model, :content,
                   cast(:emb AS vector), false, :url, 'manual_text', NOW())
            """),
            {
                "id": str(uuid.uuid4()),
                "tid": SHARED_TENANT_ID,
                "mfr": manufacturer,
                "model": model,
                "content": content,
                "emb": str(embedding),
                "url": url,
            },
        )
        conn.commit()
    return True


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def embed(text_in: str) -> list[float] | None:
    try:
        with httpx.Client(timeout=30) as c:
            r = c.post(f"{OLLAMA_URL}/api/embeddings", json={"model": EMBED_MODEL, "prompt": text_in})
            r.raise_for_status()
            return r.json()["embedding"]
    except Exception as e:
        logger.warning("Embed failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Chunker
# ---------------------------------------------------------------------------

def chunk(text: str) -> list[str]:
    if len(text) < MIN_PAGE_CHARS:
        return []
    parts = []
    pos = 0
    while pos < len(text):
        end = min(pos + MAX_CHUNK_CHARS, len(text))
        # Find sentence break
        seg = text[pos:end]
        if end < len(text):
            for punct in (". ", ".\n", "! ", "? "):
                idx = seg.rfind(punct, MIN_CHUNK_CHARS)
                if idx != -1:
                    end = pos + idx + len(punct)
                    break
        piece = text[pos:end].strip()
        if len(piece) >= MIN_CHUNK_CHARS:
            parts.append(piece)
        pos = end
    return parts


# ---------------------------------------------------------------------------
# Apify
# ---------------------------------------------------------------------------

def apify_run(url: str, label: str, crawl_type: str, max_pages: int, depth: int) -> list[dict]:
    payload = {
        "startUrls": [{"url": url}],
        "crawlerType": crawl_type,
        "maxCrawlPages": max_pages,
        "maxCrawlDepth": depth,
        "outputFormats": ["markdown"],
        "removeCookieWarnings": True,
    }
    try:
        with httpx.Client(timeout=30) as c:
            r = c.post(
                f"{APIFY_BASE}/acts/{APIFY_ACTOR}/runs",
                params={"token": APIFY_API_KEY},
                json=payload,
            )
            r.raise_for_status()
            run_id = r.json()["data"]["id"]
            logger.info("[%s] Run started: %s (url=%s)", label, run_id, url[:60])
    except Exception as e:
        logger.error("[%s] Start failed: %s", label, e)
        return []

    deadline = time.time() + MAX_WAIT
    with httpx.Client(timeout=30) as c:
        while time.time() < deadline:
            try:
                st = c.get(f"{APIFY_BASE}/actor-runs/{run_id}", params={"token": APIFY_API_KEY})
                st.raise_for_status()
                status = st.json()["data"]["status"]
                if status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
                    logger.info("[%s] Run %s: %s", label, run_id, status)
                    break
                logger.info("[%s] %s — waiting...", label, status)
            except Exception as e:
                logger.warning("[%s] Poll error: %s", label, e)
            time.sleep(POLL_INTERVAL)
        else:
            logger.warning("[%s] Timed out waiting for run %s", label, run_id)
            return []

    try:
        with httpx.Client(timeout=60) as c:
            items = c.get(
                f"{APIFY_BASE}/actor-runs/{run_id}/dataset/items",
                params={"token": APIFY_API_KEY, "limit": max_pages, "format": "json"},
            )
            items.raise_for_status()
            data = items.json()
            logger.info("[%s] Got %d items", label, len(data))
            return data
    except Exception as e:
        logger.error("[%s] Dataset fetch failed: %s", label, e)
        return []


def ddg_url(query: str) -> str:
    import urllib.parse as up
    return f"https://html.duckduckgo.com/html/?q={up.quote_plus(query)}"


# ---------------------------------------------------------------------------
# Ingest items
# ---------------------------------------------------------------------------

def ingest_items(items: list[dict], manufacturer: str, models: list[str], label: str) -> int:
    written = 0
    for item in items:
        raw = item.get("markdown") or item.get("text") or ""
        url = item.get("url", "")
        model = next((m for m in models if m.lower() in raw.lower() or m.lower() in url.lower()), "")
        for c in chunk(raw):
            emb = embed(c)
            if emb and write_chunk(c, emb, manufacturer, model, url):
                written += 1
    return written


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Verify Ollama
    for candidate in [OLLAMA_URL, "http://localhost:11434"]:
        try:
            with httpx.Client(timeout=15) as c:
                r = c.get(f"{candidate}/api/tags")
                r.raise_for_status()
                models = [m["name"] for m in r.json().get("models", [])]
                if EMBED_MODEL in models:
                    globals()["OLLAMA_URL"] = candidate
                    logger.info("Ollama OK at %s", candidate)
                    break
        except Exception as e:
            logger.warning("Ollama %s: %s", candidate, e)
    else:
        logger.error("No Ollama available — aborting")
        raise SystemExit(1)

    results = {}

    for t in TARGETS:
        name = t["name"]
        mfr = t["manufacturer"]
        pre = count_chunks(mfr)
        logger.info("=== %s === pre=%d chunks", name, pre)

        # Round 1: primary URL
        items = apify_run(t["primary_url"], f"{name}/primary", t["crawl_type"], t["max_pages"], t["depth"])
        written = ingest_items(items, mfr, t["models"], name) if items else 0
        logger.info("[%s] Primary: wrote %d chunks from %d items", name, written, len(items))

        post = count_chunks(mfr)
        if post < 5:
            # Round 2: DDG fallback
            logger.info("[%s] Still only %d chunks — trying DDG fallback", name, post)
            ddg_items = apify_run(ddg_url(t["ddg_query"]), f"{name}/ddg", "cheerio", 15, 1)
            written2 = ingest_items(ddg_items, mfr, t["models"], name) if ddg_items else 0
            logger.info("[%s] DDG: wrote %d chunks from %d items", name, written2, len(ddg_items))
            written += written2
            post = count_chunks(mfr)

        results[name] = {"pre": pre, "post": post, "written": written}
        outcome = "READY" if post >= 5 else "INSUFFICIENT"
        logger.info("[%s] DONE: %d → %d chunks (%s)", name, pre, post, outcome)

    print("\n=== PASS-2 RESULTS ===")
    for name, r in results.items():
        icon = "✓ READY" if r["post"] >= 5 else "✗ NEEDS WORK"
        print(f"  {name}: {r['pre']} → {r['post']} chunks (+{r['written']} written) — {icon}")


if __name__ == "__main__":
    main()
