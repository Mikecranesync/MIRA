"""Changed-path lane selection and lane execution for autoeval.

select(): the always-on safety lane runs on every change, including docs-only ones.
A lane also runs when a changed path matches one of its triggers or one of its own
test files. A changed CODE path that matches no lane selects every lane (reason
"unmapped"), so an unknown path can never silently skip the suite. Docs-only changes
(*.md, docs/, wiki/) add nothing beyond the always lanes. Each reason is recorded
together with the paths that matched, so "selected" is never an unexplained claim.

run_lane(): executes each step and reads the pass/fail/skip COUNT from the output.
No count, or a zero pass count with no failure, is infra_error, never a pass.
"""

from __future__ import annotations

import importlib.util
import json
import os
import posixpath
import re
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LANES_PATH = REPO_ROOT / "evals" / "autoeval.lanes.json"
R2_PATH = REPO_ROOT / "tools" / "r2_signal_floor.py"
Runner = Callable[[list[str], str], tuple[int, str]]


@dataclass(frozen=True)
class Step:
    cwd: str
    runner: str
    files: tuple[str, ...]


@dataclass(frozen=True)
class Lane:
    name: str
    always: bool
    triggers: tuple[str, ...]
    steps: tuple[Step, ...]

    def all_triggers(self) -> tuple[str, ...]:
        own = [posixpath.normpath(posixpath.join(s.cwd, f)) for s in self.steps for f in s.files]
        return self.triggers + tuple(own)


def load_lanes(path: Path = LANES_PATH) -> list[Lane]:
    data = json.loads(Path(path).read_text())
    return [
        Lane(
            name=d["name"],
            always=bool(d["always"]),
            triggers=tuple(d["triggers"]),
            steps=tuple(Step(s["cwd"], s["runner"], tuple(s["files"])) for s in d["steps"]),
        )
        for d in data["lanes"]
    ]


def _matches(path: str, trigger: str) -> bool:
    return path.startswith(trigger) if trigger.endswith("/") else path == trigger


def is_docs_only(path: str) -> bool:
    return path.endswith(".md") or path.startswith(("docs/", "wiki/"))


def risk_classes(paths: list[str], r2_path: Path = R2_PATH) -> dict[str, str]:
    """r2 risk floor per path (R0 when no signal). Tags only: it never selects a lane."""
    spec = importlib.util.spec_from_file_location("autoeval_r2", r2_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["autoeval_r2"] = mod  # dataclasses resolve their module through sys.modules
    spec.loader.exec_module(mod)
    out = {p: "R0" for p in paths}
    for sig in mod.classify_paths(paths):
        out[sig.path] = max(out[sig.path], sig.floor)
    return out


@dataclass(frozen=True)
class Selection:
    selected: tuple[tuple[Lane, str, tuple[str, ...]], ...]  # (lane, reason, matched paths)
    unmapped: tuple[str, ...]
    risk: dict[str, str]


def select(
    changed: list[str], full: bool, lanes: list[Lane], reason_full: str = "full"
) -> Selection:
    risk = risk_classes(changed) if changed else {}
    if full:
        return Selection(tuple((ln, reason_full, ()) for ln in lanes), (), risk)
    code = [p for p in changed if not is_docs_only(p)]
    picked: list[tuple[Lane, str, tuple[str, ...]]] = []
    unmapped = [
        p for p in code if not any(_matches(p, t) for ln in lanes for t in ln.all_triggers())
    ]
    for ln in lanes:
        matched = tuple(p for p in changed if any(_matches(p, t) for t in ln.all_triggers()))
        if ln.always:
            picked.append((ln, "always", matched))
        elif matched:
            picked.append((ln, "trigger", matched))
        elif unmapped:
            picked.append((ln, "unmapped", tuple(unmapped)))
    return Selection(tuple(picked), tuple(unmapped), risk)


_PY_COUNT = re.compile(r"(\d+) (passed|failed|errors?|skipped)")
_VT_COUNT = re.compile(r"(\d+) (passed|failed|skipped|todo)")


def parse_counts(runner: str, output: str) -> dict[str, int]:
    """Pass/fail/error/skip counts from pytest or vitest output. Empty dict when none found."""
    counts: dict[str, int] = {}
    if runner == "pytest":
        lines = [ln for ln in output.splitlines() if _PY_COUNT.search(ln)]
        found = _PY_COUNT.findall(lines[-1]) if lines else []
    else:
        lines = re.findall(r"^\s*Tests\s+(.+)$", output, flags=re.MULTILINE)
        found = _VT_COUNT.findall(lines[-1]) if lines else []
    for num, kind in found:
        key = {"error": "errors", "errors": "errors", "todo": "skipped"}.get(kind, kind)
        counts[key] = counts.get(key, 0) + int(num)
    return counts


def judge_counts(counts: dict[str, int], rc: int) -> str:
    """pass | fail | infra_error. A missing or zero pass count is never a pass."""
    if counts.get("failed", 0) or counts.get("errors", 0):
        return "fail"
    if counts.get("passed", 0) == 0 or rc != 0:
        return "infra_error"
    return "pass"


def subprocess_runner(argv: list[str], cwd: str) -> tuple[int, str]:
    proc = subprocess.run(
        argv,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
        timeout=1800,
        env={**os.environ, "CI": "1"},
    )
    return proc.returncode, proc.stdout + proc.stderr


@dataclass(frozen=True)
class LaneResult:
    name: str
    status: str
    steps: tuple[dict, ...]


def run_lane(lane: Lane, repo: Path, runner: Runner = subprocess_runner) -> LaneResult:
    steps, statuses = [], []
    for st in lane.steps:
        cwd = str(Path(repo) / st.cwd)
        if st.runner == "pytest":
            argv = ["python3.12", "-m", "pytest", *st.files, "-q", "-p", "no:cacheprovider"]
        else:
            # --no-install: never fetch from the registry; a missing install is infra_error
            argv = ["npx", "--no-install", "vitest", "run", *st.files]
        rc, out = runner(argv, cwd)
        counts = parse_counts(st.runner, out)
        status = judge_counts(counts, rc)
        statuses.append(status)
        steps.append(
            {
                "cwd": st.cwd,
                "runner": st.runner,
                "rc": rc,
                "counts": counts,
                "status": status,
                "tail": out[-600:],
            }
        )
    order = ("fail", "infra_error", "pass")
    overall = next((s for s in order if s in statuses), "infra_error")
    return LaneResult(lane.name, overall, tuple(steps))
