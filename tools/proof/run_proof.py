#!/usr/bin/env python3
"""Contextualized-diagnosis proof harness — runs SimLab fault scenarios end to end
and emits an auditable JSON record per fault (consumed by build_pdf.py).

For each fault: land the faulted signals through the deployed relay ingest path
(tag_events + live_signal_cache), recall the seeded SimLab docs, ask the REAL
Supervisor (direct-answer mode), and capture every piece of evidence a third
party needs to verify the result without trusting us.

Run (staging, never prod):
  doppler run --project factorylm --config stg -- python tools/proof/run_proof.py
"""
from __future__ import annotations
import sys, os, json, asyncio, hashlib, time, uuid, pathlib, re
import hmac as hmaclib
import psycopg2

# repo root on path (python adds the script dir, not the repo root)
_REPO = pathlib.Path(__file__).resolve().parents[2]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))
os.chdir(_REPO)

SIM = "00000000-0000-0000-0000-000000515ab1"
# Config-only fixes that turn retrieval into grounded diagnosis (see the proof report).
# Force-set (NOT setdefault) — Doppler stg ships MIRA_TENANT_ID="staging", which must be overridden.
for k, v in {"MIRA_TENANT_ID": SIM, "MIRA_SHARED_TENANT_ID": SIM, "MIRA_DIRECT_ANSWER_MODE": "1"}.items():
    os.environ[k] = v

# repo-root imports first (so tests.simlab / simlab resolve here, not mira-bots/tests)
from tests.simlab.juice_runner_adapter import simlab_scenario_to_state
from tests.simlab.supervisor_answerer import _to_supervisor_state, evidence_ticks
from simlab.scenarios import SCENARIOS
from simlab.engine import SimEngine
from simlab.lines.juice_bottling import build_line
from simlab.publishers import _build_ingest_batch

from simlab.diagnostic import grade  # REUSE the existing deterministic rubric grader

sys.path.insert(0, "mira-relay")
import relay_server
sys.path.insert(0, "mira-bots")
from shared.engine import Supervisor
from shared.neon_recall import recall_knowledge
import subprocess
import platform


def _git(args):
    try:
        return subprocess.check_output(["git"] + args, cwd=str(_REPO), stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return None


def _health() -> dict:
    """Health of the retrieval-quality dependencies. Reported in every packet so a
    reader knows whether the answer used full vector+rerank or a degraded path."""
    import urllib.request
    ollama = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
    embed_up = False
    try:
        urllib.request.urlopen(ollama.rstrip("/") + "/api/tags", timeout=3)
        embed_up = True
    except Exception:
        try:
            urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3); embed_up = True
        except Exception:
            embed_up = False
    reranker_configured = bool(os.getenv("NVIDIA_API_KEY"))
    try:
        sys.path.insert(0, "mira-bots")
        from shared import telemetry
        lf_enabled = telemetry.is_enabled()
    except Exception:
        lf_enabled = False
    try:
        import langfuse as _lf
        lf_ver = getattr(_lf, "__version__", "?")
    except Exception:
        lf_ver = "not-installed"
    return {
        "embedder_ollama_reachable": embed_up,
        "embedder_model": os.getenv("EMBED_TEXT_MODEL", "nomic-embed-text:latest"),
        "reranker_nvidia_configured": reranker_configured,
        "retrieval_hybrid_enabled": os.getenv("MIRA_RETRIEVAL_HYBRID_ENABLED", "true"),
        "langfuse_enabled": lf_enabled,
        "langfuse_version": lf_ver,
        "langfuse_note": "OK" if lf_enabled else "DISABLED — telemetry no-op (deployed Py3.12+langfuse2.50 emits 'supervisor.process'; this run's Python/langfuse are incompatible)",
        "python": platform.python_version(),
    }


def _corpus_fingerprint() -> dict:
    """Identify exactly which seeded corpus answered — so a reviewer can reproduce it."""
    conn = psycopg2.connect(NEON); cur = conn.cursor()
    cur.execute("select count(*) from knowledge_entries where tenant_id=%s::uuid", (SIM,))
    n = cur.fetchone()[0]
    cur.execute("select md5(string_agg(source_url, ',' order by source_url)) from "
                "(select distinct source_url from knowledge_entries where tenant_id=%s::uuid) s", (SIM,))
    h = cur.fetchone()[0]
    conn.close()
    return {"tenant_id": SIM, "knowledge_entries_chunks": n, "corpus_doc_set_md5": h,
            "corpus_label": "SimLab synthetic juice-bottling docs (tools/seeds/seed-simlab-docs.py)"}


def build_metadata() -> dict:
    return {
        "git_sha": _git(["rev-parse", "HEAD"]),
        "git_branch": _git(["rev-parse", "--abbrev-ref", "HEAD"]),
        "git_dirty": bool(_git(["status", "--porcelain"])),
        "env": "staging (factorylm/stg)",
        "config": {k: os.environ.get(k) for k in ("MIRA_TENANT_ID", "MIRA_SHARED_TENANT_ID",
                   "MIRA_DIRECT_ANSWER_MODE", "MIRA_RETRIEVAL_HYBRID_ENABLED")},
        "tenant_id": SIM,
        "shared_tenant_id": os.environ.get("MIRA_SHARED_TENANT_ID"),
        "corpus": _corpus_fingerprint(),
        "health": _health(),
        "grader": "simlab.diagnostic.grade (the repo's deterministic rubric — REUSED, not re-invented)",
    }


from integrity import assert_substitute_honest, validate_metadata, validate_results  # noqa: E402

NEON = os.environ["NEON_DATABASE_URL"]
KEY = "proof-hmac-key"
relay_server.MIRA_IGNITION_HMAC_KEY = KEY
from starlette.testclient import TestClient
_client = TestClient(relay_server.app)


def _vt(v):
    return "bool" if isinstance(v, bool) else "int" if isinstance(v, int) else "float" if isinstance(v, float) else "string"


def land_signals(tag_state: dict) -> dict:
    conn = psycopg2.connect(NEON); cur = conn.cursor()
    for t in ("approved_tags", "tag_events", "live_signal_cache"):
        cur.execute(f"DELETE FROM {t} WHERE source_system='simulator' AND tenant_id=%s::uuid", (SIM,))
    conn.commit()
    cur.execute(pathlib.Path("tools/seeds/approved_tags_simulator.sql").read_text()); conn.commit()
    tags = [{"tag_path": p, "value": v, "value_type": _vt(v), "quality": "good", "ts": "2026-06-24T05:00:00Z"} for p, v in tag_state.items()]
    body = json.dumps(_build_ingest_batch("simulator", tags), separators=(",", ":")).encode()
    n = uuid.uuid4().hex; ts = str(int(time.time()))
    sig = hmaclib.new(KEY.encode(), f"{SIM}\n{n}\n{ts}\n{hashlib.sha256(body).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    r = _client.post("/api/v1/tags/ingest", content=body,
                     headers={"X-MIRA-Tenant": SIM, "X-MIRA-Nonce": n, "X-MIRA-Timestamp": ts,
                              "X-MIRA-Signature": sig, "Content-Type": "application/json"})
    # capture DB evidence
    cur.execute("select count(*),count(distinct tag_path),bool_and(simulated) from tag_events where source_system='simulator' and tenant_id=%s::uuid", (SIM,))
    te = cur.fetchone()
    cur.execute("select count(*) from live_signal_cache where source_system='simulator' and tenant_id=%s::uuid", (SIM,))
    lc = cur.fetchone()[0]
    conn.close()
    j = r.json()
    return {"status": r.status_code, "accepted": j.get("accepted"), "rejected": len(j.get("rejected", [])),
            "tag_events_rows": te[0], "tag_events_distinct": te[1], "tag_events_all_sim": te[2], "live_signal_cache_rows": lc}


def cache_rows_for(asset: str) -> list:
    conn = psycopg2.connect(NEON); cur = conn.cursor()
    cur.execute("""select uns_path::text, coalesce(last_value_text, last_value_numeric::text, last_value_bool::text), simulated, source_system
                   from live_signal_cache where tenant_id=%s::uuid and uns_path::text like %s order by 1""",
                (SIM, f"%{asset}%"))
    rows = [{"uns_path": p, "value": v, "simulated": s, "source_system": ss} for p, v, s, ss in cur.fetchall()]
    conn.close()
    return rows


def _chunk_label(h: dict) -> str:
    src = h.get("source_url", "") or ""
    sec = h.get("section") or (h.get("metadata", {}) or {}).get("section") or ""
    return f"{src}" + (f" — {sec}" if sec else "")


def run_one(scenario, abnormal_tag_keys: list, question: str = None) -> dict:
    st = simlab_scenario_to_state(scenario.id, ticks=evidence_ticks(scenario.id))
    tag_state = st["tag_state"]
    asset = scenario.asset_id
    q = question or scenario.question

    ingest = land_signals(tag_state)
    cache = cache_rows_for(asset)

    # abnormal vs normal table (from the scenario's normal_state ground truth)
    normal = scenario.normal_state
    abn = []
    for k in abnormal_tag_keys:
        live_v = next((v for p, v in tag_state.items() if p.endswith(k) and asset in p), None)
        abn.append({"tag": k, "observed": live_v, "normal_baseline": normal.get(k)})

    # retrieval — asset-targeted query so the shown chunks match what grounds the answer
    rq = f"{q} {asset} " + " ".join(abnormal_tag_keys)
    hits = recall_knowledge(None, SIM, limit=5, query_text=rq)
    retrieved = [{"source": h.get("source_url", ""), "snippet": (h.get("content", "") or "")[:160].replace("\n", " ")} for h in hits]

    # ask the real Supervisor (direct-answer mode), live tags injected
    live = {p: v for p, v in tag_state.items() if asset in p}
    sup = Supervisor(db_path="proof_simlab.db", openwebui_url="http://localhost:3000", api_key="", collection_id="", tenant_id=SIM)
    sst = _to_supervisor_state(st); sst["state"] = "DIAGNOSIS"; sst["asset_identified"] = asset
    chat = f"proof_{scenario.id}"; sup.reset(chat); sup._save_state(chat, sst)
    reply = asyncio.run(sup.process(chat, q, tenant_id=SIM, live_tags=live))
    if not isinstance(reply, str):
        reply = str(reply)

    citations = re.findall(r"\[Source:\s*([^\]]+)\]", reply)
    body = reply.split("[Source")[0]
    trailing_q = body.rstrip().endswith("?")
    has_cite = bool(citations)
    grounded_kb = has_cite and all((h.get("source_url", "") or "").startswith("simlab://") for h in hits) and bool(hits)
    # retrieval mode actually used (from neon_recall retrieval_streams) — reports BM25-only vs vector+rerank
    streams = sorted(set().union(*[set(h.get("retrieval_streams", []) or []) for h in hits])) if hits else []
    retrieval_mode = "+".join(streams) if streams else "none"
    if streams == ["bm25"]:
        retrieval_mode = "bm25-only (no vector/rerank — embedder/reranker down)"
    # THE RIGOROUS VERDICT: the repo's own deterministic rubric grader
    rb = grade(reply, scenario)
    rubric = {"root_cause_hit": rb.root_cause_hit, "asset_hit": rb.asset_hit,
              "evidence_recall": round(rb.evidence_recall, 3), "citations_hit": rb.citations_hit,
              "actions_hit": rb.actions_hit, "rubric_passed": rb.passed}
    verdict = (ingest["status"] == 200 and not trailing_q and rb.passed)

    return {
        "scenario_id": scenario.id, "title": scenario.title, "asset": asset,
        "question": q, "answer": reply, "citations": citations,
        "retrieved": retrieved, "abnormal": abn, "cache": cache, "ingest": ingest,
        "uns_path": (st["uns_context"] or {}).get("uns_path"),
        "uns_source": (st["uns_context"] or {}).get("source"),
        "expected_root_cause": scenario.expected_root_cause,
        "expected_actions": scenario.expected_actions,
        "expected_citations": scenario.expected_citations,
        "expected_evidence_tags": scenario.expected_evidence_tags,
        "retrieval_mode": retrieval_mode,
        "rubric": rubric,
        "checks": {"ingest_200": ingest["status"] == 200, "no_trailing_question": not trailing_q,
                   "rubric_root_cause": rb.root_cause_hit, "rubric_asset": rb.asset_hit,
                   "rubric_evidence_recall>=0.5": rb.evidence_recall >= 0.5,
                   "grounded_in_simlab_kb": grounded_kb, "rubric_passed": rb.passed},
        "verdict": "PASS" if verdict else "REVIEW",
        "langfuse": {"trace_name": "supervisor.process", "enabled_this_run": False,
                     "trace_id_this_run": None},
    }


def run_cip_substitute() -> dict:
    """SUBSTITUTE for 'pasteurizer temperature fault' — SimLab's juice line has NO
    pasteurizer. The closest real process-temperature fault is the CIP skid supply
    temperature (CIP002 'Supply Temp Low'). Hand-injected (not an A-F scenario):
    supply_temp driven to 110 F (below the 130 F minimum / 140-170 F normal band)."""
    asset = "cipskid01"
    snap = SimEngine(build_line()).snapshot()
    tag_state = {r.uns_path: r.value for r in snap}
    sp = next(p for p in tag_state if "cipskid01" in p and "supply_temp" in p)
    tag_state[sp] = 110.0  # fault: below documented 130 F minimum
    uns = "enterprise.florida_natural_demo.plant1.juice_bottling.line01.cipskid01"
    adapter = {"asset_id": asset, "uns_context": {"source": "direct_connection", "confidence": "certified",
               "uns_path": uns, "scenario_id": "cip_supply_temp_low_SUBSTITUTE"},
               "tag_state": tag_state, "session_context": {"evidence": {}}}
    sst = _to_supervisor_state(adapter); sst["state"] = "DIAGNOSIS"; sst["asset_identified"] = asset
    ingest = land_signals(tag_state); cache = cache_rows_for(asset)
    q = "The CIP skid supply temperature is reading low during a heated step. What is wrong and what should I check?"
    hits = recall_knowledge(None, SIM, limit=5, query_text=q + " supply temperature low heater")
    retrieved = [{"source": h.get("source_url", ""), "snippet": (h.get("content", "") or "")[:160].replace("\n", " ")} for h in hits]
    live = {p: v for p, v in tag_state.items() if asset in p}
    sup = Supervisor(db_path="proof_simlab.db", openwebui_url="http://localhost:3000", api_key="", collection_id="", tenant_id=SIM)
    chat = "proof_cip_temp"; sup.reset(chat); sup._save_state(chat, sst)
    reply = asyncio.run(sup.process(chat, q, tenant_id=SIM, live_tags=live))
    if not isinstance(reply, str):
        reply = str(reply)
    citations = re.findall(r"\[Source:\s*([^\]]+)\]", reply)
    body = reply.split("[Source")[0]
    trailing_q = body.rstrip().endswith("?")
    has_action = bool(re.search(r"\b(check|inspect|verify|measure|replace|confirm|adjust)\b", reply, re.I))
    names_asset = "cip" in reply.lower()
    streams = sorted(set().union(*[set(h.get("retrieval_streams", []) or []) for h in hits])) if hits else []
    retrieval_mode = ("bm25-only (no vector/rerank — embedder/reranker down)" if streams == ["bm25"]
                      else "+".join(streams) if streams else "none")
    verdict = (ingest["status"] == 200 and not trailing_q and bool(citations) and has_action and names_asset)
    return {
        "scenario_id": "cip_supply_temp_low_SUBSTITUTE", "title": "CIP Skid Supply Temperature Low (SUBSTITUTE for pasteurizer — no pasteurizer in SimLab)",
        "asset": asset, "substitute_note": "SimLab's juice-bottling line has NO pasteurizer. This is the closest real process-temperature fault (CIP002). Hand-injected, not an A-F replayable scenario.",
        "question": q, "answer": reply, "citations": citations, "retrieved": retrieved,
        "abnormal": [{"tag": "supply_temp", "observed": 110.0, "normal_baseline": "140-170 F (CIP002 trips < 130 F)"}],
        "cache": cache, "ingest": ingest, "uns_path": uns, "uns_source": "direct_connection",
        "expected_root_cause": "Heater element failure / thermostat drift / inadequate hot-water supply (CIP002 Supply Temp Low)",
        "expected_actions": ["Check heater element circuit", "Verify thermostat setpoint", "Confirm hot-water supply pressure"],
        "expected_citations": ["cipskid01/fault_code_table.md", "cipskid01/plc_tag_description_sheet.md"],
        "expected_evidence_tags": [f"{uns}.process.supply_temp"],
        "retrieval_mode": retrieval_mode,
        "rubric": None,  # hand-injected substitute, NOT an A-F replayable scenario — no deterministic rubric
        "rubric_note": "No rubric grade: this is a hand-injected substitute, not a scenario with ground-truth in simlab/scenarios.py. Verdict uses heuristic checks + the cited CIP002 doc.",
        "checks": {"ingest_200": ingest["status"] == 200, "no_trailing_question": not trailing_q,
                   "has_citation": bool(citations), "names_asset": names_asset, "has_action": has_action},
        "verdict": "PASS" if verdict else "REVIEW",
        "langfuse": {"trace_name": "supervisor.process", "enabled_this_run": False, "trace_id_this_run": None},
    }


def main():
    targets = [
        (SCENARIOS["filler_underfill_low_bowl_pressure"], ["filler_bowl_pressure", "fill_level_oz", "underfill_reject_count"]),
        (SCENARIOS["capper_torque_fault"], ["cap_torque_inlb", "cap_torque_variance", "reject_count"]),
        (SCENARIOS["casepacker_jam_upstream_block"], ["jam_detected"]),
    ]
    results = []
    for scn, abn_keys in targets:
        print(f"=== running {scn.id} ===", flush=True)
        results.append(run_one(scn, abn_keys))
        print(f"    verdict: {results[-1]['verdict']}", flush=True)
    print("=== running cip_supply_temp_low_SUBSTITUTE ===", flush=True)
    results.append(run_cip_substitute())
    print(f"    verdict: {results[-1]['verdict']}", flush=True)

    assert_substitute_honest(results)  # fail loudly on a mislabeled substitute
    payload = {"metadata": build_metadata(), "results": results}
    validate_metadata(payload["metadata"])  # fail loudly if provenance is incomplete
    validate_results(results)
    out = pathlib.Path("tools/proof/results.json")
    out.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    md = payload["metadata"]
    print("wrote", out, "| verdicts:", [r["verdict"] for r in results])
    print(f"   git={md['git_sha'][:8] if md['git_sha'] else '?'} retrieval(filler)={results[0]['retrieval_mode']} "
          f"embedder_up={md['health']['embedder_ollama_reachable']} langfuse={md['health']['langfuse_enabled']}")


if __name__ == "__main__":
    if "--clean" in sys.argv:
        # remove the only hidden local state a rerun depends on (SQLite session db)
        for p in (_REPO / "proof_simlab.db", _REPO / "tools" / "proof" / "proof_simlab.db"):
            try:
                p.unlink(); print("cleaned", p)
            except FileNotFoundError:
                pass
    main()
