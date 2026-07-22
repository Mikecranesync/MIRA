"""Dedicated POTD judge readiness — fail-closed, structural + optional live.

Covers every prerequisite for a trustworthy independent judge (requirement 7):
import, initialization, provider keys, a vision-capable provider (model
availability), and the strict config. Under ``live=True`` it additionally runs a
tiny probe and checks non-empty output, a valid judge-JSON verdict, a recorded
judge identity, and (when ``POTD_JUDGE_MODEL`` is pinned) an identity match —
plus that the judge is not the interpreter's own model (no self-review).

Structural checks never call the model; the live probe makes one small judge
call (used only from a budgeted --live path). Injectable ``router`` / ``probe``
keep it hermetically testable.
"""

from __future__ import annotations

from pathlib import Path

from . import judge_independence as ji

_CANARY = Path(__file__).resolve().parents[2] / "tools" / "canary_fixtures" / "vision_canary.png"


def _load_router(router):
    if router is not None:
        return router, None
    try:
        from shared.inference.router import InferenceRouter  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        return None, f"import failed: {exc}"
    try:
        return InferenceRouter(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"init failed: {exc}"


def _has_vision_provider(router) -> bool:
    """True when the cascade has at least one provider with a vision model."""
    try:
        return any(getattr(p, "vision_model", "") for p in getattr(router, "providers", []))
    except Exception:  # noqa: BLE001
        return False


def check_judge_readiness(
    *,
    live: bool = False,
    router=None,
    interpreter_provider: str | None = None,
    interpreter_model: str | None = None,
    probe=None,
) -> dict:
    """Return a readiness report. ``ready`` is the structural verdict; ``live_ok``
    (when live) is the probe verdict. Fail-closed: any missing prerequisite is a
    blocker."""
    cfg = ji.judge_config()
    checks: dict[str, bool] = {}
    blockers: list[str] = []

    router, load_err = _load_router(router)
    checks["import_and_init"] = router is not None
    if router is None:
        blockers.append(f"InferenceRouter unavailable: {load_err}")
        return _report(cfg, checks, blockers, ready=False, live=live)

    enabled = bool(getattr(router, "enabled", False))
    checks["keys_enabled"] = enabled
    if not enabled:
        blockers.append("InferenceRouter not enabled (INFERENCE_BACKEND=cloud + a provider key)")

    has_vision = _has_vision_provider(router)
    checks["vision_model_available"] = has_vision
    if not has_vision:
        blockers.append("no vision-capable provider in the cascade (judge grades an image)")

    checks["config_present"] = bool(cfg["provider"] and cfg["policy"])
    if not checks["config_present"]:
        blockers.append("POTD judge config incomplete")

    ready = not blockers

    live_ok = None
    if live and ready:
        live_ok, live_blockers = _live_probe(
            router, interpreter_provider, interpreter_model, cfg, probe
        )
        blockers.extend(live_blockers)

    return _report(cfg, checks, blockers, ready=ready, live=live, live_ok=live_ok)


def _live_probe(router, interp_provider, interp_model, cfg, probe) -> tuple[bool, list[str]]:
    """One small judge call → verify non-empty, valid JSON, identity, no self-review."""
    from . import judge_runtime  # noqa: PLC0415 — avoid import cycle at module load

    runner = probe or judge_runtime.run_judge
    try:
        img = _CANARY.read_bytes() if _CANARY.exists() else b"\x89PNG\r\n"
    except Exception:  # noqa: BLE001
        img = b"\x89PNG\r\n"
    res = runner(
        image_bytes=img,
        response_text="This is a canary print; the visible tokens are MIRA CANARY 7.",
        source_meta={"title": "judge-readiness-canary"},
        interpreter_provider=interp_provider,
        interpreter_model=interp_model,
        media_type="image/png",
        router=router,
    )
    blockers: list[str] = []
    if res.get("validation_status") != "valid":
        blockers.append(f"live judge verdict not valid: {res.get('validation_status')}")
    if not res.get("identity_verified"):
        blockers.append("live judge identity not recorded")
    if res.get("self_review"):
        blockers.append("live judge is the interpreter model (self-review)")
    if cfg["model"] and res.get("judge_model") != cfg["model"]:
        blockers.append(f"live judge model {res.get('judge_model')!r} != pinned {cfg['model']!r}")
    return (not blockers), blockers


def _report(cfg, checks, blockers, *, ready, live, live_ok=None) -> dict:
    return {
        "ready": ready and (live_ok is not False),
        "structural_ready": ready,
        "live": live,
        "live_ok": live_ok,
        "config": cfg,
        "checks": checks,
        "blockers": blockers,
    }
