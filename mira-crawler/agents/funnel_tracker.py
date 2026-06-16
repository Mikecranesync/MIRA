"""Funnel Tracker — daily probe + weekly "FactoryLM Pulse" report.

What it pulls
-------------
* **HubSpot** (REST, `HUBSPOT_API_KEY` / `HUBSPOT_ACCESS_TOKEN`):
    - companies grouped by lifecycle stage
    - new leads in the last 7 days
    - open deals + total value
* **NeonDB** scan funnel (`scan_queue` table or `manual_queue.json` fallback):
    - scans this week, KB hit rate, manuals queued
* **Telegram bot** (NeonDB `bot_messages` if present, else docker log scan):
    - messages, unique users, last 7 days
* **Heartbeat** (`system_health_log`):
    - uptime % over the last 7 days

Outputs
-------
* `docs/reports/pulse/YYYY-Www.md` — checked into the repo
* Telegram push (`weekly` mode only) under the `system` agent

Usage
-----
    python3 mira-crawler/agents/funnel_tracker.py            # daily snapshot
    python3 mira-crawler/agents/funnel_tracker.py --weekly   # full pulse report
    python3 mira-crawler/agents/funnel_tracker.py --dry-run  # print, don't notify or save

Failure mode: every fetcher returns a partial result on error so a missing
HubSpot token doesn't break the whole pulse.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] funnel: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("funnel_tracker")


def _load_notify():
    try:
        from mira_crawler.reporting.telegram_notify import notify as _n  # type: ignore

        return _n
    except ImportError:
        pass
    import importlib.util

    tn_path = Path(__file__).resolve().parent.parent / "reporting" / "telegram_notify.py"
    if tn_path.exists():
        spec = importlib.util.spec_from_file_location("telegram_notify", tn_path)
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod.notify

    def _stub(agent_key: str, message: str, **_) -> bool:
        print(f"[{agent_key}] {message}")
        return True

    return _stub


notify = _load_notify()


HUBSPOT_BASE = "https://api.hubapi.com"
LIFECYCLE_ORDER = [
    "lead",
    "marketingqualifiedlead",
    "salesqualifiedlead",
    "opportunity",
    "customer",
    "evangelist",
    "other",
]


# ── Data shapes ──────────────────────────────────────────────────────────────


@dataclass
class FunnelSnapshot:
    pipeline: dict[str, Any] = field(default_factory=dict)
    product: dict[str, Any] = field(default_factory=dict)
    bot: dict[str, Any] = field(default_factory=dict)
    health: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    ts: str = ""


# ── HubSpot fetchers ─────────────────────────────────────────────────────────


def _hubspot_token() -> str:
    return os.environ.get("HUBSPOT_ACCESS_TOKEN") or os.environ.get("HUBSPOT_API_KEY", "")


def fetch_hubspot() -> tuple[dict[str, Any], list[str]]:
    """Return pipeline-shaped dict + list of errors."""
    errors: list[str] = []
    out: dict[str, Any] = {
        "total_companies": 0,
        "by_stage": {},
        "new_leads_7d": 0,
        "open_deals": 0,
        "open_deal_value": 0.0,
    }
    token = _hubspot_token()
    if not token:
        errors.append("HUBSPOT token not set — pipeline metrics skipped")
        return out, errors

    try:
        import httpx
    except ImportError:
        errors.append("httpx not installed")
        return out, errors

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        with httpx.Client(timeout=30, headers=headers) as client:
            # Companies count + lifecycle stage breakdown via search
            for stage in LIFECYCLE_ORDER:
                resp = client.post(
                    f"{HUBSPOT_BASE}/crm/v3/objects/companies/search",
                    json={
                        "filterGroups": [
                            {
                                "filters": [
                                    {
                                        "propertyName": "lifecyclestage",
                                        "operator": "EQ",
                                        "value": stage,
                                    }
                                ]
                            }
                        ],
                        "limit": 1,  # we just want the total
                        "properties": ["name"],
                    },
                )
                if resp.status_code == 200:
                    total = resp.json().get("total", 0)
                    out["by_stage"][stage] = total
                    out["total_companies"] += total

            # New leads in last 7d (createdate >= cutoff)
            resp = client.post(
                f"{HUBSPOT_BASE}/crm/v3/objects/companies/search",
                json={
                    "filterGroups": [
                        {
                            "filters": [
                                {"propertyName": "createdate", "operator": "GTE", "value": cutoff}
                            ]
                        }
                    ],
                    "limit": 1,
                    "properties": ["name"],
                },
            )
            if resp.status_code == 200:
                out["new_leads_7d"] = resp.json().get("total", 0)

            # Open deals + amount sum (paginate up to 200 — enough for early-stage)
            resp = client.post(
                f"{HUBSPOT_BASE}/crm/v3/objects/deals/search",
                json={
                    "filterGroups": [
                        {
                            "filters": [
                                {
                                    "propertyName": "dealstage",
                                    "operator": "NEQ",
                                    "value": "closedwon",
                                },
                                {
                                    "propertyName": "dealstage",
                                    "operator": "NEQ",
                                    "value": "closedlost",
                                },
                            ]
                        }
                    ],
                    "limit": 100,
                    "properties": ["amount", "dealname", "dealstage"],
                },
            )
            if resp.status_code == 200:
                results = resp.json().get("results", [])
                out["open_deals"] = len(results)
                out["open_deal_value"] = sum(
                    float(r.get("properties", {}).get("amount") or 0) for r in results
                )
            else:
                errors.append(f"deals search HTTP {resp.status_code}")

    except Exception as exc:  # noqa: BLE001
        errors.append(f"HubSpot fetch failed: {exc}")
    return out, errors


# ── Scan funnel ──────────────────────────────────────────────────────────────


def fetch_scan_funnel() -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    out: dict[str, Any] = {
        "scans_7d": 0,
        "kb_hits": 0,
        "kb_misses": 0,
        "kb_hit_rate": 0.0,
        "manuals_queued": 0,
    }
    url = os.environ.get("NEON_DATABASE_URL", "")
    if url:
        try:
            from sqlalchemy import create_engine, text
            from sqlalchemy.pool import NullPool

            engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
            with engine.connect() as conn:
                # Best-effort: tolerate missing tables.
                try:
                    row = conn.execute(
                        text(
                            "SELECT COUNT(*) FROM scan_queue "
                            "WHERE created_at >= NOW() - INTERVAL '7 days'"
                        )
                    ).first()
                    out["scans_7d"] = int(row[0]) if row else 0
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"scan_queue 7d: {exc}".replace("\n", " ")[:120])

                try:
                    row = conn.execute(
                        text(
                            "SELECT "
                            "  COUNT(*) FILTER (WHERE matched_kb = TRUE) as hits,"
                            "  COUNT(*) FILTER (WHERE matched_kb = FALSE) as misses "
                            "FROM scan_queue "
                            "WHERE created_at >= NOW() - INTERVAL '7 days'"
                        )
                    ).first()
                    if row:
                        out["kb_hits"] = int(row[0] or 0)
                        out["kb_misses"] = int(row[1] or 0)
                        total = out["kb_hits"] + out["kb_misses"]
                        out["kb_hit_rate"] = (
                            round(100 * out["kb_hits"] / total, 1) if total else 0.0
                        )
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"scan_queue hit-rate: {exc}".replace("\n", " ")[:120])
        except Exception as exc:  # noqa: BLE001
            errors.append(f"NeonDB scan funnel: {exc}")
    else:
        errors.append("NEON_DATABASE_URL not set — scan funnel skipped")

    # manuals_queued: read manual_queue.json
    for p in (
        Path("/opt/mira/mira-crawler/cron/manual_queue.json"),
        Path("mira-crawler/cron/manual_queue.json"),
        Path("/opt/mira/manual_queue.json"),
    ):
        if p.exists():
            try:
                queue = json.loads(p.read_text())
                if isinstance(queue, list):
                    out["manuals_queued"] = sum(
                        1 for item in queue if (item.get("status") or "queued") == "queued"
                    )
                break
            except Exception as exc:  # noqa: BLE001
                errors.append(f"manual_queue.json parse: {exc}")
    return out, errors


# ── Telegram bot stats ───────────────────────────────────────────────────────


def fetch_bot_stats() -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    out: dict[str, Any] = {"messages_7d": 0, "unique_users_7d": 0, "source": "unknown"}

    # Try NeonDB first.
    url = os.environ.get("NEON_DATABASE_URL", "")
    if url:
        try:
            from sqlalchemy import create_engine, text
            from sqlalchemy.pool import NullPool

            engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
            with engine.connect() as conn:
                try:
                    row = conn.execute(
                        text(
                            "SELECT COUNT(*), COUNT(DISTINCT user_id) "
                            "FROM bot_messages "
                            "WHERE created_at >= NOW() - INTERVAL '7 days'"
                        )
                    ).first()
                    if row:
                        out["messages_7d"] = int(row[0] or 0)
                        out["unique_users_7d"] = int(row[1] or 0)
                        out["source"] = "neondb.bot_messages"
                        return out, errors
                except Exception:  # noqa: BLE001
                    pass  # table may not exist — fall through
        except Exception as exc:  # noqa: BLE001
            errors.append(f"bot stats NeonDB: {exc}")

    # Fallback: docker logs grep (rough — uses message=… or User= patterns)
    try:
        proc = subprocess.run(
            ["docker", "logs", "--since", "168h", "mira-bot-telegram"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if proc.returncode == 0:
            log = (proc.stdout + proc.stderr).lower()
            out["messages_7d"] = log.count("update_id")  # heuristic
            out["source"] = "docker logs (heuristic)"
        else:
            errors.append(f"docker logs rc={proc.returncode}")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"bot stats logs: {exc}")
    return out, errors


# ── Health uptime ────────────────────────────────────────────────────────────


def fetch_uptime() -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    out: dict[str, Any] = {"uptime_pct_7d": 0.0, "samples": 0}
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        errors.append("NEON_DATABASE_URL not set — uptime skipped")
        return out, errors
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
        with engine.connect() as conn:
            try:
                row = conn.execute(
                    text(
                        "SELECT "
                        "  COUNT(*) FILTER (WHERE score IS NOT NULL),"
                        "  AVG(score) FILTER (WHERE score IS NOT NULL) "
                        "FROM system_health_log "
                        "WHERE ts >= NOW() - INTERVAL '7 days' "
                        "  AND category != 'heal'"
                    )
                ).first()
                if row:
                    out["samples"] = int(row[0] or 0)
                    out["uptime_pct_7d"] = round(float(row[1] or 0), 1)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"system_health_log: {exc}".replace("\n", " ")[:120])
    except Exception as exc:  # noqa: BLE001
        errors.append(f"uptime fetch: {exc}")
    return out, errors


# ── Aggregate ────────────────────────────────────────────────────────────────


def collect() -> FunnelSnapshot:
    snap = FunnelSnapshot(ts=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    snap.pipeline, errs = fetch_hubspot()
    snap.errors.extend(errs)
    snap.product, errs = fetch_scan_funnel()
    snap.errors.extend(errs)
    snap.bot, errs = fetch_bot_stats()
    snap.errors.extend(errs)
    snap.health, errs = fetch_uptime()
    snap.errors.extend(errs)
    return snap


# ── Reporting ────────────────────────────────────────────────────────────────


def render_pulse(snap: FunnelSnapshot, week_label: str) -> str:
    p, prod, bot, health = snap.pipeline, snap.product, snap.bot, snap.health

    stage_line = (
        " → ".join(
            f"{p.get('by_stage', {}).get(s, 0)} {s}"
            for s in LIFECYCLE_ORDER
            if p.get("by_stage", {}).get(s)
        )
        or "_no pipeline data_"
    )

    hit_rate = prod.get("kb_hit_rate", 0.0)
    uptime = health.get("uptime_pct_7d", 0.0)

    md = [
        f"# FactoryLM Pulse — {week_label}",
        f"\n_Generated {snap.ts}_",
        "",
        "## Pipeline (HubSpot)",
        f"- **Total companies:** {p.get('total_companies', 0)}",
        f"- **By stage:** {stage_line}",
        f"- **New leads (7d):** {p.get('new_leads_7d', 0)}",
        f"- **Open deals:** {p.get('open_deals', 0)} — ${p.get('open_deal_value', 0):,.0f}",
        "",
        "## Product (Scan funnel)",
        f"- **Scans (7d):** {prod.get('scans_7d', 0)}",
        f"- **KB hit rate:** {hit_rate}%  ({prod.get('kb_hits', 0)} hits / {prod.get('kb_misses', 0)} misses)",
        f"- **Manuals queued:** {prod.get('manuals_queued', 0)}",
        "",
        "## Bot (Telegram)",
        f"- **Messages (7d):** {bot.get('messages_7d', 0)}",
        f"- **Unique users (7d):** {bot.get('unique_users_7d', 0)}",
        f"- **Source:** {bot.get('source', 'unknown')}",
        "",
        "## Health",
        f"- **7-day uptime score:** {uptime}/100",
        f"- **Samples:** {health.get('samples', 0)}",
        "",
    ]
    if snap.errors:
        md.append("## Collection errors\n")
        for e in snap.errors:
            md.append(f"- _{e}_")
        md.append("")
    md.append("---\n_Generated by `mira-crawler/agents/funnel_tracker.py`_")
    return "\n".join(md)


def render_telegram(snap: FunnelSnapshot, week_label: str) -> str:
    p, prod, bot, health = snap.pipeline, snap.product, snap.bot, snap.health
    return (
        f"*FactoryLM Pulse — {week_label}*\n\n"
        f"*Pipeline:* {p.get('total_companies', 0)} companies · "
        f"{p.get('new_leads_7d', 0)} new (7d) · "
        f"{p.get('open_deals', 0)} open deals (${p.get('open_deal_value', 0):,.0f})\n"
        f"*Product:* {prod.get('scans_7d', 0)} scans · "
        f"{prod.get('kb_hit_rate', 0)}% KB hit · "
        f"{prod.get('manuals_queued', 0)} queued\n"
        f"*Bot:* {bot.get('messages_7d', 0)} msgs · "
        f"{bot.get('unique_users_7d', 0)} users\n"
        f"*Health:* {health.get('uptime_pct_7d', 0)}/100 (7d)"
    )


def save_pulse(content: str, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    today = datetime.now(timezone.utc)
    iso_year, iso_week, _ = today.isocalendar()
    fname = out_dir / f"{iso_year}-W{iso_week:02d}.md"
    fname.write_text(content, encoding="utf-8")
    return fname


# ── Entry point ──────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Daily/weekly funnel tracker")
    parser.add_argument(
        "--weekly", action="store_true", help="Generate the full pulse report (and Telegram push)"
    )
    parser.add_argument("--out-dir", default="docs/reports/pulse")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--json", action="store_true", help="Print snapshot JSON instead of human report"
    )
    args = parser.parse_args(argv)

    snap = collect()

    today = datetime.now(timezone.utc)
    iso_year, iso_week, _ = today.isocalendar()
    week_label = f"{iso_year}-W{iso_week:02d}"

    if args.json:
        from dataclasses import asdict

        print(json.dumps(asdict(snap), indent=2))
        return 0

    pulse_md = render_pulse(snap, week_label)

    if args.dry_run:
        print(pulse_md)
        print("\n---\nTelegram preview:\n")
        print(render_telegram(snap, week_label))
        return 0

    # Save pulse on every run — daily snapshot overwrites the same week file,
    # weekly run is the canonical close.
    out_dir = Path(args.out_dir).resolve()
    saved = save_pulse(pulse_md, out_dir)
    logger.info("saved %s", saved)

    if args.weekly:
        notify("system", render_telegram(snap, week_label))
    return 0


if __name__ == "__main__":
    sys.exit(main())
