"""Helpers for the autoeval CLI: keys, budget configs, lanes, judging, spend and alert delivery.

Imported by autoeval.py. Nothing here reads a secret except KeyOnce, which fetches the paid key
only when a real paid call is about to be made.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

import autoeval_budget as ab
import autoeval_judge as jd
import autoeval_report as rp
import autoeval_select as sel

REPO = Path(__file__).resolve().parents[2]
MONTH_DAYS = 30
CALL_REASONS = ("recall_hit", "recall_error")


class KeyOnce:
    """Fetches the key from Doppler at the first real paid call only. Never printed."""

    def __init__(self, secret: str) -> None:
        self.secret, self.fetches, self._key = secret, 0, None

    def __call__(self) -> str:
        if self._key is None:
            if not self.secret:
                raise ab.BudgetStop("STOP: no key secret configured for paid mode")
            self.fetches += 1
            r = subprocess.run(
                [
                    "doppler",
                    "secrets",
                    "get",
                    self.secret,
                    "--plain",
                    "-p",
                    "factorylm",
                    "-c",
                    "dev",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            key = r.stdout.strip()
            if r.returncode != 0 or not key.startswith("sk-ant-"):
                raise ab.BudgetStop(f"STOP: Doppler secret {self.secret} missing or malformed")
            self._key = key
        return self._key


def _no_key() -> str:
    raise ab.BudgetStop("STOP: a key was requested outside paid mode")


def dry_config(state: Path) -> ab.BudgetConfig:
    return ab.BudgetConfig(
        total_cap_usd=0.0,
        daily_cap_usd=0.0,
        paid_not_after="",
        expect_org="",
        sentinel=state / "STOP",
    )


def paid_config(state: Path) -> tuple[ab.BudgetConfig, str]:
    p = state / "paid.json"
    if not p.exists():
        raise SystemExit(f"paid mode needs {p} (caps, paid_not_after, expect_org, key_secret)")
    d = json.loads(p.read_text())
    prices = {
        m: ab.ModelPrice(v["in_per_mtok"], v["out_per_mtok"], v["max_tokens"], v.get("params", {}))
        for m, v in d.get("prices", {}).items()
    } or dict(ab.DEFAULT_PRICES)
    cfg = ab.BudgetConfig(
        total_cap_usd=float(d["total_cap_usd"]),
        daily_cap_usd=float(d["daily_cap_usd"]),
        paid_not_after=d["paid_not_after"],
        expect_org=d["expect_org"],
        sentinel=state / "STOP",
        spent_before_usd=float(d.get("spent_before_usd", 0.0)),
        prices=prices,
    )
    return cfg, d.get("key_secret", "ANTHROPIC_API_KEY")


def git(args: list[str], repo: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
    ).stdout.strip()


def _run_id() -> str:
    """Sorts chronologically by name (second, then nanoseconds), so the newest run is last."""
    ns = time.time_ns()
    return time.strftime("%Y%m%dT%H%M%S", time.gmtime(ns // 1_000_000_000)) + (
        f"{ns % 1_000_000_000:09d}Z-" + uuid.uuid4().hex[:6]
    )


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _lanes(args, repo: Path, state: Path, head: str, runner) -> dict[str, Any]:
    if args.skip_lanes:
        return {"skipped": True, "results": [], "reason": "--skip-lanes"}
    st_file = state / "state.json"
    last = json.loads(st_file.read_text()).get("last_ok_sha") if st_file.exists() else None
    full, reason, changed = bool(args.full), "full", []
    if not full and not last:
        full, reason = True, "no_state"
    elif not full:
        try:
            changed = git(["diff", "--name-only", f"{last}..HEAD"], repo).splitlines()
        except subprocess.CalledProcessError:
            full, reason = True, "base_unknown"
    lanes = sel.load_lanes(repo / "evals" / "autoeval.lanes.json")
    chosen = sel.select(changed, full=full, lanes=lanes, reason_full=reason)
    results = []
    for lane, why, matched in chosen.selected:
        res = sel.run_lane(lane, repo, runner)
        results.append(
            {
                "name": lane.name,
                "status": res.status,
                "reason": why,
                "matched": list(matched)[:25],
                "steps": list(res.steps),
            }
        )
    if results and all(r["status"] == "pass" for r in results):
        st_file.write_text(json.dumps({"last_ok_sha": head}, indent=2))
    return {
        "skipped": False,
        "results": results,
        "full": full,
        "reason": reason,
        "changed": len(changed),
        "unmapped": list(chosen.unmapped),
        "risk": chosen.risk,
    }


def _sets(args, results_root: Path) -> list[Path]:
    if args.sets:
        return [Path(s) if Path(s).is_dir() else results_root / s for s in args.sets]
    return sorted(
        p for p in results_root.iterdir() if (p / "technician" / "_manifest.json").exists()
    )


_META = ("prompt_sha256", "answer_sha256", "origin", "tokens_in", "tokens_out", "usd", "request_id")


def _cache_file(cache, key: str) -> str:
    derived = cache.cas.derived_key(key, jd.CACHE_STAGE, jd.VERSION)
    return str(cache.cas._path("derived", derived).relative_to(cache.cas.root.parent))


def _verdict_rows(sr, cache, entry: dict, head: str) -> list[dict]:
    """One stored row per judged case: score, plus what produced it and where the evidence is."""
    scored = {r["case_id"]: r for r in sr.rows}
    rows = []
    for case_id, reason, key in sr.trace:
        hit = cache.get(key) or {}
        rows.append(
            {
                "set": sr.set_id,
                "model": sr.model,
                "transcript_sha": entry["sha"],
                "base_url": entry["base_url"],
                "runner_sha": head,
                "source": reason,
                "cache_key": key,
                "cache_file": _cache_file(cache, key),
                "judged_at": hit.get("created_at"),
                **{k: hit.get(k) for k in _META},
                "evidence": f"judge/{sr.set_id}__{sr.model}/scores/{case_id}.json",
                **scored.get(case_id, {"case_id": case_id, "unscored": True}),
            }
        )
    return rows


def _judge_all(
    args, state, run_dir, cfg, ledger, cache, keyf, client, head, mode
) -> dict[str, Any]:
    out: dict[str, Any] = {"sets": [], "rows": [], "error": None, "partial": {}}
    try:
        for set_dir in _sets(args, Path(args.results_root)):
            man = json.loads((set_dir / "technician" / "_manifest.json").read_text())
            entry = {
                "set": set_dir.name,
                "sha": man.get("sha"),
                "base_url": man.get("base_url"),
                "models": {},
            }
            out["sets"].append(entry)  # recorded first: a stop mid-set keeps what was judged
            for model in args.models:
                env = jd.JudgeEnv(
                    mode=mode,
                    model=model,
                    cache=cache,
                    cfg=cfg,
                    ledger=ledger,
                    key_provider=keyf,
                    runner_sha=head,
                    client=client,
                )
                out["partial"] = env.counts  # read only if run_set is stopped part-way
                fresh = run_dir / "judge" / f"{set_dir.name}__{model}"
                sr = jd.run_set(set_dir, fresh, env, judge_path=jd.JUDGE_PATH)
                # Failure details must come from THIS judge run's scores, not the
                # input set's archived ones (Codex r1 F5 on #5569); the input
                # manifest is copied across as provenance only.
                if (set_dir / "manifest.json").exists() and not (fresh / "manifest.json").exists():
                    shutil.copy2(set_dir / "manifest.json", fresh / "manifest.json")
                out["partial"] = {}
                entry["models"][model] = {
                    "summary": sr.summary,
                    "dangerous": sr.summary.get("dangerous_cases", []),
                    "unscored": sr.summary.get("unscored", []),
                    "counts": sr.counts,
                    "rc": sr.rc,
                    "paid_required_usd": sr.paid_required_usd,
                    "gate": rp.gate_text(fresh, sr.summary),
                }
                out["rows"] += _verdict_rows(sr, cache, entry, head)
    except ab.BudgetStop as e:
        out["error"] = f"{e.code if e.code else e}"
    except Exception as e:  # runner failure is an alert, never a silent pass
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def _spend(args, ledger, cfg, before: tuple[float, float], calls_api: int, paid_req: float):
    day = ledger.today()
    total, today = ledger.spent_total(), ledger.spent_day(day)
    settled = [r for r in ledger.rows() if r["t"] == "settle" and r.get("status") == 200]
    avg = sum(float(r["usd"]) for r in settled) / len(settled) if settled else None
    monthly = avg * calls_api * MONTH_DAYS if (avg is not None and calls_api) else None
    crossings = [
        {"bucket": "total", "pct": p}
        for p in ab.threshold_crossings(before[0], total, cfg.total_cap_usd)
    ]
    crossings += [
        {"bucket": f"day:{day}", "pct": p}
        for p in ab.threshold_crossings(before[1], today, cfg.daily_cap_usd)
    ]
    spend = {
        "today_usd": today,
        "total_usd": total,
        "daily_cap_usd": cfg.daily_cap_usd if args.paid else None,
        "total_cap_usd": cfg.total_cap_usd if args.paid else None,
        "remaining_usd": (cfg.total_cap_usd - total) if args.paid else None,
        "paid_required_worst_usd": paid_req,
        "paid_calls": len(settled),
        "avg_usd_per_paid_call": avg,
        "monthly_estimate_usd": monthly,
        "total_settled_usd": sum(float(r["usd"]) for r in settled),
    }
    return spend, crossings


def _send(fired: list[dict]) -> bool:
    spec = importlib.util.spec_from_file_location(
        "autoeval_telegram", REPO / "mira-crawler" / "reporting" / "telegram_notify.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    text = "\n".join(f"autoeval {a['kind']}: {a['message']}" for a in fired)
    return bool(mod.notify("benchmark", text))


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
