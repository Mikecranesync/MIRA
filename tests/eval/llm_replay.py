#!/usr/bin/env python3
"""Record/replay seam for a deterministic offline eval (beta-readiness plan P2-1).

The offline harness sends every LLM call through ``InferenceRouter.complete()``
and every retrieval through ``neon_recall.recall_*``. Against live providers and
a live KB the same input yields different output run-to-run (LLM temperature,
retrieval ordering), so the suite's pass count swings and a 1–2 case regression
is invisible against a moving baseline.

This module monkeypatches both edges with a **per-scenario** record/replay store
so the eval is deterministic and DB-/key-free on replay:

  record : capture live cascade + retrieval responses once (needs keys + DB).
  replay : serve them deterministically — no network, no API keys, no DB.
  live   : no-op (default) — behaves exactly as before.

Keying is PER SCENARIO so a divergence inside one fixture can't shift the
alignment of the next:
  * LLM calls    — positional within the scenario (the Nth call → Nth recorded
    response). Positional is immune to prompt-content drift.
  * retrieval    — content-addressed within the scenario (query → chunks), so
    repeated/retried identical queries hit.

The harness calls ``begin_scenario(id)`` before each fixture. Production code is
untouched: installed only when record|replay is selected (env MIRA_EVAL_REPLAY).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger("mira-eval-replay")

_STORE_PATH = Path(__file__).parent / "fixtures" / "llm_replay" / "cascade.json"
_RETR_STORE_PATH = Path(__file__).parent / "fixtures" / "llm_replay" / "retrieval.json"

# Volatile tokens normalized out of keys (ISO-8601 datetimes, UUIDs).
_ISO_DT_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?"
)
_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def _normalize(text: str) -> str:
    return _UUID_RE.sub("<UUID>", _ISO_DT_RE.sub("<TS>", text))


def request_key(messages: list[dict], max_tokens: int) -> str:
    payload = _normalize(json.dumps({"m": messages, "mt": max_tokens}, sort_keys=True, default=str))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _retrieval_key(scenario: str, fn: str, *parts) -> str:
    payload = _normalize(json.dumps([scenario, fn, *parts], sort_keys=True, default=str))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def resolve_mode(cli_value: Optional[str] = None) -> str:
    mode = (cli_value or os.getenv("MIRA_EVAL_REPLAY") or "live").strip().lower()
    if mode not in ("live", "record", "replay"):
        raise ValueError(f"invalid replay mode {mode!r} (expected live|record|replay)")
    return mode


# ── module state ───────────────────────────────────────────────────────────
stats = {"hits": 0, "drift": 0, "misses": 0, "recorded": 0}
retr_stats = {"hits": 0, "misses": 0, "recorded": 0}
_current = {"scenario": "_global", "idx": 0}
# Per-scenario replay cursors are derived from _current["idx"] reset on
# begin_scenario; the LLM store is grouped by scenario at install time.


def begin_scenario(scenario_id: str) -> None:
    """Reset the per-scenario LLM cursor. Called by the harness per fixture."""
    _current["scenario"] = scenario_id or "_global"
    _current["idx"] = 0


def install(mode: str, store_path: Optional[Path] = None, strict: bool = True) -> bool:
    """Monkeypatch the LLM + retrieval edges for record/replay. Returns True if
    a patch was installed (record|replay), False for live/no-op."""
    if mode == "live":
        return False

    from shared.inference import router as router_mod  # noqa: PLC0415

    path = store_path or _STORE_PATH
    # Store v3: {"version":3, "calls":[{"scenario","key","content","usage"}, ...]}
    recorded: list[dict] = []
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        recorded = data.get("calls", []) if isinstance(data, dict) else []

    # Group recorded calls by scenario for positional replay within each.
    by_scenario: dict[str, list[dict]] = {}
    for entry in recorded:
        by_scenario.setdefault(entry.get("scenario", "_global"), []).append(entry)

    _live_calls: list[dict] = []  # record-mode accumulator
    _orig = router_mod.InferenceRouter.complete

    def _save_llm():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"version": 3, "calls": _live_calls}, indent=2, default=str),
            encoding="utf-8",
        )

    async def _patched(
        self,
        messages: list[dict],
        max_tokens: int = 1024,
        session_id: str = "unknown_unknown_unknown",
        sanitize: bool = True,
    ):
        scn = _current["scenario"]
        key = request_key(messages, max_tokens)
        if mode == "replay":
            seq = by_scenario.get(scn, [])
            i = _current["idx"]
            if i < len(seq):
                _current["idx"] = i + 1
                entry = seq[i]
                if entry.get("key") != key:
                    stats["drift"] += 1  # positional used despite content drift
                stats["hits"] += 1
                return entry["content"], entry["usage"]
            stats["misses"] += 1
            if strict:
                raise RuntimeError(
                    f"llm_replay: scenario '{scn}' ran past its {len(seq)} recorded "
                    f"calls (call #{i + 1}). Re-record (MIRA_EVAL_REPLAY=record) or set "
                    f"MIRA_EVAL_REPLAY_LOOSE=1 to fall through to live."
                )
            return await _orig(self, messages, max_tokens, session_id=session_id, sanitize=sanitize)

        # record
        content, usage = await _orig(
            self, messages, max_tokens, session_id=session_id, sanitize=sanitize
        )
        _live_calls.append({"scenario": scn, "key": key, "content": content, "usage": usage})
        stats["recorded"] += 1
        _save_llm()
        return content, usage

    router_mod.InferenceRouter.complete = _patched  # type: ignore[method-assign]
    _install_retrieval(mode, None, strict)
    logger.warning(
        "llm_replay installed: mode=%s store=%s scenarios=%d calls=%d strict=%s",
        mode, path, len(by_scenario), len(recorded), strict,
    )
    return True


def _install_retrieval(mode: str, store_path: Optional[Path], strict: bool) -> None:
    """Content-keyed (per-scenario) record/replay for NeonDB retrieval so the
    eval is deterministic & DB-free on replay. Keys ignore the volatile
    embedding vector and use the query text + scenario."""
    from shared import neon_recall as nr  # noqa: PLC0415

    path = store_path or _RETR_STORE_PATH
    store: dict[str, object] = {}
    if path.exists():
        store = json.loads(path.read_text(encoding="utf-8"))

    def _save():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(store, indent=2, sort_keys=True, default=str), encoding="utf-8")

    def _wrap(fn_name, orig, key_args, default):
        def wrapped(*args, **kwargs):
            key = _retrieval_key(_current["scenario"], fn_name, *key_args(args, kwargs))
            if mode == "replay":
                if key in store:
                    retr_stats["hits"] += 1
                    return store[key]
                retr_stats["misses"] += 1
                if strict:
                    return default  # deterministic & DB-free; misses surface drift
                return orig(*args, **kwargs)
            result = orig(*args, **kwargs)
            store[key] = result
            retr_stats["recorded"] += 1
            _save()
            return result

        return wrapped

    _orig_rk = nr.recall_knowledge

    def _rk_key(args, kwargs):
        tenant = args[1] if len(args) > 1 else kwargs.get("tenant_id", "")
        limit = args[2] if len(args) > 2 else kwargs.get("limit", 3)
        qt = args[3] if len(args) > 3 else kwargs.get("query_text", "")
        return (qt, tenant, limit)

    nr.recall_knowledge = _wrap("recall_knowledge", _orig_rk, _rk_key, [])  # type: ignore[assignment]

    _orig_rfc = nr.recall_fault_code

    def _rfc_key(args, kwargs):
        code = args[0] if args else kwargs.get("code", "")
        tenant = args[1] if len(args) > 1 else kwargs.get("tenant_id", "")
        model = args[2] if len(args) > 2 else kwargs.get("model")
        return (code, tenant, model)

    nr.recall_fault_code = _wrap("recall_fault_code", _orig_rfc, _rfc_key, [])  # type: ignore[assignment]
