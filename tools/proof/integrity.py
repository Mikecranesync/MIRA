"""Pure, dependency-free integrity guards for the proof packets.

Imported by run_proof.py (the harness) AND test_proof_integrity.py (deterministic
tests) so the honesty/metadata rules are enforced in one place, not duplicated.
No DB, no network, no engine — safe to import anywhere.
"""
from __future__ import annotations

REQUIRED_METADATA = ["git_sha", "git_branch", "config", "tenant_id", "shared_tenant_id", "corpus", "health", "grader"]
REQUIRED_HEALTH = ["embedder_ollama_reachable", "reranker_nvidia_configured", "langfuse_enabled", "langfuse_note", "python"]
REQUIRED_RESULT = ["scenario_id", "question", "answer", "citations", "retrieved", "abnormal",
                   "ingest", "retrieval_mode", "verdict", "langfuse"]


def assert_substitute_honest(records: list) -> None:
    """Fail LOUDLY if a substitute scenario is dressed up as a real one. SimLab has
    NO pasteurizer; a temperature substitute (CIP) must never be labeled as one."""
    for r in records:
        is_sub = "SUBSTITUTE" in r.get("scenario_id", "") or bool(r.get("substitute_note"))
        title = (r.get("title") or "")
        if "pasteuriz" in title.lower() and not is_sub:
            raise AssertionError(f"HONESTY GUARD: '{r.get('scenario_id')}' claims pasteurizer but SimLab has none and it is not marked SUBSTITUTE.")
        if is_sub and "SUBSTITUTE" not in title:
            raise AssertionError(f"HONESTY GUARD: substitute '{r.get('scenario_id')}' must say SUBSTITUTE in its title.")


def validate_metadata(meta: dict) -> None:
    missing = [k for k in REQUIRED_METADATA if k not in meta or meta[k] in (None, "")]
    # git_sha may legitimately be None outside a git checkout; everything else required
    missing = [k for k in missing if k != "git_sha"]
    if missing:
        raise AssertionError(f"metadata missing required fields: {missing}")
    hmiss = [k for k in REQUIRED_HEALTH if k not in (meta.get("health") or {})]
    if hmiss:
        raise AssertionError(f"metadata.health missing: {hmiss}")
    # tenant must be EXPLICIT (not a config-name leak like 'staging')
    cfg = meta.get("config") or {}
    tid = cfg.get("MIRA_TENANT_ID")
    if not tid or "-" not in str(tid):
        raise AssertionError(f"tenant config not explicit (must be a UUID, got {tid!r})")


def validate_results(results: list) -> None:
    for r in results:
        miss = [k for k in REQUIRED_RESULT if k not in r]
        if miss:
            raise AssertionError(f"result '{r.get('scenario_id')}' missing: {miss}")
        if not r.get("retrieval_mode"):
            raise AssertionError(f"result '{r.get('scenario_id')}' does not report retrieval_mode")
        # a real scenario must carry the deterministic rubric; a substitute must say so
        if "SUBSTITUTE" not in r.get("scenario_id", "") and not r.get("rubric"):
            raise AssertionError(f"real scenario '{r.get('scenario_id')}' missing the rubric grade")
        # langfuse degraded mode must be DOCUMENTED, not silently passed
        lf = r.get("langfuse") or {}
        if lf.get("enabled_this_run") is None and "trace_name" not in lf:
            raise AssertionError(f"result '{r.get('scenario_id')}' does not document langfuse status")
