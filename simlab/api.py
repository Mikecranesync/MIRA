"""FastAPI surface for SimLab — deterministic, testable.

All routes are stateless relative to a single injected ``SimEngine`` and
``ApprovalStore``.  Tests inject these via ``build_app(engine=..., approvals=...)``.

Module-level ``app`` is built with the default juice line + underfill armed.
Production startup uses ``simlab.__main__``.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("simlab.api")

# Lazy FastAPI import — sim core loads bare without it.
try:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import HTMLResponse, PlainTextResponse
    _HAS_FASTAPI = True
except ImportError:  # pragma: no cover
    _HAS_FASTAPI = False
    FastAPI = None  # type: ignore[assignment,misc]
    HTTPException = None  # type: ignore[assignment]
    PlainTextResponse = None  # type: ignore[assignment]
    HTMLResponse = None  # type: ignore[assignment]

_DOCS_ROOT = Path(__file__).parent / "docs"
_DASHBOARD_HTML_PATH = Path(__file__).parent / "dashboard.html"


def _dashboard_html() -> str:
    """The self-scoring dashboard page (read from disk; small, cached per process)."""
    global _DASHBOARD_HTML_CACHE
    if _DASHBOARD_HTML_CACHE is None:
        _DASHBOARD_HTML_CACHE = _DASHBOARD_HTML_PATH.read_text(encoding="utf-8")
    return _DASHBOARD_HTML_CACHE


_DASHBOARD_HTML_CACHE: Optional[str] = None


def build_app(
    engine: Optional[Any] = None,
    approvals: Optional[Any] = None,
    flight_recorder: Optional[Any] = None,
) -> Any:
    """Build and return a FastAPI app.

    Parameters
    ----------
    engine:
        A ``SimEngine`` instance.  If None, builds one from the juice bottling line.
    approvals:
        An ``ApprovalStore`` instance.  If None, creates one at the default path.
    flight_recorder:
        A recorder with ``record/events/clear`` methods. If None, creates a
        process-local ``InMemoryFlightRecorder``.
    """
    if not _HAS_FASTAPI:
        raise RuntimeError("fastapi is not installed — cannot build SimLab API app.")

    from simlab.approval import ApprovalStore
    from simlab.diagnostic import assemble_evidence
    from simlab.engine import SimEngine
    from simlab.flight_recorder import InMemoryFlightRecorder
    from simlab.lines.juice_bottling import build_factory, build_line
    from simlab.scenarios import get_scenario
    from simlab.uns import asset_path, line_path

    if engine is None:
        line = build_line()
        engine = SimEngine(line)
    if approvals is None:
        approvals = ApprovalStore()
    if flight_recorder is None:
        flight_recorder = InMemoryFlightRecorder()
    engine.add_flight_recorder(flight_recorder)

    # Live MQTT feed (opt-in): set SIMLAB_MQTT_HOST to stream every advance() to a broker, read-only.
    # Unset -> no publisher attached -> the sim behaves exactly as before (pull-only /snapshot).
    import os

    mqtt_host = os.getenv("SIMLAB_MQTT_HOST", "").strip()
    if mqtt_host:
        from simlab.publishers import MqttPublisher

        mqtt_port = int(os.getenv("SIMLAB_MQTT_PORT", "1883"))
        engine.add_publisher(MqttPublisher(host=mqtt_host, port=mqtt_port))
        logger.info("SimLab live MQTT feed enabled -> %s:%d", mqtt_host, mqtt_port)

    # Live HTTP relay feed (opt-in): set SIMLAB_RELAY_URL to POST every advance()
    # snapshot to mira-relay /api/v1/tags/ingest, landing rows in tag_events +
    # live_signal_cache (UNS-mapped) — the shortest path to "SimLab data landed
    # against a real UNS". Read-only / publish-out only; no PLC writes.
    #   SIMLAB_RELAY_HMAC_KEY  -> production-shaped HMAC auth (tenant authoritative)
    #   SIMLAB_RELAY_API_KEY   -> bench bearer auth (needs relay RELAY_LEGACY_BEARER=1)
    #   SIMLAB_RELAY_TENANT_ID -> override the reserved SIMLAB_TENANT_ID (default)
    relay_url = os.getenv("SIMLAB_RELAY_URL", "").strip()
    if relay_url:
        from simlab import SIMLAB_TENANT_ID
        from simlab.publishers import RelayIngestPublisher

        tenant_id = os.getenv("SIMLAB_RELAY_TENANT_ID", "").strip() or SIMLAB_TENANT_ID
        hmac_key = os.getenv("SIMLAB_RELAY_HMAC_KEY", "").strip()
        api_key = os.getenv("SIMLAB_RELAY_API_KEY", "").strip()
        engine.add_publisher(
            RelayIngestPublisher(
                relay_url, tenant_id=tenant_id, api_key=api_key, hmac_key=hmac_key
            )
        )
        logger.info(
            "SimLab live relay feed enabled -> %s (tenant=%s, auth=%s)",
            relay_url,
            tenant_id,
            "hmac" if hmac_key else ("bearer" if api_key else "open"),
        )

    _line = engine._line  # noqa: SLF001
    _factory = build_factory()

    app = FastAPI(
        title="SimLab API",
        description="Deterministic juice-bottling-line simulation for MIRA.",
        version="0.1.0",
    )

    # ------------------------------------------------------------------
    # Metadata / line structure
    # ------------------------------------------------------------------

    @app.get("/simlab/healthz")
    def healthz() -> dict:
        return {"status": "ok", "tick": engine.tick}

    @app.get("/simlab/factories")
    def get_factories() -> list[dict]:
        return [
            {
                "site_id": _factory.site_id,
                "site_display": _factory.site_display,
                "factory_display": _factory.factory_display,
            }
        ]

    @app.get("/simlab/lines")
    def get_lines() -> list[dict]:
        lines = []
        for plant in _factory.plants:
            for line in plant.lines:
                lines.append(
                    {
                        "line_id": line.line_id,
                        "display_name": line.display_name,
                        "uns_path": line_path(),
                        "asset_count": len(line.assets),
                        "utility_count": len(line.utilities),
                    }
                )
        return lines

    @app.get("/simlab/lines/{line_id}/assets")
    def get_line_assets(line_id: str) -> list[dict]:
        if line_id != _line.line_id:
            raise HTTPException(404, f"Line {line_id!r} not found")
        return [
            {
                "asset_id": a.asset_id,
                "asset_type": a.asset_type,
                "display_name": a.display_name,
                "uns_path": asset_path(a.asset_id),
                "is_utility": a in _line.utilities,
                "tag_count": len(a.tags),
            }
            for a in _line.all_assets()
        ]

    @app.get("/simlab/assets/{asset_id}/tags")
    def get_asset_tags(asset_id: str) -> list[dict]:
        try:
            asset = _line.asset(asset_id)
        except KeyError:
            raise HTTPException(404, f"Asset {asset_id!r} not found")
        from simlab.uns import tag_path as _tp

        return [
            {
                "tag": name,
                "category": td.category.value,
                "value_type": td.value_type.value,
                "default": td.default,
                "unit": td.unit,
                "uns_path": _tp(asset_id, td.category.value, name),
            }
            for name, td in asset.tags.items()
        ]

    # ------------------------------------------------------------------
    # Live state
    # ------------------------------------------------------------------

    @app.get("/simlab/snapshot")
    def get_snapshot(asset: Optional[str] = None) -> dict:
        snap = engine.snapshot_dict()
        if asset:
            try:
                _line.asset(asset)
            except KeyError:
                raise HTTPException(404, f"Asset {asset!r} not found")
            from simlab.uns import asset_path as _ap

            prefix = _ap(asset) + "."
            snap = {k: v for k, v in snap.items() if k.startswith(prefix)}
        return {"tick": engine.tick, "tags": snap}

    @app.get("/simlab/history")
    def get_history(tag: str) -> dict:
        hist = engine.history(tag)
        return {"uns_path": tag, "history": [{"tick": t, "value": v} for t, v in hist]}

    @app.get("/simlab/alarms")
    def get_alarms() -> list[dict]:
        return engine.active_alarms()

    @app.get("/simlab/flight-recorder/events")
    def get_flight_recorder_events() -> dict:
        return {"events": flight_recorder.events()}

    @app.get("/simlab/flight-recorder/export.ndjson")
    def export_flight_recorder_events() -> PlainTextResponse:
        return PlainTextResponse(
            flight_recorder.export_ndjson(),
            media_type="application/x-ndjson",
        )

    @app.post("/simlab/flight-recorder/clear")
    def clear_flight_recorder() -> dict:
        flight_recorder.clear()
        return {"status": "ok", "cleared": True}

    # ------------------------------------------------------------------
    # Scenario control
    # ------------------------------------------------------------------

    @app.post("/simlab/scenario/{scenario_id}/start")
    def start_scenario(scenario_id: str) -> dict:
        try:
            s = get_scenario(scenario_id)
        except KeyError:
            raise HTTPException(404, f"Scenario {scenario_id!r} not found")
        engine.reset()
        engine.load_scenario(s)
        return {"status": "ok", "scenario_id": scenario_id, "tick": engine.tick}

    @app.post("/simlab/scenario/reset")
    def reset_scenario() -> dict:
        engine.reset()
        return {"status": "ok", "tick": engine.tick}

    @app.post("/simlab/scenario/tick")
    def advance_tick(n: int = 1) -> dict:
        if n < 1 or n > 3600:
            raise HTTPException(400, "n must be 1–3600")
        engine.advance(n)
        return {"status": "ok", "tick": engine.tick, "alarms": engine.active_alarms()}

    @app.post("/simlab/scenario/{scenario_id}/replay")
    def replay_scenario(scenario_id: str, ticks: int = 60) -> dict:
        """Start a scenario from tick 0 and advance to ``ticks``."""
        try:
            s = get_scenario(scenario_id)
        except KeyError:
            raise HTTPException(404, f"Scenario {scenario_id!r} not found")
        if ticks < 1 or ticks > 86400:
            raise HTTPException(400, "ticks must be 1–86400")
        engine.reset()
        engine.load_scenario(s)
        engine.advance(ticks)
        return {
            "status": "ok",
            "scenario_id": scenario_id,
            "tick": engine.tick,
            "alarms": engine.active_alarms(),
        }

    @app.get("/simlab/scenario/{scenario_id}/rubric")
    def get_rubric(scenario_id: str) -> dict:
        try:
            s = get_scenario(scenario_id)
        except KeyError:
            raise HTTPException(404, f"Scenario {scenario_id!r} not found")
        return {
            "scenario_id": s.id,
            "expected_root_cause": s.expected_root_cause,
            "expected_asset": s.expected_asset,
            "expected_evidence_tags": s.expected_evidence_tags,
            "expected_actions": s.expected_actions,
            "expected_citations": s.expected_citations,
            "question": s.question,
        }

    # ------------------------------------------------------------------
    # Docs
    # ------------------------------------------------------------------

    @app.get("/simlab/assets/{asset_id}/docs")
    def list_asset_docs(asset_id: str) -> list[str]:
        try:
            asset = _line.asset(asset_id)
        except KeyError:
            raise HTTPException(404, f"Asset {asset_id!r} not found")
        return asset.docs

    @app.get("/simlab/docs/{asset_id}/{filename}")
    def get_doc(asset_id: str, filename: str) -> PlainTextResponse:
        doc_path = _DOCS_ROOT / asset_id / filename
        if not doc_path.exists():
            raise HTTPException(404, f"Doc {asset_id}/{filename} not found")
        return PlainTextResponse(doc_path.read_text())

    # ------------------------------------------------------------------
    # Evidence
    # ------------------------------------------------------------------

    @app.get("/simlab/evidence/{scenario_id}")
    def get_evidence(scenario_id: str) -> dict:
        try:
            s = get_scenario(scenario_id)
        except KeyError:
            raise HTTPException(404, f"Scenario {scenario_id!r} not found")
        ev = assemble_evidence(engine, s)
        abnormal_paths = sorted(tag["uns_path"] for tag in ev.abnormal_tags)
        flight_recorder.record(
            event_type="evidence_requested",
            seed=engine._seed,  # noqa: SLF001
            line_id=_line.line_id,
            tick=engine.tick,
            readings=engine.snapshot(),
            scenario_id=scenario_id,
            active_alarms=ev.active_alarms,
            changed_paths=abnormal_paths,
            details={
                "abnormal_tag_count": len(abnormal_paths),
                "abnormal_paths": abnormal_paths,
                "active_alarm_count": len(ev.active_alarms),
                "candidate_docs": list(ev.candidate_docs),
                "uns_subtree": ev.uns_subtree,
            },
        )
        return {
            "asset_id": ev.asset_id,
            "abnormal_tags": ev.abnormal_tags,
            "active_alarms": ev.active_alarms,
            "candidate_docs": ev.candidate_docs,
            "uns_subtree": ev.uns_subtree,
        }

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    @app.post("/simlab/validation/answer")
    def record_answer(body: dict) -> dict:
        qa_id = approvals.record_answer(
            scenario_id=body["scenario_id"],
            asset_uns_path=body["asset_uns_path"],
            question=body["question"],
            mira_answer=body["mira_answer"],
            citations=body.get("citations", []),
            evidence_tags=body.get("evidence_tags", []),
            groundedness=body.get("groundedness"),
        )
        return {"qa_id": qa_id}

    @app.post("/simlab/validation/{qa_id}/verdict")
    def set_verdict(qa_id: str, body: dict) -> dict:
        try:
            approvals.set_verdict(qa_id, body["verdict"], body.get("reviewed_by", ""))
        except KeyError as e:
            raise HTTPException(404, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"status": "ok"}

    # ------------------------------------------------------------------
    # Agent gate
    # ------------------------------------------------------------------

    @app.get("/simlab/agent/{asset_id}/gate")
    def get_gate(asset_id: str) -> dict:
        try:
            _line.asset(asset_id)
        except KeyError:
            raise HTTPException(404, f"Asset {asset_id!r} not found")
        from simlab.uns import asset_path as _ap

        uns = _ap(asset_id)
        return {"asset_id": asset_id, "uns_path": uns, **approvals.gate(uns)}

    # ------------------------------------------------------------------
    # Evaluation scorecard + self-scoring dashboard (Phase P5)
    #
    # The dashboard is the ProveIt demo surface: it runs every scenario through
    # the deterministic P1 evaluation service and renders the five graded
    # dimensions live — "watch the platform score itself against known truth".
    # The answerer is INJECTED (simlab/ stays LLM-free): `oracle` is the positive
    # control (100%), `evidence_only` shows what evidence alone yields (it misses
    # root-cause — that's MIRA's reasoning job). The real-Supervisor answerer is a
    # staging concern, not wired into the package.
    # ------------------------------------------------------------------
    from simlab import evaluation

    _ANSWERERS = {
        "oracle": evaluation.ground_truth_answerer,
        "evidence_only": evaluation.evidence_only_answerer,
    }

    def _resolve_answerer(name: str) -> Any:
        fn = _ANSWERERS.get(name)
        if fn is None:
            raise HTTPException(
                400, f"unknown answerer {name!r}; choose one of {sorted(_ANSWERERS)}"
            )
        return fn

    @app.get("/simlab/eval/scorecard")
    def eval_scorecard(answerer: str = "oracle") -> dict:
        """Score every scenario via the P1 evaluation service (answerer: oracle|evidence_only)."""
        scores = evaluation.run_all(_resolve_answerer(answerer))
        out = evaluation.to_json(scores)
        out["answerer"] = answerer
        out["answerers"] = sorted(_ANSWERERS)
        return out

    @app.get("/simlab/eval/{scenario_id}")
    def eval_scenario(scenario_id: str, answerer: str = "oracle") -> dict:
        try:
            scenario = get_scenario(scenario_id)
        except KeyError:
            raise HTTPException(404, f"scenario {scenario_id!r} not found")
        score = evaluation.run_scenario(scenario, _resolve_answerer(answerer))
        return evaluation.to_json([score])["scenarios"][0]

    @app.get("/simlab/dashboard", response_class=HTMLResponse)
    def dashboard() -> Any:
        return HTMLResponse(_dashboard_html())

    return app


# ---------------------------------------------------------------------------
# Module-level app (default juice line, underfill armed but not started)
# ---------------------------------------------------------------------------

def _make_default_app() -> Any:
    if not _HAS_FASTAPI:
        return None
    from simlab.approval import ApprovalStore
    from simlab.engine import SimEngine
    from simlab.lines.juice_bottling import build_line
    from simlab.scenarios import get_scenario

    line = build_line()
    _default_engine = SimEngine(line, seed=42)
    _default_engine.load_scenario(get_scenario("filler_underfill_low_bowl_pressure"))
    _default_approvals = ApprovalStore()
    return build_app(engine=_default_engine, approvals=_default_approvals)


app = _make_default_app()
