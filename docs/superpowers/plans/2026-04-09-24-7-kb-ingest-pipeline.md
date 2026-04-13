# 24/7 KB Ingest Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a 24/7 autonomous knowledge base ingest pipeline using Trigger.dev Cloud as orchestration dashboard and Celery workers on Bravo for execution, growing the KB from 25K to 100K+ chunks at $0/month incremental cost.

**Architecture:** Trigger.dev Cloud (free tier) handles scheduling, dashboard, and alerting via HTTP POST to a FastAPI Task Bridge on Bravo (:8003). The bridge enqueues Celery tasks into Redis queues. Celery workers execute the Python pipeline (download, extract, chunk, embed via Ollama, store to NeonDB). Quality gates filter every chunk before INSERT using Ollama embedding similarity.

**Tech Stack:** Python 3.12, Celery 5.4, Redis 7.4.2, FastAPI, Trigger.dev SDK v4 (TypeScript/Bun), Ollama nomic-embed-text, NeonDB pgvector, yt-dlp, feedparser, Playwright, httpx, BeautifulSoup4

**Spec:** `docs/superpowers/specs/2026-04-09-24-7-kb-ingest-pipeline-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `mira-crawler/bridge.py` | FastAPI app translating HTTP POST -> Celery `.delay()` |
| `mira-crawler/Dockerfile.bridge` | Dockerfile for bridge (FastAPI + uvicorn) |
| `mira-crawler/tasks/rss.py` | RSS feed polling with feedparser |
| `mira-crawler/tasks/sitemaps.py` | XML sitemap diff detection |
| `mira-crawler/tasks/youtube.py` | yt-dlp transcript + frame extraction |
| `mira-crawler/tasks/reddit.py` | Reddit public JSON scraping |
| `mira-crawler/tasks/patents.py` | Google Patents scraping |
| `mira-crawler/tasks/gdrive.py` | rclone + local PDF detection |
| `mira-crawler/tasks/freshness.py` | TTL audit + re-crawl triggers |
| `mira-crawler/tasks/playwright_crawler.py` | Headless Chromium for JS-heavy sites |
| `mira-crawler/ingest/quality.py` | 3-stage quality gate (relevance, dedup, content filter) |
| `mira-crawler/ingest/anchors.json` | 10 anchor embedding vectors |
| `mira-crawler/tests/test_bridge.py` | Bridge API tests |
| `mira-crawler/tests/test_rss.py` | RSS task tests |
| `mira-crawler/tests/test_youtube.py` | YouTube task tests |
| `mira-crawler/tests/test_quality.py` | Quality gate tests |
| `mira-crawler/tests/test_sitemaps.py` | Sitemap task tests |
| `mira-crawler/tests/test_reddit.py` | Reddit task tests |
| `mira-crawler/tests/test_freshness.py` | Freshness audit tests |
| `mira-crawler/trigger/package.json` | Trigger.dev project deps |
| `mira-crawler/trigger/trigger.config.ts` | Trigger.dev config |
| `mira-crawler/trigger/src/tasks/continuous.ts` | 15-min cron tasks |
| `mira-crawler/trigger/src/tasks/hourly.ts` | Hourly cron tasks |
| `mira-crawler/trigger/src/tasks/nightly.ts` | Nightly cron tasks |
| `mira-crawler/trigger/src/tasks/weekly.ts` | Weekly cron tasks |
| `mira-crawler/trigger/src/tasks/monthly.ts` | Monthly cron tasks |
| `mira-crawler/trigger/src/lib/bridge.ts` | Shared HTTP client for bridge API |

### Modified Files
| File | Change |
|------|--------|
| `mira-crawler/celeryconfig.py` | Remove beat_schedule, add quality/freshness queues |
| `mira-crawler/celery_app.py` | Register new task modules |
| `mira-crawler/docker-compose.yml` | Remove beat, add bridge service |
| `mira-crawler/Dockerfile.celery` | Add yt-dlp, feedparser, playwright deps |
| `mira-crawler/requirements-celery.txt` | Add new Python deps |
| `mira-crawler/tasks/ingest.py` | Wire quality gate before INSERT |
| `mira-crawler/ingest/store.py` | Add quarantine table writes |
| `docker-compose.yml` (root) | Add mira-task-bridge + mira-redis |

---

## Chunk 1: Foundation — Deploy Celery Stack + Task Bridge API

### Task 1: Update Celery config for new queues

**Files:**
- Modify: `mira-crawler/celeryconfig.py`
- Modify: `mira-crawler/celery_app.py`

- [ ] **Step 1: Remove beat_schedule from celeryconfig.py**

Replace the entire `beat_schedule` dict with a comment explaining Trigger.dev owns scheduling:

```python
# ---------------------------------------------------------------------------
# Beat schedule — REMOVED
# Trigger.dev Cloud owns all scheduling via HTTP → Task Bridge API.
# See mira-crawler/trigger/ for cron definitions.
# ---------------------------------------------------------------------------
```

Keep all other config. Add new queue routes:

```python
task_routes = {
    "mira_crawler.tasks.discover.*": {"queue": "discovery"},
    "mira_crawler.tasks.ingest.*": {"queue": "ingest"},
    "mira_crawler.tasks.foundational.*": {"queue": "ingest"},
    "mira_crawler.tasks.report.*": {"queue": "default"},
    "mira_crawler.tasks.content.*": {"queue": "content"},
    "mira_crawler.tasks.social.*": {"queue": "social"},
    "mira_crawler.tasks.blog.*": {"queue": "blog"},
    "mira_crawler.tasks.rss.*": {"queue": "discovery"},
    "mira_crawler.tasks.sitemaps.*": {"queue": "discovery"},
    "mira_crawler.tasks.youtube.*": {"queue": "ingest"},
    "mira_crawler.tasks.reddit.*": {"queue": "discovery"},
    "mira_crawler.tasks.patents.*": {"queue": "discovery"},
    "mira_crawler.tasks.gdrive.*": {"queue": "ingest"},
    "mira_crawler.tasks.freshness.*": {"queue": "freshness"},
    "mira_crawler.tasks.playwright_crawler.*": {"queue": "discovery"},
}
```

Raise concurrency to 3:

```python
worker_concurrency = 3
```

- [ ] **Step 2: Register new task modules in celery_app.py**

Add imports for all new task modules in both the try/except blocks:

```python
try:
    import mira_crawler.tasks.rss  # noqa: F401
    import mira_crawler.tasks.sitemaps  # noqa: F401
    import mira_crawler.tasks.youtube  # noqa: F401
    import mira_crawler.tasks.reddit  # noqa: F401
    import mira_crawler.tasks.patents  # noqa: F401
    import mira_crawler.tasks.gdrive  # noqa: F401
    import mira_crawler.tasks.freshness  # noqa: F401
    import mira_crawler.tasks.playwright_crawler  # noqa: F401
    # ... existing imports ...
except ImportError:
    import tasks.rss  # noqa: F401
    import tasks.sitemaps  # noqa: F401
    import tasks.youtube  # noqa: F401
    import tasks.reddit  # noqa: F401
    import tasks.patents  # noqa: F401
    import tasks.gdrive  # noqa: F401
    import tasks.freshness  # noqa: F401
    import tasks.playwright_crawler  # noqa: F401
    # ... existing imports ...
```

- [ ] **Step 3: Create stub files for all new tasks**

Each new task file needs at minimum:

```python
"""[Task name] — placeholder for 24/7 ingest pipeline."""
from __future__ import annotations
import logging
try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app
logger = logging.getLogger("mira-crawler.tasks.[name]")
```

Create stubs for: `rss.py`, `sitemaps.py`, `youtube.py`, `reddit.py`, `patents.py`, `gdrive.py`, `freshness.py`, `playwright_crawler.py`

- [ ] **Step 4: Run existing tests to verify no regression**

Run: `cd mira-crawler && python -m pytest tests/ -v`
Expected: All existing tests pass (test_celery_tasks.py, test_chunker.py, etc.)

- [ ] **Step 5: Commit**

```bash
git add mira-crawler/celeryconfig.py mira-crawler/celery_app.py mira-crawler/tasks/*.py
git commit -m "feat: update Celery config for 24/7 pipeline — new queues, remove beat_schedule"
```

---

### Task 2: Build Task Bridge API

**Files:**
- Create: `mira-crawler/bridge.py`
- Create: `mira-crawler/tests/test_bridge.py`

- [ ] **Step 1: Write the failing test**

```python
# mira-crawler/tests/test_bridge.py
"""Tests for Task Bridge API."""
from __future__ import annotations
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create test client with mocked Celery tasks."""
    with patch.dict("os.environ", {"TASK_BRIDGE_API_KEY": "test-key"}):
        from bridge import app
        return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer test-key"}


def test_health_endpoint(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert "status" in resp.json()


def test_unauthorized_without_token(client):
    resp = client.post("/tasks/rss")
    assert resp.status_code == 401


def test_unauthorized_wrong_token(client):
    resp = client.post("/tasks/rss", headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 401


@patch("bridge.import_task")
def test_trigger_rss_task(mock_import, client, auth_headers):
    mock_task = MagicMock()
    mock_task.delay.return_value.id = "task-123"
    mock_import.return_value = mock_task
    resp = client.post("/tasks/rss", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["task_id"] == "task-123"


@patch("bridge.import_task")
def test_trigger_ingest_task(mock_import, client, auth_headers):
    mock_task = MagicMock()
    mock_task.delay.return_value.id = "task-456"
    mock_import.return_value = mock_task
    resp = client.post("/tasks/ingest", headers=auth_headers)
    assert resp.status_code == 200


def test_unknown_task_returns_404(client, auth_headers):
    resp = client.post("/tasks/nonexistent", headers=auth_headers)
    assert resp.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mira-crawler && python -m pytest tests/test_bridge.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'bridge'`

- [ ] **Step 3: Write the bridge implementation**

```python
# mira-crawler/bridge.py
"""Task Bridge API — translates HTTP POST from Trigger.dev into Celery .delay() calls.

Runs as a standalone FastAPI service on :8003.
Auth: Bearer token via TASK_BRIDGE_API_KEY env var.

Start: uvicorn bridge:app --host 0.0.0.0 --port 8003
"""
from __future__ import annotations

import importlib
import logging
import os

from fastapi import FastAPI, HTTPException, Request

logger = logging.getLogger("mira-crawler.bridge")

TASK_BRIDGE_API_KEY = os.getenv("TASK_BRIDGE_API_KEY", "")

app = FastAPI(title="MIRA Task Bridge", version="1.0.0")

# Map of route name -> (module_path, task_function_name)
TASK_REGISTRY: dict[str, tuple[str, str]] = {
    "discover": ("tasks.discover", "discover_all_manufacturers"),
    "ingest": ("tasks.ingest", "ingest_all_pending"),
    "foundational": ("tasks.foundational", "ingest_foundational_kb"),
    "rss": ("tasks.rss", "poll_rss_feeds"),
    "sitemaps": ("tasks.sitemaps", "check_sitemaps"),
    "youtube": ("tasks.youtube", "ingest_youtube_channels"),
    "reddit": ("tasks.reddit", "scrape_forums"),
    "patents": ("tasks.patents", "scrape_patents"),
    "gdrive": ("tasks.gdrive", "sync_google_drive"),
    "freshness": ("tasks.freshness", "audit_stale_content"),
    "photos": ("tasks.foundational", "ingest_foundational_kb"),  # reuse for now
    "report": ("tasks.report", "generate_ingest_report"),
}


def _check_auth(request: Request) -> None:
    """Verify bearer token."""
    if not TASK_BRIDGE_API_KEY:
        raise HTTPException(503, "TASK_BRIDGE_API_KEY not configured")
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {TASK_BRIDGE_API_KEY}":
        raise HTTPException(401, "Unauthorized")


def import_task(module_path: str, task_name: str):
    """Dynamically import a Celery task by module path and name."""
    try:
        mod = importlib.import_module(f"mira_crawler.{module_path}")
    except ImportError:
        mod = importlib.import_module(module_path)
    return getattr(mod, task_name)


@app.get("/health")
async def health():
    """Health check — verify Redis is reachable."""
    try:
        import redis
        r = redis.from_url(os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"))
        r.ping()
        return {"status": "healthy", "redis": "connected"}
    except Exception as e:
        return {"status": "degraded", "redis": str(e)}


@app.post("/tasks/{task_name}")
async def trigger_task(task_name: str, request: Request):
    """Trigger a Celery task by name. Returns the Celery task ID."""
    _check_auth(request)

    if task_name not in TASK_REGISTRY:
        raise HTTPException(404, f"Unknown task: {task_name}")

    module_path, func_name = TASK_REGISTRY[task_name]

    try:
        body = await request.json()
    except Exception:
        body = {}

    task = import_task(module_path, func_name)
    result = task.delay(**body) if body else task.delay()

    logger.info("Triggered %s.%s -> task_id=%s", module_path, func_name, result.id)
    return {"task_id": result.id, "task_name": task_name, "status": "queued"}


@app.get("/tasks/status/{task_id}")
async def task_status(task_id: str, request: Request):
    """Check Celery task status by ID."""
    _check_auth(request)
    from celery.result import AsyncResult
    try:
        from mira_crawler.celery_app import app as celery_app
    except ImportError:
        from celery_app import app as celery_app

    result = AsyncResult(task_id, app=celery_app)
    return {
        "task_id": task_id,
        "status": result.status,
        "result": result.result if result.ready() else None,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mira-crawler && python -m pytest tests/test_bridge.py -v`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mira-crawler/bridge.py mira-crawler/tests/test_bridge.py
git commit -m "feat: add Task Bridge API — HTTP-to-Celery gateway for Trigger.dev"
```

---

### Task 3: Create bridge Dockerfile and update Docker Compose

**Files:**
- Create: `mira-crawler/Dockerfile.bridge`
- Modify: `mira-crawler/docker-compose.yml`

- [ ] **Step 1: Create Dockerfile.bridge**

```dockerfile
# mira-crawler/Dockerfile.bridge
FROM python:3.12.8-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

COPY mira-crawler/requirements-celery.txt /app/requirements-base.txt
RUN pip install --no-cache-dir -r requirements-base.txt
RUN pip install --no-cache-dir fastapi==0.115.6 uvicorn==0.34.0

COPY mira-crawler/ /app/mira_crawler/
COPY mira-core/mira-ingest/db/ /app/db/

ENV PYTHONPATH="/app:/app/mira_crawler"

EXPOSE 8003

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8003/health || exit 1

CMD ["uvicorn", "mira_crawler.bridge:app", "--host", "0.0.0.0", "--port", "8003"]
```

- [ ] **Step 2: Update mira-crawler/docker-compose.yml**

Remove `mira-celery-beat` service. Add `mira-task-bridge` service. Keep Redis and worker.

```yaml
services:
  mira-redis:
    image: redis:7.4.2-alpine
    container_name: mira-redis
    restart: unless-stopped
    ports:
      - "127.0.0.1:6379:6379"
    networks:
      - core-net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    volumes:
      - redis-data:/data

  mira-celery-worker:
    build:
      context: ..
      dockerfile: mira-crawler/Dockerfile.celery
    container_name: mira-celery-worker
    restart: unless-stopped
    depends_on:
      mira-redis:
        condition: service_healthy
    environment:
      - CELERY_BROKER_URL=redis://mira-redis:6379/0
      - CELERY_RESULT_BACKEND=redis://mira-redis:6379/1
    networks:
      - core-net
    healthcheck:
      test: ["CMD", "celery", "-A", "mira_crawler.celery_app", "inspect", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

  mira-task-bridge:
    build:
      context: ..
      dockerfile: mira-crawler/Dockerfile.bridge
    container_name: mira-task-bridge
    restart: unless-stopped
    depends_on:
      mira-redis:
        condition: service_healthy
    ports:
      - "8003:8003"
    environment:
      - CELERY_BROKER_URL=redis://mira-redis:6379/0
      - CELERY_RESULT_BACKEND=redis://mira-redis:6379/1
      - TASK_BRIDGE_API_KEY=${TASK_BRIDGE_API_KEY}
    networks:
      - core-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8003/health"]
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  core-net:
    external: true

volumes:
  redis-data:
```

- [ ] **Step 3: Update requirements-celery.txt with new deps**

Add to `mira-crawler/requirements-celery.txt`:

```
# New 24/7 pipeline deps
feedparser>=6.0.0
yt-dlp>=2024.0.0
playwright>=1.48.0
```

- [ ] **Step 4: Commit**

```bash
git add mira-crawler/Dockerfile.bridge mira-crawler/docker-compose.yml mira-crawler/requirements-celery.txt
git commit -m "feat: add Task Bridge Dockerfile, remove Celery Beat from compose"
```

---

## Chunk 2: Quality Gates + New Source Tasks

### Task 4: Build quality gate pipeline

**Files:**
- Create: `mira-crawler/ingest/quality.py`
- Create: `mira-crawler/ingest/anchors.json`
- Create: `mira-crawler/tests/test_quality.py`
- Modify: `mira-crawler/tasks/ingest.py`

- [ ] **Step 1: Write the failing test**

```python
# mira-crawler/tests/test_quality.py
"""Tests for quality gate pipeline."""
from __future__ import annotations
from unittest.mock import patch
import pytest


def test_short_content_rejected():
    from ingest.quality import quality_gate
    chunk = {"text": "Hi"}
    embedding = [0.1] * 768
    passed, reason = quality_gate(chunk, embedding, "test-tenant")
    assert not passed
    assert "too_short" in reason


def test_low_alpha_rejected():
    from ingest.quality import quality_gate
    chunk = {"text": "#### --- *** === !!! ??? ### $$$ %%% ^^^ &&& ||| ~~~ ```" * 5}
    embedding = [0.1] * 768
    passed, reason = quality_gate(chunk, embedding, "test-tenant")
    assert not passed
    assert "low_alpha" in reason


def test_few_sentences_rejected():
    from ingest.quality import quality_gate
    chunk = {"text": "This is a single sentence with no period ending and no real content whatsoever just a long string"}
    embedding = [0.1] * 768
    passed, reason = quality_gate(chunk, embedding, "test-tenant")
    assert not passed
    assert "too_few_sentences" in reason


def test_good_content_passes():
    from ingest.quality import quality_gate
    chunk = {"text": "To troubleshoot a VFD fault code F004, first check the DC bus voltage. If the voltage is below 200V, the drive may have a power supply issue. Inspect the input fuses and verify incoming three-phase voltage at the drive terminals."}
    # Mock the anchor/dedup checks to pass
    with patch("ingest.quality._relevance_score", return_value=0.6), \
         patch("ingest.quality._semantic_dedup_score", return_value=0.5):
        passed, reason = quality_gate(chunk, [0.1] * 768, "test-tenant")
    assert passed
    assert reason == "pass"


def test_near_duplicate_rejected():
    from ingest.quality import quality_gate
    chunk = {"text": "This is a perfectly good maintenance article about bearing lubrication. Regular greasing prevents premature failure. Follow manufacturer intervals."}
    with patch("ingest.quality._relevance_score", return_value=0.6), \
         patch("ingest.quality._semantic_dedup_score", return_value=0.97):
        passed, reason = quality_gate(chunk, [0.1] * 768, "test-tenant")
    assert not passed
    assert "near_duplicate" in reason


def test_low_relevance_rejected():
    from ingest.quality import quality_gate
    chunk = {"text": "This article discusses the latest fashion trends in Paris. Spring collections feature bold colors. Designers are experimenting with sustainable fabrics."}
    with patch("ingest.quality._relevance_score", return_value=0.15), \
         patch("ingest.quality._semantic_dedup_score", return_value=0.3):
        passed, reason = quality_gate(chunk, [0.1] * 768, "test-tenant")
    assert not passed
    assert "low_relevance" in reason
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mira-crawler && python -m pytest tests/test_quality.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingest.quality'`

- [ ] **Step 3: Create anchor embeddings file**

```json
// mira-crawler/ingest/anchors.json
// Placeholder — actual embeddings generated once by running:
//   python -c "from ingest.quality import generate_anchors; generate_anchors()"
{
  "anchor_texts": [
    "To troubleshoot a PowerFlex 525 F004 fault, first check DC bus voltage at the drive terminals. Low bus voltage indicates input power issues.",
    "Bearing temperature above 180F indicates lubrication failure or misalignment. Immediately shut down the motor and inspect the bearing housing.",
    "When performing lockout/tagout, verify zero energy state with a voltmeter before beginning any maintenance work on the equipment.",
    "A VFD output frequency fluctuating between 55-65 Hz suggests an unstable speed reference or PID loop tuning issue. Check the analog input signal.",
    "Motor nameplate data includes rated voltage, current, horsepower, RPM, service factor, and frame size. Record this data during installation.",
    "Vibration readings above 0.3 in/sec on a centrifugal pump indicate possible impeller imbalance, misalignment, or cavitation damage.",
    "For three-phase motor winding resistance testing, measure between all three pairs (T1-T2, T2-T3, T1-T3). Values should be within 5% of each other.",
    "Replace contactor contacts when pitting exceeds 50% of original thickness. Worn contacts cause voltage drop and overheating at the connection.",
    "PLC fault code 0x0004 on an Allen-Bradley Micro820 indicates a communication timeout on the Modbus RTU port. Check wiring and baud rate settings.",
    "Preventive maintenance intervals for industrial gearboxes: oil analysis every 3 months, oil change every 12 months, alignment check every 6 months."
  ],
  "anchor_embeddings": []
}
```

Note: `anchor_embeddings` is empty — populated on first run by calling Ollama.

- [ ] **Step 4: Write quality gate implementation**

```python
# mira-crawler/ingest/quality.py
"""Quality gate pipeline for KB chunks.

All scoring uses Ollama embeddings — no external API calls ($0 cost).
Quarantines low-quality chunks instead of dropping them.
"""
from __future__ import annotations

import json
import logging
import math
import os
from pathlib import Path

logger = logging.getLogger("mira-crawler.quality")

_ANCHORS: list[list[float]] | None = None
_ANCHORS_FILE = Path(__file__).parent / "anchors.json"

RELEVANCE_THRESHOLD = float(os.getenv("QUALITY_RELEVANCE_THRESHOLD", "0.35"))
DEDUP_THRESHOLD = float(os.getenv("QUALITY_DEDUP_THRESHOLD", "0.95"))
MIN_CONTENT_LENGTH = 80
MIN_ALPHA_RATIO = 0.5
MIN_SENTENCES = 2


def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _load_anchors() -> list[list[float]]:
    """Load anchor embeddings from JSON file. Generate if empty."""
    global _ANCHORS  # noqa: PLW0603
    if _ANCHORS is not None:
        return _ANCHORS

    with open(_ANCHORS_FILE) as f:
        data = json.load(f)

    if data.get("anchor_embeddings"):
        _ANCHORS = data["anchor_embeddings"]
        return _ANCHORS

    # Generate embeddings on first load
    from ingest.embedder import embed_text
    logger.info("Generating anchor embeddings for %d texts...", len(data["anchor_texts"]))
    embeddings = []
    for text in data["anchor_texts"]:
        vec = embed_text(text)
        if vec:
            embeddings.append(vec)
    _ANCHORS = embeddings

    # Persist for next time
    data["anchor_embeddings"] = embeddings
    with open(_ANCHORS_FILE, "w") as f:
        json.dump(data, f)
    logger.info("Saved %d anchor embeddings to %s", len(embeddings), _ANCHORS_FILE)

    return _ANCHORS


def _relevance_score(embedding: list[float]) -> float:
    """Max cosine similarity against anchor embeddings."""
    anchors = _load_anchors()
    if not anchors:
        return 1.0  # fail open if no anchors
    return max(_cosine_sim(embedding, anchor) for anchor in anchors)


def _semantic_dedup_score(embedding: list[float], tenant_id: str) -> float:
    """Highest cosine similarity against recent KB entries via pgvector."""
    try:
        from ingest.store import _engine
        from sqlalchemy import text
        with _engine().connect() as conn:
            row = conn.execute(
                text("""
                    SELECT 1 - (embedding <=> cast(:emb AS vector)) AS similarity
                    FROM knowledge_entries
                    WHERE tenant_id = :tid
                    ORDER BY embedding <=> cast(:emb AS vector)
                    LIMIT 1
                """),
                {"tid": tenant_id, "emb": str(embedding)},
            ).fetchone()
        return row[0] if row else 0.0
    except Exception as e:
        logger.warning("Dedup score check failed: %s", e)
        return 0.0  # fail open


def quality_gate(
    chunk: dict, embedding: list[float], tenant_id: str
) -> tuple[bool, str]:
    """3-stage quality gate. Returns (passed, reason).

    All scoring via Ollama embeddings — no external API calls.
    """
    text = chunk.get("text", "")

    # Gate 1: Content filter (heuristic, fastest)
    if len(text) < MIN_CONTENT_LENGTH:
        return False, "too_short"

    alpha_count = sum(c.isalpha() for c in text)
    alpha_ratio = alpha_count / max(len(text), 1)
    if alpha_ratio < MIN_ALPHA_RATIO:
        return False, f"low_alpha:{alpha_ratio:.2f}"

    sentence_endings = text.count(".") + text.count("!") + text.count("?")
    if sentence_endings < MIN_SENTENCES:
        return False, "too_few_sentences"

    # Gate 2: Relevance scoring (vs anchor embeddings)
    relevance = _relevance_score(embedding)
    if relevance < RELEVANCE_THRESHOLD:
        return False, f"low_relevance:{relevance:.3f}"

    # Gate 3: Semantic dedup (vs existing KB)
    dedup_score = _semantic_dedup_score(embedding, tenant_id)
    if dedup_score > DEDUP_THRESHOLD:
        return False, f"near_duplicate:{dedup_score:.3f}"

    return True, "pass"


def generate_anchors():
    """CLI helper: generate anchor embeddings and save to anchors.json."""
    _load_anchors()
    print(f"Anchors saved to {_ANCHORS_FILE}")
```

- [ ] **Step 5: Run tests**

Run: `cd mira-crawler && python -m pytest tests/test_quality.py -v`
Expected: All 6 tests PASS

- [ ] **Step 6: Wire quality gate into ingest.py**

In `mira-crawler/tasks/ingest.py`, inside the `ingest_url` task, add quality gate check after embedding and before `insert_chunk`. Add this block after `embedding = embed_text(...)` and before `insert_chunk(...)`:

```python
        # Quality gate (before INSERT)
        try:
            from ingest.quality import quality_gate
            passed, reason = quality_gate(chunk, embedding, tenant_id)
            if not passed:
                logger.debug("Quality gate rejected chunk %d: %s", chunk_idx, reason)
                skipped += 1
                continue
        except Exception as e:
            logger.warning("Quality gate error (fail open): %s", e)
```

- [ ] **Step 7: Run all tests**

Run: `cd mira-crawler && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add mira-crawler/ingest/quality.py mira-crawler/ingest/anchors.json mira-crawler/tests/test_quality.py mira-crawler/tasks/ingest.py
git commit -m "feat: add 3-stage quality gate — relevance, dedup, content filter (Ollama-only, $0)"
```

---

### Task 5: RSS feed monitor

**Files:**
- Create: `mira-crawler/tasks/rss.py`
- Create: `mira-crawler/tests/test_rss.py`

- [ ] **Step 1: Write the failing test**

```python
# mira-crawler/tests/test_rss.py
"""Tests for RSS feed monitoring task."""
from __future__ import annotations
from unittest.mock import patch, MagicMock
import pytest


SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Fluke Blog</title>
    <item>
      <title>How to Test a Motor with a Multimeter</title>
      <link>https://fluke.com/blog/motor-testing</link>
      <guid>fluke-motor-testing-001</guid>
      <description>Step-by-step guide to testing electric motors.</description>
    </item>
    <item>
      <title>VFD Troubleshooting Tips</title>
      <link>https://fluke.com/blog/vfd-tips</link>
      <guid>fluke-vfd-tips-002</guid>
      <description>Common VFD faults and how to diagnose them.</description>
    </item>
  </channel>
</rss>"""


def test_parse_rss_feed():
    from tasks.rss import _parse_feed
    entries = _parse_feed(SAMPLE_RSS)
    assert len(entries) == 2
    assert entries[0]["title"] == "How to Test a Motor with a Multimeter"
    assert entries[0]["url"] == "https://fluke.com/blog/motor-testing"
    assert entries[0]["guid"] == "fluke-motor-testing-001"


def test_filter_seen_guids():
    from tasks.rss import _filter_new_entries
    entries = [
        {"guid": "a", "url": "http://a.com", "title": "A"},
        {"guid": "b", "url": "http://b.com", "title": "B"},
        {"guid": "c", "url": "http://c.com", "title": "C"},
    ]
    seen = {"a", "c"}
    new = _filter_new_entries(entries, seen)
    assert len(new) == 1
    assert new[0]["guid"] == "b"


def test_rss_feeds_list_not_empty():
    from tasks.rss import RSS_FEEDS
    assert len(RSS_FEEDS) >= 7
    for feed in RSS_FEEDS:
        assert "name" in feed
        assert "url" in feed
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mira-crawler && python -m pytest tests/test_rss.py -v`
Expected: FAIL — import error

- [ ] **Step 3: Write RSS task implementation**

```python
# mira-crawler/tasks/rss.py
"""RSS feed monitoring — polls manufacturer and industry feeds for new articles.

Uses feedparser (no API key). Tracks seen GUIDs in Redis to skip duplicates.
Schedule: every 15 minutes via Trigger.dev.
"""
from __future__ import annotations

import logging
import os

import feedparser
import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.rss")

RSS_FEEDS = [
    {"name": "Fluke Blog", "url": "https://www.fluke.com/en-us/learn/blog/rss"},
    {"name": "PlantServices", "url": "https://www.plantservices.com/rss/"},
    {"name": "ReliabilityWeb", "url": "https://reliabilityweb.com/feed"},
    {"name": "Maintenance Phoenix", "url": "https://maintenancephoenix.com/feed"},
    {"name": "ABB News", "url": "https://new.abb.com/news/feed"},
    {"name": "Emerson Automation", "url": "https://www.emerson.com/en-us/automation/rss"},
    {"name": "SKF Evolution", "url": "https://evolution.skf.com/feed/"},
    {"name": "Machinery Lubrication", "url": "https://www.machinerylubrication.com/rss/"},
    {"name": "Efficient Plant", "url": "https://www.efficientplantmag.com/feed/"},
    {"name": "Automation World", "url": "https://www.automationworld.com/rss"},
]

REDIS_SEEN_KEY = "mira:rss:seen_guids"


def _get_redis():
    """Get Redis connection for GUID tracking."""
    import redis
    return redis.from_url(os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"))


def _parse_feed(content: str) -> list[dict]:
    """Parse RSS/Atom feed content into entries."""
    feed = feedparser.parse(content)
    entries = []
    for entry in feed.entries:
        entries.append({
            "title": entry.get("title", ""),
            "url": entry.get("link", ""),
            "guid": entry.get("id", entry.get("link", "")),
            "summary": entry.get("summary", ""),
        })
    return entries


def _filter_new_entries(entries: list[dict], seen_guids: set[str]) -> list[dict]:
    """Filter out entries whose GUIDs have already been processed."""
    return [e for e in entries if e["guid"] not in seen_guids]


@app.task(bind=True, max_retries=2, default_retry_delay=60)
def poll_rss_feeds(self):
    """Poll all RSS feeds, queue new articles for ingest."""
    try:
        from mira_crawler.tasks.ingest import ingest_url
    except ImportError:
        from tasks.ingest import ingest_url

    r = _get_redis()
    seen_guids = r.smembers(REDIS_SEEN_KEY)
    seen_guids = {g.decode() if isinstance(g, bytes) else g for g in seen_guids}

    total_new = 0
    total_feeds = 0

    for feed_config in RSS_FEEDS:
        feed_name = feed_config["name"]
        feed_url = feed_config["url"]

        try:
            resp = httpx.get(feed_url, timeout=30, follow_redirects=True,
                             headers={"User-Agent": "MIRA-KB/1.0"})
            resp.raise_for_status()
        except Exception as e:
            logger.warning("Feed %s fetch failed: %s", feed_name, e)
            continue

        entries = _parse_feed(resp.text)
        new_entries = _filter_new_entries(entries, seen_guids)

        for entry in new_entries:
            ingest_url.delay(
                url=entry["url"],
                manufacturer="",
                model="",
                source_type="rss_article",
            )
            r.sadd(REDIS_SEEN_KEY, entry["guid"])
            seen_guids.add(entry["guid"])

        if new_entries:
            logger.info("Feed %s: %d new articles queued", feed_name, len(new_entries))
        total_new += len(new_entries)
        total_feeds += 1

    logger.info("RSS poll complete: %d feeds checked, %d new articles", total_feeds, total_new)
    return {"feeds_checked": total_feeds, "new_articles": total_new}
```

- [ ] **Step 4: Add feedparser to requirements**

Already added in Task 3. Verify it's in `requirements-celery.txt`.

- [ ] **Step 5: Run tests**

Run: `cd mira-crawler && python -m pytest tests/test_rss.py -v`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add mira-crawler/tasks/rss.py mira-crawler/tests/test_rss.py
git commit -m "feat: add RSS feed monitor — 10 feeds, GUID dedup via Redis"
```

---

### Task 6: YouTube transcript ingest with frame extraction

**Files:**
- Create: `mira-crawler/tasks/youtube.py`
- Create: `mira-crawler/tests/test_youtube.py`

- [ ] **Step 1: Write the failing test**

```python
# mira-crawler/tests/test_youtube.py
"""Tests for YouTube transcript ingest + visual frame extraction."""
from __future__ import annotations
import pytest


SAMPLE_VTT = """WEBVTT

00:00:05.000 --> 00:00:10.000
Welcome to this VFD troubleshooting guide.

00:00:10.000 --> 00:00:15.000
Today we'll look at common fault codes.

00:00:15.000 --> 00:00:22.000
Look at this display - you can see fault code F004.

00:00:22.000 --> 00:00:30.000
The meter reads 185 volts on the DC bus.

00:00:30.000 --> 00:00:35.000
That's below the expected 325 volts for a 230V drive.
"""


def test_parse_vtt():
    from tasks.youtube import _parse_vtt
    segments = _parse_vtt(SAMPLE_VTT)
    assert len(segments) == 5
    assert segments[0]["start_seconds"] == 5.0
    assert "VFD troubleshooting" in segments[0]["text"]


def test_detect_visual_cues():
    from tasks.youtube import _detect_visual_cues
    segments = _parse_vtt_helper()
    cues = _detect_visual_cues(segments)
    # "Look at this display" and "The meter reads" should trigger
    assert len(cues) >= 2
    timestamps = [c["start_seconds"] for c in cues]
    assert 15.0 in timestamps
    assert 22.0 in timestamps


def _parse_vtt_helper():
    from tasks.youtube import _parse_vtt
    return _parse_vtt(SAMPLE_VTT)


def test_youtube_channels_list():
    from tasks.youtube import YOUTUBE_CHANNELS
    assert len(YOUTUBE_CHANNELS) >= 5


def test_segments_to_chunks():
    from tasks.youtube import _segments_to_text_blocks
    segments = _parse_vtt_helper()
    blocks = _segments_to_text_blocks(segments, video_url="https://youtube.com/watch?v=test123")
    assert len(blocks) >= 1
    # All segment text should be merged into blocks
    full_text = " ".join(b["text"] for b in blocks)
    assert "VFD troubleshooting" in full_text
    assert "DC bus" in full_text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mira-crawler && python -m pytest tests/test_youtube.py -v`
Expected: FAIL — import error

- [ ] **Step 3: Write YouTube task implementation**

```python
# mira-crawler/tasks/youtube.py
"""YouTube transcript ingest + visual diagnostic frame extraction.

Uses yt-dlp (free, no API key) to download subtitles.
Detects visual diagnostic moments and extracts video frames with ffmpeg.
Schedule: nightly via Trigger.dev.
"""
from __future__ import annotations

import logging
import os
import re
import subprocess
from pathlib import Path

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.youtube")

YOUTUBE_CHANNELS = [
    "https://youtube.com/@FlukeTestTools",
    "https://youtube.com/@ABBgroupnews",
    "https://youtube.com/@RSAutomation",
    "https://youtube.com/@KleinTools",
    "https://youtube.com/@realPars",
    "https://youtube.com/@TheEngineeringMindset",
    "https://youtube.com/@SkillcatApp",
    "https://youtube.com/@electricianU",
]

VISUAL_CUE_KEYWORDS = [
    "look at", "you can see", "notice", "as shown", "right here",
    "this is what", "see how", "pointing to", "the display shows",
    "the meter reads", "fault code", "error on screen", "nameplate",
    "let me show", "zoom in", "close up",
]

FRAMES_DIR = Path(os.getenv("YOUTUBE_FRAMES_DIR", os.path.expanduser("~/ingest_staging/youtube_frames")))
REDIS_SEEN_KEY = "mira:youtube:seen_videos"
MAX_VIDEOS_PER_CHANNEL = int(os.getenv("YT_MAX_VIDEOS_PER_CHANNEL", "5"))

_VTT_TIMESTAMP_RE = re.compile(r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})")


def _parse_timestamp(ts: str) -> float:
    """Parse VTT timestamp to seconds."""
    m = _VTT_TIMESTAMP_RE.match(ts)
    if not m:
        return 0.0
    h, mi, s, ms = int(m[1]), int(m[2]), int(m[3]), int(m[4])
    return h * 3600 + mi * 60 + s + ms / 1000


def _parse_vtt(content: str) -> list[dict]:
    """Parse WebVTT subtitle file into timestamped segments."""
    segments = []
    lines = content.strip().split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        # Look for timestamp line: "00:00:05.000 --> 00:00:10.000"
        if "-->" in line:
            parts = line.split("-->")
            start = _parse_timestamp(parts[0].strip())
            end = _parse_timestamp(parts[1].strip())
            # Collect text lines until empty line or next timestamp
            text_lines = []
            i += 1
            while i < len(lines) and lines[i].strip() and "-->" not in lines[i]:
                text_lines.append(lines[i].strip())
                i += 1
            text = " ".join(text_lines)
            if text:
                segments.append({"start_seconds": start, "end_seconds": end, "text": text})
        else:
            i += 1
    return segments


def _detect_visual_cues(segments: list[dict]) -> list[dict]:
    """Find segments containing visual diagnostic cue keywords."""
    cues = []
    for seg in segments:
        text_lower = seg["text"].lower()
        for keyword in VISUAL_CUE_KEYWORDS:
            if keyword in text_lower:
                cues.append({**seg, "cue_keyword": keyword})
                break
    return cues


def _segments_to_text_blocks(segments: list[dict], video_url: str) -> list[dict]:
    """Merge segments into larger text blocks suitable for chunking."""
    if not segments:
        return []
    # Merge all segments into paragraphs of ~5 segments each
    blocks = []
    batch_size = 5
    for i in range(0, len(segments), batch_size):
        batch = segments[i:i + batch_size]
        text = " ".join(s["text"] for s in batch)
        blocks.append({
            "text": text,
            "page_num": i // batch_size + 1,
            "section": f"transcript_{batch[0]['start_seconds']:.0f}s",
            "source_url": video_url,
        })
    return blocks


def _extract_frame(video_url: str, timestamp: float, output_path: Path) -> bool:
    """Extract a single frame from a video at the given timestamp using yt-dlp + ffmpeg."""
    try:
        ts_str = f"{int(timestamp // 3600):02d}:{int((timestamp % 3600) // 60):02d}:{int(timestamp % 60):02d}"
        result = subprocess.run(
            [
                "yt-dlp", "--no-download",
                "-f", "best[height<=720]",
                "--exec", f"ffmpeg -ss {ts_str} -i {{}} -frames:v 1 -q:v 2 {output_path} -y",
                video_url,
            ],
            capture_output=True, text=True, timeout=120,
        )
        return output_path.exists()
    except Exception as e:
        logger.warning("Frame extraction failed at %.1fs: %s", timestamp, e)
        return False


@app.task(bind=True, max_retries=2, default_retry_delay=120)
def ingest_youtube_channels(self):
    """Ingest transcripts from configured YouTube channels.

    For each new video:
    1. Download subtitle .vtt (no video download)
    2. Parse into timestamped segments
    3. Detect visual diagnostic moments, extract frames
    4. Chunk transcript text and queue for embedding/storage
    """
    import redis as redis_lib
    try:
        from mira_crawler.tasks.ingest import ingest_url
    except ImportError:
        from tasks.ingest import ingest_url

    r = redis_lib.from_url(os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"))
    seen = {v.decode() for v in r.smembers(REDIS_SEEN_KEY)}

    total_videos = 0
    total_frames = 0
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)

    for channel_url in YOUTUBE_CHANNELS:
        try:
            # Get recent video URLs from channel
            result = subprocess.run(
                ["yt-dlp", "--flat-playlist", "--print", "url",
                 f"--playlist-end={MAX_VIDEOS_PER_CHANNEL}", channel_url],
                capture_output=True, text=True, timeout=60,
            )
            video_urls = [u.strip() for u in result.stdout.strip().split("\n") if u.strip()]
        except Exception as e:
            logger.warning("Channel listing failed for %s: %s", channel_url, e)
            continue

        for video_url in video_urls:
            video_id = video_url.split("v=")[-1] if "v=" in video_url else video_url.split("/")[-1]
            if video_id in seen:
                continue

            # Download subtitles only
            try:
                sub_result = subprocess.run(
                    ["yt-dlp", "--write-auto-sub", "--skip-download",
                     "--sub-lang", "en", "--sub-format", "vtt",
                     "-o", f"/tmp/mira_yt_{video_id}", video_url],
                    capture_output=True, text=True, timeout=120,
                )
            except Exception as e:
                logger.warning("Subtitle download failed for %s: %s", video_id, e)
                continue

            # Find the .vtt file
            vtt_path = Path(f"/tmp/mira_yt_{video_id}.en.vtt")
            if not vtt_path.exists():
                logger.debug("No English subtitles for %s", video_id)
                r.sadd(REDIS_SEEN_KEY, video_id)
                continue

            vtt_content = vtt_path.read_text(encoding="utf-8", errors="replace")
            segments = _parse_vtt(vtt_content)

            if not segments:
                r.sadd(REDIS_SEEN_KEY, video_id)
                continue

            # Detect visual cues and extract frames
            cues = _detect_visual_cues(segments)
            for cue in cues:
                frame_path = FRAMES_DIR / f"{video_id}_{cue['start_seconds']:.0f}s.jpg"
                if _extract_frame(video_url, cue["start_seconds"], frame_path):
                    total_frames += 1
                    logger.info(
                        "Extracted frame: %s at %.0fs — cue: '%s'",
                        video_id, cue["start_seconds"], cue["cue_keyword"],
                    )

            # Chunk transcript for KB ingest
            blocks = _segments_to_text_blocks(segments, video_url)
            from ingest.chunker import chunk_blocks
            chunks = chunk_blocks(blocks, source_url=video_url, max_chars=2000, min_chars=80)

            from ingest.embedder import embed_text
            from ingest.store import insert_chunk, chunk_exists

            tenant_id = os.getenv("MIRA_TENANT_ID", "")
            inserted = 0
            for i, chunk in enumerate(chunks):
                if chunk_exists(tenant_id, video_url, i):
                    continue
                embedding = embed_text(chunk["text"])
                if embedding:
                    entry_id = insert_chunk(
                        tenant_id=tenant_id,
                        content=chunk["text"],
                        embedding=embedding,
                        source_url=video_url,
                        source_type="youtube_transcript",
                        chunk_index=i,
                        chunk_type="text",
                    )
                    if entry_id:
                        inserted += 1

            r.sadd(REDIS_SEEN_KEY, video_id)
            total_videos += 1
            logger.info("Ingested %s: %d chunks, %d frames", video_id, inserted, len(cues))

            # Cleanup
            vtt_path.unlink(missing_ok=True)

    logger.info("YouTube ingest complete: %d videos, %d frames extracted", total_videos, total_frames)
    return {"videos_processed": total_videos, "frames_extracted": total_frames}
```

- [ ] **Step 4: Run tests**

Run: `cd mira-crawler && python -m pytest tests/test_youtube.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mira-crawler/tasks/youtube.py mira-crawler/tests/test_youtube.py
git commit -m "feat: add YouTube transcript ingest + visual diagnostic frame extraction"
```

---

### Task 7: Reddit, sitemaps, patents, gdrive, freshness tasks

**Files:**
- Create: `mira-crawler/tasks/reddit.py`
- Create: `mira-crawler/tasks/sitemaps.py`
- Create: `mira-crawler/tasks/patents.py`
- Create: `mira-crawler/tasks/gdrive.py`
- Create: `mira-crawler/tasks/freshness.py`
- Create: `mira-crawler/tasks/playwright_crawler.py`
- Create: `mira-crawler/tests/test_reddit.py`
- Create: `mira-crawler/tests/test_sitemaps.py`
- Create: `mira-crawler/tests/test_freshness.py`

Each task follows the same pattern: pure functions for parsing/filtering (testable), Celery task for orchestration. Tests focus on the pure functions.

- [ ] **Step 1: Write Reddit task + test**

Reddit test should verify JSON parsing and GUID dedup. Reddit task uses `https://www.reddit.com/r/{sub}/top.json?t=week&limit=50` — no PRAW, no OAuth.

- [ ] **Step 2: Write sitemaps task + test**

Sitemap test should verify XML parsing and `<lastmod>` comparison. Task downloads sitemaps via httpx, stores last-seen dates in Redis.

- [ ] **Step 3: Write patents task**

Google Patents task uses httpx + BS4 to scrape patent abstracts/claims. Monthly schedule.

- [ ] **Step 4: Write gdrive task**

Uses `subprocess.run(["rclone", "sync", ...])` + scans output dir for new PDFs. Queues each as `ingest_url.delay()`.

- [ ] **Step 5: Write freshness audit task + test**

Queries NeonDB for entries past TTL. Marks stale. Queues re-crawl for stale URLs.

- [ ] **Step 6: Write Playwright crawler task**

Replaces Apify for JS-heavy sites. Uses `playwright.async_api` to render pages, extract content with BS4.

- [ ] **Step 7: Run all tests**

Run: `cd mira-crawler && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 8: Commit all remaining source tasks**

```bash
git add mira-crawler/tasks/*.py mira-crawler/tests/*.py
git commit -m "feat: add Reddit, sitemaps, patents, gdrive, freshness, Playwright tasks"
```

---

## Chunk 3: Trigger.dev Integration

### Task 8: Initialize Trigger.dev TypeScript project

**Files:**
- Create: `mira-crawler/trigger/package.json`
- Create: `mira-crawler/trigger/trigger.config.ts`
- Create: `mira-crawler/trigger/src/lib/bridge.ts`
- Create: `mira-crawler/trigger/src/tasks/continuous.ts`
- Create: `mira-crawler/trigger/src/tasks/hourly.ts`
- Create: `mira-crawler/trigger/src/tasks/nightly.ts`
- Create: `mira-crawler/trigger/src/tasks/weekly.ts`
- Create: `mira-crawler/trigger/src/tasks/monthly.ts`

- [ ] **Step 1: Initialize bun project**

```bash
cd mira-crawler/trigger
bun init -y
bun add @trigger.dev/sdk@latest
```

- [ ] **Step 2: Create trigger.config.ts**

```typescript
// mira-crawler/trigger/trigger.config.ts
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_mira-ingest",
  runtime: "node",
  logLevel: "log",
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
    },
  },
  dirs: ["src/tasks"],
});
```

- [ ] **Step 3: Create shared bridge client**

```typescript
// mira-crawler/trigger/src/lib/bridge.ts
const BRIDGE_URL = process.env.TASK_BRIDGE_URL ?? "http://100.86.236.11:8003";
const BRIDGE_KEY = process.env.TASK_BRIDGE_API_KEY ?? "";

export async function triggerBridgeTask(taskName: string, payload?: Record<string, unknown>) {
  const resp = await fetch(`${BRIDGE_URL}/tasks/${taskName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BRIDGE_KEY}`,
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  if (!resp.ok) {
    throw new Error(`Bridge ${taskName} failed: ${resp.status} ${await resp.text()}`);
  }

  return resp.json() as Promise<{ task_id: string; task_name: string; status: string }>;
}
```

- [ ] **Step 4: Create cron task files**

```typescript
// mira-crawler/trigger/src/tasks/continuous.ts
import { schedules } from "@trigger.dev/sdk/v3";
import { triggerBridgeTask } from "../lib/bridge";

export const pollRssFeeds = schedules.task({
  id: "poll-rss-feeds",
  cron: { pattern: "*/15 * * * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("rss"),
});

export const scanWatchFolder = schedules.task({
  id: "scan-watch-folder",
  cron: { pattern: "*/15 * * * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("gdrive"),
});
```

```typescript
// mira-crawler/trigger/src/tasks/hourly.ts
import { schedules } from "@trigger.dev/sdk/v3";
import { triggerBridgeTask } from "../lib/bridge";

export const checkSitemaps = schedules.task({
  id: "check-sitemaps",
  cron: { pattern: "0 * * * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("sitemaps"),
});

export const ingestPending = schedules.task({
  id: "ingest-pending",
  cron: { pattern: "30 * * * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("ingest"),
});
```

```typescript
// mira-crawler/trigger/src/tasks/nightly.ts
import { schedules } from "@trigger.dev/sdk/v3";
import { triggerBridgeTask } from "../lib/bridge";

export const nightlyManuals = schedules.task({
  id: "nightly-manuals",
  cron: { pattern: "15 2 * * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("ingest"),
});

export const nightlyYoutube = schedules.task({
  id: "nightly-youtube",
  cron: { pattern: "0 3 * * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("youtube"),
});

export const nightlyGdrive = schedules.task({
  id: "nightly-gdrive",
  cron: { pattern: "30 3 * * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("gdrive"),
});

export const nightlyReport = schedules.task({
  id: "nightly-report",
  cron: { pattern: "0 4 * * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("report"),
});
```

```typescript
// mira-crawler/trigger/src/tasks/weekly.ts
import { schedules } from "@trigger.dev/sdk/v3";
import { triggerBridgeTask } from "../lib/bridge";

export const weeklyDiscovery = schedules.task({
  id: "weekly-discovery",
  cron: { pattern: "0 3 * * 0", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("discover"),
});

export const weeklyReddit = schedules.task({
  id: "weekly-reddit",
  cron: { pattern: "0 4 * * 0", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("reddit"),
});

export const weeklyFreshness = schedules.task({
  id: "weekly-freshness",
  cron: { pattern: "0 5 * * 0", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("freshness"),
});
```

```typescript
// mira-crawler/trigger/src/tasks/monthly.ts
import { schedules } from "@trigger.dev/sdk/v3";
import { triggerBridgeTask } from "../lib/bridge";

export const monthlyFoundational = schedules.task({
  id: "monthly-foundational",
  cron: { pattern: "0 4 1 * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("foundational"),
});

export const monthlyPhotos = schedules.task({
  id: "monthly-photos",
  cron: { pattern: "0 5 1 * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("photos"),
});

export const monthlyPatents = schedules.task({
  id: "monthly-patents",
  cron: { pattern: "0 4 15 * *", timezone: "America/New_York" },
  run: async () => triggerBridgeTask("patents"),
});
```

- [ ] **Step 5: Deploy to Trigger.dev Cloud**

```bash
cd mira-crawler/trigger
bunx trigger.dev@latest login
bunx trigger.dev@latest deploy
```

- [ ] **Step 6: Verify in Trigger.dev dashboard**

Open https://cloud.trigger.dev — verify all 14 scheduled tasks appear with correct cron patterns.

- [ ] **Step 7: Commit**

```bash
git add mira-crawler/trigger/
git commit -m "feat: add Trigger.dev orchestration — 14 cron schedules, bridge client"
```

---

### Task 9: Deploy to Bravo

- [ ] **Step 1: Add TASK_BRIDGE_API_KEY to Doppler**

```bash
doppler secrets set TASK_BRIDGE_API_KEY --project factorylm --config prd
```

- [ ] **Step 2: Copy updated files to Bravo**

```bash
# From travel laptop via Tailscale
scp -r mira-crawler/ bravo:~/MIRA/mira-crawler/
```

- [ ] **Step 3: Build and start containers on Bravo**

```bash
ssh bravo
cd ~/MIRA
doppler run --project factorylm --config prd -- docker compose -f mira-crawler/docker-compose.yml up -d --build
```

- [ ] **Step 4: Verify services**

```bash
# Redis
docker exec mira-redis redis-cli ping
# Expected: PONG

# Celery worker
docker exec mira-celery-worker celery -A mira_crawler.celery_app inspect ping
# Expected: pong from worker

# Task Bridge
curl -s http://localhost:8003/health
# Expected: {"status":"healthy","redis":"connected"}
```

- [ ] **Step 5: Trigger a test task**

```bash
curl -X POST http://localhost:8003/tasks/report \
  -H "Authorization: Bearer $(doppler secrets get TASK_BRIDGE_API_KEY --plain --project factorylm --config prd)"
# Expected: {"task_id":"...", "task_name":"report", "status":"queued"}
```

- [ ] **Step 6: Verify Trigger.dev → Bravo connectivity**

Manually trigger one task from the Trigger.dev dashboard. Check bridge logs:

```bash
docker logs mira-task-bridge --tail 20
```

- [ ] **Step 7: Commit deploy verification**

```bash
git commit --allow-empty -m "chore: verify 24/7 ingest pipeline deployed to Bravo"
```

---

## Verification Checklist

- [ ] Redis container healthy on Bravo (`docker exec mira-redis redis-cli ping`)
- [ ] Celery worker processing tasks (`celery inspect ping`)
- [ ] Task Bridge API on :8003 (`curl /health`)
- [ ] Trigger.dev dashboard showing 14 scheduled runs
- [ ] RSS feed poll returns new articles (check bridge logs)
- [ ] Quality gate quarantines a test low-relevance chunk
- [ ] NeonDB row count growing (`SELECT COUNT(*) FROM knowledge_entries`)
- [ ] All new tasks have pytest coverage (`pytest tests/ -v`)
- [ ] YouTube frame extraction produces `.jpg` files in `~/ingest_staging/youtube_frames/`
