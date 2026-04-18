"""Local in-process pipeline runner for offline testing.

Instantiates GSDEngine directly in Python — no Docker, no VPS, zero network hop
to bot adapters.  Production code paths run in-process:

  - InferenceRouter → Groq / Claude / Gemini (real LLM calls, real API keys)
  - NeonDB recall   (Neon is hosted separately from the VPS, still reachable)
  - Open WebUI      skipped — RAGWorker falls back gracefully to InferenceRouter

Secrets: loaded from env (run with Doppler or export manually):
    doppler run --project factorylm --config prd -- python3 tests/eval/offline_run.py

FSM state is tracked in a local SQLite at MIRA_DB_PATH
(default: /tmp/mira-offline-test.db).  Each test run can pass its own db_path
to keep sessions isolated.

Public API
----------
    pipeline = LocalPipeline()
    reply, status, latency = await pipeline.call(chat_id, message)
    state = pipeline.fsm_state(chat_id)
    pipeline.reset(chat_id)
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("mira-local-pipeline")

# ── Path bootstrap ────────────────────────────────────────────────────────────
# mira-bots/shared must be importable — add mira-bots/ to sys.path once.

_REPO_ROOT = Path(__file__).parent.parent.parent
_MIRA_BOTS = _REPO_ROOT / "mira-bots"

if str(_MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(_MIRA_BOTS))

# ── LocalPipeline ─────────────────────────────────────────────────────────────


class LocalPipeline:
    """In-process GSDEngine runner.

    Drop-in replacement for the VPS HTTP pipeline used by run_eval.py.
    Returns (reply, http_status, latency_ms) tuples so existing graders work
    without modification.

    Parameters
    ----------
    db_path:
        Path to SQLite database.  Defaults to MIRA_DB_PATH env var, then
        /tmp/mira-offline-test.db.  File is created automatically.
    tenant_id:
        NeonDB tenant for RAG recall.  Defaults to MIRA_TENANT_ID env var.
    verbose:
        Enable INFO-level logging from the engine and workers.
    neon_fallback:
        If True and NEON_DATABASE_URL is missing/unusable, continue without
        NeonDB recall (RAGWorker returns empty chunks → honesty directive fires).
    """

    def __init__(
        self,
        db_path: str | None = None,
        tenant_id: str | None = None,
        verbose: bool = False,
        neon_fallback: bool = True,
    ) -> None:
        if verbose:
            logging.basicConfig(
                level=logging.INFO,
                format="%(asctime)s %(levelname)s %(name)s: %(message)s",
            )
        else:
            # Suppress engine chatter unless caller turns it on
            for name in ("mira-gsd", "mira-local-pipeline", "httpx"):
                logging.getLogger(name).setLevel(logging.WARNING)

        # Always suppress expected-in-offline-mode noise regardless of verbose flag:
        # - Gemini 429 (key blocked per CLAUDE.md "Known Broken")
        # - Ollama DNS failures (Ollama not running locally on CHARLIE)
        # - langfuse not installed
        # - GLM-OCR DNS failures
        # These cascade gracefully to Groq/Claude — no action needed.
        _ALWAYS_QUIET = [
            "mira.evals.langfuse",
            "httpcore",
        ]
        for name in _ALWAYS_QUIET:
            logging.getLogger(name).setLevel(logging.ERROR)

        # Database path
        self.db_path = db_path or os.getenv("MIRA_DB_PATH", "/tmp/mira-offline-test.db")
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)

        # Wire env vars for in-process use (don't clobber if already set by caller)
        os.environ.setdefault("INFERENCE_BACKEND", "cloud")
        os.environ.setdefault("MIRA_DB_PATH", self.db_path)

        # Open WebUI is deliberately unreachable — RAGWorker catches the connection
        # error and falls back to InferenceRouter (the cascade still fires).
        _openwebui_url = os.getenv("OPENWEBUI_BASE_URL", "http://localhost:8080")
        _api_key = os.getenv("OPENWEBUI_API_KEY", "offline-mode")
        _collection_id = os.getenv("KNOWLEDGE_COLLECTION_ID", "offline")
        _vision_model = os.getenv("VISION_MODEL", "qwen2.5vl:7b")
        self._tenant_id = tenant_id or os.getenv("MIRA_TENANT_ID", "")

        # Validate NeonDB reachability — warn and continue if unavailable
        if not os.getenv("NEON_DATABASE_URL"):
            if neon_fallback:
                logger.warning(
                    "NEON_DATABASE_URL not set — RAG recall will return empty chunks. "
                    "Knowledge-grounded responses will fire honesty directives."
                )
            else:
                raise RuntimeError(
                    "NEON_DATABASE_URL required (set neon_fallback=True to run without it)"
                )

        # Import after path setup so mira-bots/ is on sys.path
        from shared.gsd_engine import GSDEngine  # noqa: PLC0415

        self._engine = GSDEngine(
            db_path=self.db_path,
            openwebui_url=_openwebui_url,
            api_key=_api_key,
            collection_id=_collection_id,
            vision_model=_vision_model,
            tenant_id=self._tenant_id,
        )

        logger.info(
            "LocalPipeline ready | db=%s | tenant=%s | backend=%s | neon=%s",
            self.db_path,
            self._tenant_id or "(none)",
            os.getenv("INFERENCE_BACKEND"),
            "ok" if os.getenv("NEON_DATABASE_URL") else "offline",
        )

    # ── Core call ─────────────────────────────────────────────────────────────

    async def call(
        self,
        chat_id: str,
        message: str,
        photo_b64: str | None = None,
    ) -> tuple[str, int, int]:
        """Send one turn through the engine.

        Returns
        -------
        (reply, http_status, latency_ms)
            http_status is 200 on success, 500 on exception.  This matches the
            shape produced by run_eval.py so grader.py works without changes.
        """
        t0 = time.monotonic()
        try:
            reply = await self._engine.process(
                chat_id,
                message,
                photo_b64,
                platform="offline",
            )
            latency_ms = int((time.monotonic() - t0) * 1000)
            return reply, 200, latency_ms
        except Exception as exc:  # noqa: BLE001
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.error("Engine error for chat_id=%s: %s", chat_id, exc, exc_info=True)
            return f"[ENGINE ERROR: {exc}]", 500, latency_ms

    # ── FSM helpers ───────────────────────────────────────────────────────────

    def fsm_state(self, chat_id: str) -> str:
        """Read current FSM state from local SQLite.  Falls back to UNKNOWN."""
        try:
            conn = sqlite3.connect(self.db_path)
            row = conn.execute(
                "SELECT state FROM conversation_state WHERE chat_id = ?",
                (chat_id,),
            ).fetchone()
            conn.close()
            return row[0] if row else "IDLE"
        except Exception as exc:  # noqa: BLE001
            logger.warning("fsm_state read failed: %s", exc)
            return "UNKNOWN"

    def reset(self, chat_id: str) -> None:
        """Reset a session to IDLE state."""
        self._engine.reset(chat_id)

    def last_kb_status(self) -> dict:
        """Return KB coverage status from the most recent RAG call.

        Reads directly from the RAGWorker's kb_status property — set during
        each process() call by _compute_kb_status() (feat/citation-gate).
        Returns {"status": "unknown", "citations": []} if not yet available.
        """
        try:
            return self._engine._supervisor.rag.kb_status
        except AttributeError:
            return {"status": "unknown", "citations": []}

    def last_retrieved_chunks(self) -> list[str]:
        """Return text of chunks retrieved during the most recent RAG call.

        Used by cp_citation_groundedness to verify numeric specs are grounded
        in retrieved documentation rather than hallucinated from training data.
        """
        try:
            return list(self._engine._supervisor.rag._last_sources)
        except AttributeError:
            return []

    # ── Interaction history ───────────────────────────────────────────────────

    def interaction_history(self, chat_id: str) -> list[dict[str, Any]]:
        """Return all logged turns for chat_id (from interactions table)."""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT user_message, assistant_reply, fsm_state,
                       response_time_ms, created_at
                FROM interactions
                WHERE chat_id = ?
                ORDER BY created_at
                """,
                (chat_id,),
            ).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception:  # noqa: BLE001
            return []

    # ── Scenario runner ───────────────────────────────────────────────────────

    async def run_scenario(
        self,
        fixture: dict,
        chat_id_prefix: str = "local",
        retrieved_chunks: list[str] | None = None,
    ) -> tuple[list[str], list[int], list[int], str, list[str]]:
        """Run a complete scenario fixture through the local engine.

        Returns
        -------
        (responses, http_statuses, latencies_ms, final_fsm_state, last_retrieved_chunks)

        last_retrieved_chunks contains the RAG chunks from the final turn — used by
        cp_citation_groundedness to verify numeric specs are grounded in retrieved docs.
        """
        import uuid

        run_id = uuid.uuid4().hex[:8]
        chat_id = f"{chat_id_prefix}-{fixture['id']}-{run_id}"

        user_turns = [t for t in fixture.get("turns", []) if t["role"] == "user"]
        responses: list[str] = []
        http_statuses: list[int] = []
        latencies_ms: list[int] = []
        final_chunks: list[str] = []

        for i, turn in enumerate(user_turns):
            message = turn["content"]
            photo_b64 = None

            # Photo support: if turn has a "photo" key, load that file
            if "photo" in turn:
                photo_path = _resolve_photo_path(turn["photo"])
                if photo_path and photo_path.exists():
                    photo_b64 = image_to_b64(photo_path)
                else:
                    logger.warning("Photo not found: %s", turn.get("photo"))

            reply, status, latency = await self.call(chat_id, message, photo_b64)
            responses.append(reply)
            http_statuses.append(status)
            latencies_ms.append(latency)
            # Capture chunks after each turn; last turn's chunks used for grading
            final_chunks = self.last_retrieved_chunks()

            logger.info(
                "  Turn %d/%d: %s→ %dms HTTP%d %d chars kb=%s chunks=%d",
                i + 1,
                len(user_turns),
                message[:40],
                latency,
                status,
                len(reply),
                self.last_kb_status().get("status", "?"),
                len(final_chunks),
            )

        return responses, http_statuses, latencies_ms, self.fsm_state(chat_id), final_chunks


# ── Photo utilities ────────────────────────────────────────────────────────────

_PHOTOS_DIR = Path(__file__).parent / "fixtures" / "photos"


def image_to_b64(path: str | Path) -> str:
    """Load an image file and return base64-encoded JPEG string."""
    import io

    from PIL import Image

    with Image.open(path) as img:
        # Convert to RGB (handles RGBA, palette, etc.)
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode()


def _resolve_photo_path(photo_ref: str) -> Path | None:
    """Resolve a photo reference to an absolute path.

    Accepts:
    - Absolute path
    - Path relative to fixtures/photos/
    - Bare filename (looked up in fixtures/photos/)
    """
    p = Path(photo_ref)
    if p.is_absolute():
        return p
    # Relative to photos dir
    candidate = _PHOTOS_DIR / photo_ref
    if candidate.exists():
        return candidate
    # Bare filename
    candidate2 = _PHOTOS_DIR / p.name
    if candidate2.exists():
        return candidate2
    return None


# ── Sync shim for non-async callers ───────────────────────────────────────────


def call_sync(
    pipeline: LocalPipeline,
    chat_id: str,
    message: str,
    photo_b64: str | None = None,
) -> tuple[str, int, int]:
    """Blocking wrapper around LocalPipeline.call.  For scripts / tests only."""
    return asyncio.run(pipeline.call(chat_id, message, photo_b64))
