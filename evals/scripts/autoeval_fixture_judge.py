"""Second judge lane: the existing tests/eval/judge.py rubric over imported fixture answers.

The rubric is loaded by path, fresh per run, and its _JUDGE_PROMPT is rendered with the same
three defaults that Judge.grade() uses. Every judge call goes through autoeval_judge.judge_call,
so the verdict cache, the dry-run rule, the ledger, the truncation rule and the CASE provenance
are exactly those of the release-gate lane. Verdicts are parsed with judge.py's own
_parse_json and _validate_result.

Judge.__init__ is never called: it reads API keys from the environment. The helpers are taken
from an instance created with __new__, which runs no __init__ and reads no environment.
A paid reply that does not parse is stored as text by judge_call, so it is recalled as
unparseable and never re-billed.

Optional record field `retrieved_passages`: a list of {doc_id, page, text}, the real retrieved
passages for the answer. When absent, rag_context is the rubric's no-coverage placeholder.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import autoeval_judge as jd

RUBRIC_PATH = jd.REPO_ROOT / "tests" / "eval" / "judge.py"
NO_KB = "(no KB chunks retrieved — model had no KB coverage)"
NO_QUESTION = "(none)"
NO_ANSWER = "(empty response)"


def load_rubric(path: Path = RUBRIC_PATH):
    """Load judge.py by path, fresh per run. Registered in sys.modules first: its dataclasses need it."""
    name = f"autoeval_rubric_{uuid.uuid4().hex[:8]}"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def helpers(rubric):
    """An uninitialised Judge: its parse and validate helpers, with no environment read."""
    return rubric.Judge.__new__(rubric.Judge)


def render_passages(passages: list[dict]) -> str:
    return "\n\n".join(
        f"[{p.get('doc_id', '?')} p.{p.get('page', '?')}] {p.get('text', '')}" for p in passages
    )


def render_prompt(rubric, record: dict) -> str:
    turns = record["turns"]
    last = turns[-1]
    history = [
        {"user_msg": t.get("question", ""), "fsm_state": t.get("fsm_state")} for t in turns[:-1]
    ]
    passages = record.get("retrieved_passages") or []
    return rubric._JUDGE_PROMPT.format(
        conversation_history_section=rubric.Judge._build_history_section(history),
        user_question=last.get("question") or NO_QUESTION,
        rag_context=render_passages(passages) or NO_KB,
        response_text=last.get("answer") or NO_ANSWER,
    )


def parse_verdict(h, text: str) -> tuple[dict | None, dict | None, str | None]:
    try:
        data = h._parse_json(text)
        scores, notes = h._validate_result(data)
    except (ValueError, KeyError, TypeError) as e:
        return None, None, f"{type(e).__name__}: {e}"
    return scores, notes, None


def summarise(rows: list[dict], counts: dict[str, int], dimensions: tuple[str, ...]) -> dict:
    scored = [r for r in rows if r["status"] == "scored"]
    statuses: dict[str, int] = {}
    for r in rows:
        statuses[r["status"]] = statuses.get(r["status"], 0) + 1
    means = {
        d: round(sum(r["scores"][d] for r in scored) / len(scored), 3) for d in dimensions if scored
    }
    return {
        "cases": len(rows),
        "api": counts.get("api", 0),
        "counts": dict(sorted(counts.items())),
        "statuses": dict(sorted(statuses.items())),
        "scored": len(scored),
        "unscored": sorted(r["case_id"] for r in rows if r["status"] != "scored"),
        "mean_scores": means if scored else {},
    }


@dataclass
class FixtureRun:
    set_id: str
    model: str
    counts: dict[str, int]
    summary: dict[str, Any]
    rows: list[dict]


def run_fixture(set_dir: Path, out_dir: Path, env: jd.JudgeEnv, rubric=None) -> FixtureRun:
    """Judge every technician/*.json of one transcript set with the rubric in judge.py."""
    rubric = rubric or load_rubric()
    h = helpers(rubric)
    set_dir, out_dir = Path(set_dir), Path(out_dir)
    manifest = json.loads((set_dir / "technician" / "_manifest.json").read_text())
    set_id = set_dir.name
    rows: list[dict] = []
    for path in sorted((set_dir / "technician").glob("*.json")):
        if path.name.startswith("_"):
            continue
        record = json.loads(path.read_text())
        case_id = str(record["case_id"])
        answer = record["turns"][-1].get("answer", "") or ""
        ctx = jd.CaseCtx(
            case_id,
            set_id,
            jd.sha256_text(answer),
            str(manifest.get("sha") or ""),
            str(manifest.get("base_url") or ""),
        )
        prompt = render_prompt(rubric, record)
        token = jd.CASE.set(ctx)
        try:
            text, source, key = jd.judge_call(prompt, env)
        finally:
            jd.CASE.reset(token)
        env.counts[source] = env.counts.get(source, 0) + 1
        row: dict[str, Any] = {"case_id": case_id, "source": source, "cache_key": key}
        if text is None:
            row.update(status=source, scores=None, notes=None, error=None)
        else:
            scores, notes, err = parse_verdict(h, text)
            status = "scored" if err is None else "unparseable"
            row.update(status=status, scores=scores, notes=notes, error=err)
        rows.append(row)
    out_dir.mkdir(parents=True, exist_ok=True)
    for row in rows:
        (out_dir / f"{row['case_id']}.json").write_text(
            json.dumps(row, indent=2, sort_keys=True) + "\n"
        )
    summary = summarise(rows, env.counts, tuple(rubric.DIMENSIONS))
    (out_dir / "_summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    return FixtureRun(set_id, env.model, dict(env.counts), summary, rows)
