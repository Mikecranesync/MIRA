"""KB Growth Cron — runs every 30 min via crontab.

Reads one PDF from manual_queue.json, ingests via full_ingest_pipeline.py,
records the run in pipeline_runs (NeonDB), emits structured JSON logs.

Spec: docs/specs/kb-ingest-hardening-spec.md
Crontab entry (VPS):
  */30 * * * * cd /opt/mira && doppler run -- python3 \
    mira-crawler/cron/kb_growth_cron.py >> /var/log/kb_growth.log 2>&1
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

# pipeline_runs (DB-tracked observability) lives next to this file
_HERE = Path(__file__).parent.resolve()
sys.path.insert(0, str(_HERE))
from pipeline_runs import (  # noqa: E402  (path bootstrap above)
    open_run,
    close_run,
    reap_stuck_runs,
    PipelineRun,
)

# Reporting + notifications (optional — degrades gracefully)
_REPO_ROOT = _HERE.parent.parent
try:
    from mira_crawler.reporting.agent_report import AgentReport
    from mira_crawler.reporting.telegram_notify import notify as _tg_notify
    _REPORT_AVAILABLE = True
except ImportError:
    try:
        sys.path.insert(0, str(_REPO_ROOT))
        from mira_crawler.reporting.agent_report import AgentReport
        from mira_crawler.reporting.telegram_notify import notify as _tg_notify
        _REPORT_AVAILABLE = True
    except ImportError:
        _REPORT_AVAILABLE = False
        def _tg_notify(*_: object) -> bool: return False  # type: ignore[misc]

# ─── paths ────────────────────────────────────────────────────────────────────
_REPO = _HERE.parent.parent
QUEUE_FILE = _HERE / "manual_queue.json"
PIPELINE = _REPO / "mira-crawler" / "tasks" / "full_ingest_pipeline.py"
ALLOWLIST_FILE = _REPO / "mira-crawler" / "config" / "url_allowlist.yml"
LOG_FILE = Path("/var/log/kb_growth.log")

# ─── config ───────────────────────────────────────────────────────────────────
OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
DOCLING_URL = os.getenv("DOCLING_URL", "http://localhost:5001")
PIPELINE_TIMEOUT = int(os.getenv("KB_INGEST_TIMEOUT", "900"))
INGEST_ENABLED = os.getenv("KB_INGEST_ENABLED", "true").lower() != "false"


# ─── structured logging ───────────────────────────────────────────────────────


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def jlog(
    step: str,
    status: str,
    *,
    run: Optional[PipelineRun] = None,
    duration_ms: Optional[int] = None,
    error: Optional[str] = None,
    **fields: Any,
) -> None:
    """Emit one structured JSON log line. See spec §4.1."""
    record: dict[str, Any] = {
        "ts": _ts(),
        "step": step,
        "status": status,
    }
    if run is not None:
        record["run_id"] = run.id
        record["pdf_url"] = run.pdf_url
        if run.manufacturer:
            record["manufacturer"] = run.manufacturer
        if run.model:
            record["model"] = run.model
    if duration_ms is not None:
        record["duration_ms"] = duration_ms
    if error:
        record["error"] = error[:500]
    record.update(fields)
    print(json.dumps(record, default=str), flush=True)


# ─── queue ────────────────────────────────────────────────────────────────────


def load_queue() -> list[dict]:
    with open(QUEUE_FILE) as f:
        return json.load(f)


def save_queue(queue: list[dict]) -> None:
    with open(QUEUE_FILE, "w") as f:
        json.dump(queue, f, indent=2)


# ─── url allowlist ────────────────────────────────────────────────────────────


def _load_allowlist() -> Optional[set[str]]:
    """Read allowlist from YAML. Returns None if file missing (allow all — dev mode)."""
    if not ALLOWLIST_FILE.exists():
        return None
    try:
        import yaml  # type: ignore
        with open(ALLOWLIST_FILE) as f:
            data = yaml.safe_load(f) or {}
        hosts: set[str] = set()
        for key in ("oem_domains", "distributors", "public_libraries"):
            for h in data.get(key, []) or []:
                hosts.add(h.strip().lower())
        return hosts
    except Exception as exc:
        jlog("allowlist", "warning", error=f"failed to load: {exc}")
        return None


def _host_allowed(url: str, allowlist: Optional[set[str]]) -> bool:
    if allowlist is None:
        return True
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    if not host:
        return False
    # exact match or any suffix-match (e.g. 'cdn.foo.com' allowed by 'foo.com')
    if host in allowlist:
        return True
    return any(host.endswith("." + h) for h in allowlist)


# ─── preflight ────────────────────────────────────────────────────────────────


def _http_ok(url: str, timeout: float = 5.0) -> tuple[bool, str]:
    try:
        r = httpx.get(url, timeout=timeout)
        if r.status_code < 400:
            return True, f"{r.status_code}"
        return False, f"{r.status_code}"
    except Exception as exc:
        return False, type(exc).__name__


def preflight() -> bool:
    """Validate critical deps before any work. Spec §10.1."""
    t0 = time.monotonic()
    checks = [
        ("ollama", f"{OLLAMA_URL.rstrip('/')}/api/tags"),
        ("docling", f"{DOCLING_URL.rstrip('/')}/health"),
    ]
    all_ok = True
    for name, url in checks:
        ok, info = _http_ok(url)
        jlog(
            "preflight",
            "ok" if ok else "failed",
            check=name,
            url=url,
            result=info,
        )
        if not ok and name == "ollama":
            # Ollama is hard-required — embeddings will fail without it.
            all_ok = False

    # Reap any stuck `running` rows from earlier crashed runs.
    reaped = reap_stuck_runs(max_age_minutes=30)
    if reaped:
        jlog("preflight", "warning", check="reap", reaped=reaped)

    jlog(
        "preflight",
        "ok" if all_ok else "failed",
        check="summary",
        duration_ms=int((time.monotonic() - t0) * 1000),
    )
    return all_ok


# ─── pipeline subprocess ──────────────────────────────────────────────────────


def run_pipeline(entry: dict) -> tuple[bool, str, int]:
    """Run full_ingest_pipeline.py for one entry.
    Returns (success, output_tail, chunks_created)."""
    cmd = [
        sys.executable,
        str(PIPELINE),
        "--pdf-url", entry["url"],
        "--manufacturer", entry["manufacturer"],
        "--model", entry["model"],
        "--type", entry.get("type", "installation_manual"),
        "--no-quality-gate",
    ]
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=PIPELINE_TIMEOUT,
        env=env,
    )
    output = (result.stdout + result.stderr).strip()
    tail = "\n".join(output.splitlines()[-20:])

    # Best-effort: parse chunk count from full_ingest_pipeline output line
    # (e.g. "  kb_chunks: 47").
    chunks = 0
    for line in output.splitlines():
        if "kb_chunks" in line:
            for tok in line.split():
                if tok.isdigit():
                    chunks = int(tok)
                    break
    return result.returncode == 0, tail, chunks


# ─── main ─────────────────────────────────────────────────────────────────────


def main() -> int:
    jlog("cron", "start")

    if not INGEST_ENABLED:
        jlog("cron", "skipped", reason="KB_INGEST_ENABLED=false")
        return 0

    if not QUEUE_FILE.exists():
        jlog("cron", "failed", error=f"queue file not found: {QUEUE_FILE}")
        return 1

    if not PIPELINE.exists():
        jlog("cron", "failed", error=f"pipeline not found: {PIPELINE}")
        return 1

    if not preflight():
        # Open a run row for this failed preflight so heartbeat sees it.
        run = open_run(pdf_url="(preflight)", tenant_id=os.getenv("MIRA_TENANT_ID", "mike"))
        close_run(run, status="failed", step_failed="preflight",
                  error=f"OLLAMA_BASE_URL={OLLAMA_URL} unreachable")
        jlog("cron", "failed", error="preflight failed — see preflight log lines above")
        return 2

    queue = load_queue()
    pending_indices = [i for i, e in enumerate(queue) if e.get("status") == "pending"]

    if not pending_indices:
        done = sum(1 for e in queue if e.get("status") == "done")
        failed = sum(1 for e in queue if e.get("status") == "failed")
        jlog("cron", "idle", done=done, failed=failed, pending=0)
        return 0

    allowlist = _load_allowlist()

    idx = pending_indices[0]
    entry = queue[idx]
    url = entry["url"]

    if not _host_allowed(url, allowlist):
        entry["status"] = "dead"
        entry["failed_at"] = _ts()
        entry["error"] = "host not on URL allowlist"
        queue[idx] = entry
        save_queue(queue)
        run = open_run(
            pdf_url=url,
            manufacturer=entry["manufacturer"],
            model=entry["model"],
            doc_type=entry.get("type"),
        )
        close_run(run, status="failed", step_failed="allowlist",
                  error="host not on URL allowlist")
        jlog("allowlist", "rejected", run=run, host=urlparse(url).hostname)
        return 0

    run = open_run(
        pdf_url=url,
        manufacturer=entry["manufacturer"],
        model=entry["model"],
        doc_type=entry.get("type", "installation_manual"),
    )
    jlog("ingest", "start", run=run, queue_index=idx, queue_total=len(queue))

    t0 = time.monotonic()
    try:
        success, tail, chunks = run_pipeline(entry)
    except subprocess.TimeoutExpired:
        success = False
        tail = f"TIMEOUT after {PIPELINE_TIMEOUT}s"
        chunks = 0
    except Exception as exc:
        success = False
        tail = str(exc)
        chunks = 0
    duration_ms = int((time.monotonic() - t0) * 1000)

    if success:
        entry["status"] = "done"
        entry["done_at"] = _ts()
        entry["chunks_created"] = chunks
        close_run(run, status="ok", chunks_created=chunks)
        jlog("ingest", "ok", run=run, chunks=chunks, duration_ms=duration_ms)
    else:
        entry["status"] = "failed"
        entry["failed_at"] = _ts()
        entry["error"] = tail[-200:]
        close_run(
            run,
            status="failed",
            step_failed="pipeline",
            error=tail,
        )
        jlog("ingest", "failed", run=run, error=tail[-300:], duration_ms=duration_ms)

    queue[idx] = entry
    save_queue(queue)

    remaining = sum(1 for e in queue if e.get("status") == "pending")
    done = sum(1 for e in queue if e.get("status") == "done")
    failed = sum(1 for e in queue if e.get("status") == "failed")
    jlog("cron", "done", done=done, failed=failed, pending=remaining)

    _emit_report(entry, success, done, failed, remaining, chunks)
    return 0


def _emit_report(
    entry: dict,
    success: bool,
    done: int,
    failed: int,
    remaining: int,
    chunks: int,
) -> None:
    name = f"{entry['manufacturer']} {entry['model']}"

    try:
        if success:
            _tg_notify(
                "kb_growth",
                f"✅ Ingested *{name}* ({chunks} chunks)\n"
                f"Queue: {done} done · {failed} failed · {remaining} remaining",
            )
        else:
            err = (entry.get("error") or "unknown error")[:120]
            _tg_notify(
                "kb_growth",
                f"❌ Failed: *{name}*\n`{err}`\nWill retry next cycle",
            )
    except Exception as exc:
        jlog("notify", "failed", error=str(exc))

    if not _REPORT_AVAILABLE:
        return
    try:
        status_level = "ok" if success else "warning"
        report = (
            AgentReport("kb-growth-cron")
            .set_title("KB Growth Cron", name)
            .set_status(status_level)  # type: ignore[arg-type]
            .add_metric("Done", done, "PDFs", trend="up")
            .add_metric("Failed", failed, "PDFs", trend="flat" if failed == 0 else "down")
            .add_metric("Remaining", remaining, "PDFs")
            .add_metric("Chunks (this run)", chunks, "chunks")
        )
        if success:
            report.add_alert("ok", f"Ingested: {name} ({chunks} chunks)")
        else:
            report.add_alert(
                "warning",
                f"Failed: {name} — {(entry.get('error') or '')[:120]}",
            )
        if remaining > 0:
            report.add_action(f"Review {remaining} pending PDFs in manual_queue.json")
        if failed > 0:
            report.add_action(f"Investigate {failed} failed PDF(s) and re-queue or remove")
        report.save(telegram=False)
    except Exception as exc:
        jlog("report", "failed", error=str(exc))


if __name__ == "__main__":
    sys.exit(main())
