"""Tests for Reddit Benchmark Agent — DB, routes, confidence inference."""

import os
import sys
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

# Add both paths before any local imports
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))

import main as ingest_main  # noqa: E402
from shared.benchmark_db import (  # noqa: E402
    count_questions,
    create_run,
    ensure_tables,
    finish_run,
    get_run,
    insert_question,
    insert_result,
    list_questions,
    list_results,
)
from shared.engine import Supervisor  # noqa: E402

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolated_db(tmp_path):
    """Redirect DB to temp location for every test."""
    db_path = str(tmp_path / "test_benchmark.db")
    orig_db = ingest_main.DB_PATH
    ingest_main.DB_PATH = db_path

    # Also init photos dir for the main app fixture
    photos_dir = tmp_path / "photos"
    photos_dir.mkdir()
    orig_dir = ingest_main.PHOTOS_DIR
    ingest_main.PHOTOS_DIR = photos_dir
    ingest_main._ensure_table()

    # Ensure benchmark tables exist
    ensure_tables(db_path)

    yield db_path

    ingest_main.DB_PATH = orig_db
    ingest_main.PHOTOS_DIR = orig_dir
    # Reset lazy-loaded benchmark module
    ingest_main._benchmark_db = None


@pytest.fixture
def client():
    return TestClient(ingest_main.app)


# ---------------------------------------------------------------------------
# 1. benchmark_db — insert + list questions
# ---------------------------------------------------------------------------


def test_insert_and_list_questions(isolated_db):
    qid = insert_question(
        title="VFD fault code OC — what to check?",
        body="My PowerFlex 525 is throwing overcurrent.",
        subreddit="PLC",
        post_id="abc123",
        score=15,
        url="https://reddit.com/r/PLC/abc123",
        db_path=isolated_db,
    )
    assert qid > 0
    questions = list_questions(db_path=isolated_db)
    assert len(questions) == 1
    assert questions[0]["title"] == "VFD fault code OC — what to check?"
    assert questions[0]["subreddit"] == "PLC"


# ---------------------------------------------------------------------------
# 2. benchmark_db — duplicate post_id is skipped
# ---------------------------------------------------------------------------


def test_duplicate_post_id_skipped(isolated_db):
    insert_question(title="Q1", post_id="dup1", db_path=isolated_db)
    dup_id = insert_question(title="Q2", post_id="dup1", db_path=isolated_db)
    assert dup_id == -1
    assert count_questions(isolated_db) == 1


# ---------------------------------------------------------------------------
# 3. benchmark_db — run lifecycle (create, finish, get)
# ---------------------------------------------------------------------------


def test_run_lifecycle(isolated_db):
    run_id = create_run(metadata={"test": True}, db_path=isolated_db)
    assert run_id > 0

    run = get_run(run_id, isolated_db)
    assert run["status"] == "running"

    finish_run(run_id, status="completed", question_count=5, db_path=isolated_db)
    run = get_run(run_id, isolated_db)
    assert run["status"] == "completed"
    assert run["question_count"] == 5


# ---------------------------------------------------------------------------
# 4. benchmark_db — insert and list results
# ---------------------------------------------------------------------------


def test_insert_and_list_results(isolated_db):
    qid = insert_question(title="Test Q", post_id="res1", db_path=isolated_db)
    run_id = create_run(db_path=isolated_db)

    insert_result(
        run_id=run_id,
        question_id=qid,
        reply="Check the motor overload relay.",
        confidence="high",
        latency_ms=1234,
        db_path=isolated_db,
    )
    results = list_results(run_id, isolated_db)
    assert len(results) == 1
    assert results[0]["confidence"] == "high"
    assert results[0]["latency_ms"] == 1234
    assert results[0]["question_title"] == "Test Q"


# ---------------------------------------------------------------------------
# 5. Supervisor._infer_confidence — keyword-based levels
# ---------------------------------------------------------------------------


def test_infer_confidence_levels():
    assert Supervisor._infer_confidence("") == "none"
    assert Supervisor._infer_confidence("hi") == "none"
    assert (
        Supervisor._infer_confidence("Replace the contactor. Check wiring on terminal 4.") == "high"
    )
    assert (
        Supervisor._infer_confidence(
            "It might be the drive, could be the motor, hard to say without testing."
        )
        == "low"
    )
    assert (
        Supervisor._infer_confidence(
            "The drive fault code indicates overcurrent. It could be a wiring issue. "
            "Check wiring at the motor junction box."
        )
        == "medium"
    )


# ---------------------------------------------------------------------------
# 6. FastAPI — benchmark disabled returns 503
# ---------------------------------------------------------------------------


def test_benchmark_disabled_returns_503(client):
    with patch.dict(os.environ, {"REDDIT_BENCHMARK_ENABLED": "0"}, clear=False):
        # Force re-read of flag
        ingest_main._BENCHMARK_ENABLED = False
        resp = client.post("/agents/reddit-benchmark/harvest")
        assert resp.status_code == 503
        assert "disabled" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 7. FastAPI — questions endpoint returns data when enabled
# ---------------------------------------------------------------------------


def test_benchmark_questions_endpoint(client, isolated_db):
    # Enable flag
    ingest_main._BENCHMARK_ENABLED = True
    # Reset lazy module so it re-inits with test DB
    ingest_main._benchmark_db = None

    # Seed a question
    insert_question(
        title="Motor vibration at 3600 RPM",
        post_id="endpt1",
        subreddit="IndustrialMaintenance",
        db_path=isolated_db,
    )

    resp = client.get("/agents/reddit-benchmark/questions?limit=10")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert len(data["questions"]) == 1
    assert data["questions"][0]["subreddit"] == "IndustrialMaintenance"

    # Reset
    ingest_main._BENCHMARK_ENABLED = False


# ---------------------------------------------------------------------------
# 8. reddit_harvest — httpx JSON parse + filtering
# ---------------------------------------------------------------------------


def test_harvest_parses_json_and_filters(isolated_db):
    """Mock reddit_harvest._fetch_search to return fake posts; verify filter + dedup."""
    # Each dict mirrors the `children[i]` shape that _fetch_search() returns:
    # the raw Reddit `/search.json` child (has a `data` subkey with the post).
    fake_children = [
        {
            "data": {
                "id": "post1",
                "title": "How do I troubleshoot a VFD fault code?",
                "selftext": "Getting F004 on startup, any ideas?",
                "score": 25,
                "permalink": "/r/PLC/comments/post1/how_do_i/",
                "is_self": True,
            }
        },
        {
            "data": {
                "id": "post2",
                "title": "Check out my new workshop",
                "selftext": "Finally finished the shop.",
                "score": 100,
                "permalink": "/r/PLC/comments/post2/check_out/",
                "is_self": True,
            }
        },
        {
            "data": {
                "id": "post3",
                "title": "Motor keeps tripping on startup?",
                "selftext": "3-phase motor, trips every time.",
                "score": 12,
                "permalink": "/r/PLC/comments/post3/motor_keeps/",
                "is_self": True,
            }
        },
    ]

    # Add scripts path so we can import reddit_harvest
    scripts_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "scripts",
    )
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)

    import reddit_harvest

    # Patch at the seam: _fetch_search() is the single function that talks to Reddit.
    # Every (sub, query) pair gets the same 3 posts; seen_post_ids dedup guarantees
    # each is only counted once across the 30 calls (5 subs × 6 queries).
    # Also stub time.sleep so the 2s-per-call throttle doesn't add 60s to the test.
    with (
        patch.object(reddit_harvest, "_fetch_search", return_value=fake_children),
        patch.object(reddit_harvest.time, "sleep", return_value=None),
    ):
        result = reddit_harvest.harvest(db_path=isolated_db)

    # post1 → relevant (ends with ?, matches vfd|fault|troubleshoot)
    # post2 → filtered (no diagnostic keywords, no question shape)
    # post3 → relevant (ends with ?, matches motor|keeps|trip)
    assert result["harvested"] == 2
    assert result["total"] == 2
    assert result["total"] >= 2
