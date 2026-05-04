"""Session analyzer — grades completed sessions and generates eval fixtures.

Called by tests/eval/analyze_sessions.py after a session goes quiet for 10 min.
Imports judge.py from the eval suite (run from repo root via cron, so sys.path
includes tests/eval/).
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

logger = logging.getLogger("mira-session-analyzer")

SCORE_THRESHOLD = 0.80
MIN_TURNS = 2

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_AUTO_FIXTURES_DIR = _REPO_ROOT / "tests" / "eval" / "fixtures" / "auto"
_MIRA_VERSION = (
    (_REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if (_REPO_ROOT / "VERSION").exists()
    else "unknown"
)


class SessionAnalyzer:
    def __init__(self) -> None:
        import sys

        # Append (not insert at 0) — prevents mira-bots/email/ from shadowing stdlib email
        if str(_REPO_ROOT) not in sys.path:
            sys.path.append(str(_REPO_ROOT))
        from tests.eval.judge import Judge  # type: ignore[import]

        self._judge = Judge()

    def analyze(self, chat_id: str, turns: list[dict]) -> dict:
        """Grade a session. Returns dict with grades, overall, fixture_path, category."""
        diagnostic_turns = [t for t in turns if t.get("type") != "feedback"]
        feedback_turns = [t for t in turns if t.get("type") == "feedback"]

        if len(diagnostic_turns) < MIN_TURNS:
            return {"skip": True, "reason": "too_few_turns"}

        grades: dict[str, float] = {}
        grades["safety_compliance"] = self._grade_safety(diagnostic_turns)
        grades["no_json_leak"] = self._grade_no_json_leak(diagnostic_turns)
        grades["latency_ok"] = self._grade_latency(diagnostic_turns)
        grades["fsm_progression"] = self._grade_fsm_progression(diagnostic_turns)

        llm_grades = self._grade_with_judge(diagnostic_turns)
        grades.update(llm_grades)

        overall = sum(grades.values()) / len(grades)

        has_negative_feedback = any(t.get("feedback_rating") == "negative" for t in feedback_turns)

        fixture = self._generate_fixture(chat_id, diagnostic_turns, grades, overall)

        if overall < SCORE_THRESHOLD or has_negative_feedback:
            fixture_path = self._save_fixture(fixture, category="regression")
            self._alert(chat_id, overall, grades, diagnostic_turns, fixture_path)
            self._try_github_issue(chat_id, overall, grades, diagnostic_turns, fixture_path)
            category = "regression"
        else:
            fixture_path = self._save_fixture(fixture, category="golden")
            category = "golden"

        self._try_neon_write(chat_id, diagnostic_turns, grades, overall, fixture_path, category)

        return {
            "chat_id": chat_id,
            "overall": overall,
            "grades": grades,
            "fixture_path": str(fixture_path),
            "category": category,
        }

    # ── Deterministic graders (no tokens) ────────────────────────────────────

    def _grade_safety(self, turns: list[dict]) -> float:
        try:
            import sys

            if str(_REPO_ROOT / "mira-bots") not in sys.path:
                sys.path.append(str(_REPO_ROOT / "mira-bots"))
            from shared.guardrails import SAFETY_KEYWORDS
        except ImportError:
            return 1.0  # can't check — don't penalize

        score = 1.0
        for turn in turns:
            msg = (turn.get("user_message") or "").lower()
            fsm_after = turn.get("fsm_state_after", "")
            has_safety_kw = any(kw.lower() in msg for kw in SAFETY_KEYWORDS)
            is_safety_state = fsm_after == "SAFETY_ALERT"

            if has_safety_kw and not is_safety_state:
                score -= 0.5  # missed safety trigger
            if is_safety_state and not has_safety_kw:
                score -= 0.25  # false positive (erring toward safety, less bad)

        return max(0.0, score)

    def _grade_no_json_leak(self, turns: list[dict]) -> float:
        for turn in turns:
            reply = turn.get("assistant_response", "")
            if re.search(r'\{"[^"]+"\s*:', reply):
                return 0.0
        return 1.0

    def _grade_latency(self, turns: list[dict]) -> float:
        latencies = [t.get("latency_ms", 0) for t in turns if t.get("latency_ms")]
        if not latencies:
            return 1.0
        latencies.sort()
        p95_idx = max(0, int(len(latencies) * 0.95) - 1)
        p95 = latencies[p95_idx]
        if p95 <= 5000:
            return 1.0
        if p95 <= 8000:
            return 0.75
        if p95 <= 12000:
            return 0.50
        return 0.25

    def _grade_fsm_progression(self, turns: list[dict]) -> float:
        states = [t.get("fsm_state_after", "") for t in turns]
        if not states:
            return 1.0
        non_idle = [s for s in states if s not in ("IDLE", "")]
        if not non_idle:
            return 0.5  # stayed IDLE — light penalty (could be a greeting session)

        # Penalize stalling: same non-IDLE state > 3 consecutive turns
        max_run = current = 1
        for i in range(1, len(states)):
            if states[i] == states[i - 1] and states[i] not in ("IDLE", "RESOLVED", ""):
                current += 1
                max_run = max(max_run, current)
            else:
                current = 1
        if max_run > 3:
            return 0.5
        return 1.0

    # ── LLM judge (~500 tokens/session via Groq) ─────────────────────────────

    def _grade_with_judge(self, turns: list[dict]) -> dict[str, float]:
        if self._judge.disabled:
            return {}

        accumulated: dict[str, list[float]] = {}
        for turn in turns:
            user_msg = turn.get("user_message", "")
            reply = turn.get("assistant_response", "")
            if not user_msg or not reply:
                continue

            result = self._judge.grade(
                response=reply,
                rag_context="",
                user_question=user_msg,
                generated_by="unknown",
                scenario_id=f"live_{turn.get('chat_id', 'x')[:8]}",
            )
            if result.succeeded:
                for dim, raw in result.scores.items():
                    accumulated.setdefault(dim, []).append(raw / 5.0)

        return {dim: sum(scores) / len(scores) for dim, scores in accumulated.items() if scores}

    # ── Fixture generation ────────────────────────────────────────────────────

    def _generate_fixture(
        self, chat_id: str, turns: list[dict], grades: dict, overall: float
    ) -> dict:
        chat_hash = hashlib.sha256(chat_id.encode()).hexdigest()[:12]
        ts = int(time.time())
        platform = turns[0].get("platform", "unknown") if turns else "unknown"
        user_turns = [
            {"role": "user", "content": t["user_message"]} for t in turns if t.get("user_message")
        ]
        final_state = turns[-1].get("fsm_state_after", "IDLE") if turns else "IDLE"

        return {
            "id": f"auto_{chat_hash}_{ts}",
            "source": "session_recorder",
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "version_created": _MIRA_VERSION,
            "version_baseline": _MIRA_VERSION,
            "chat_id_hash": chat_hash,
            "platform": platform,
            "overall_score": round(overall, 2),
            "grades": {k: round(v, 2) for k, v in grades.items()},
            "description": f"Auto-recorded {platform} session — {len(user_turns)} turns",
            "turns": user_turns,
            "expected_final_state": final_state,
            "expected_keywords": [],
            "regression_guard": True,
            "min_acceptable_score": round(max(overall - 0.10, 0.70), 2),
            "tags": ["auto", "session-recorder", platform],
        }

    def _save_fixture(self, fixture: dict, category: str) -> Path:
        _AUTO_FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
        path = _AUTO_FIXTURES_DIR / f"{category}_{fixture['id']}.yaml"
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(fixture, f, allow_unicode=True, sort_keys=False)
        logger.info("Fixture saved: %s", path)
        return path

    # ── Alerting ─────────────────────────────────────────────────────────────

    def _alert(
        self, chat_id: str, overall: float, grades: dict, turns: list[dict], fixture_path: Path
    ) -> None:
        try:
            import asyncio
            import sys

            if str(_REPO_ROOT / "mira-bots") not in sys.path:
                sys.path.append(str(_REPO_ROOT / "mira-bots"))
            from shared.notifications.push import send_push

            worst = min(grades, key=lambda k: grades.get(k, 0)) if grades else "unknown"
            platform = turns[0].get("platform", "?") if turns else "?"
            msg = (
                f"Session scored {overall:.0%} - {worst} was {grades.get(worst, 0):.0%}\n"
                f"Platform: {platform} | Turns: {len(turns)}\n"
                f"Fixture: {fixture_path.name}"
            )
            title = f"MIRA Quality Alert - {overall:.0%}"
            priority = "default" if overall >= 0.60 else "high"
            tags = ["chart_with_downwards_trend"] if overall < 0.60 else ["bar_chart"]
            asyncio.run(send_push(message=msg, title=title, priority=priority, tags=tags))
        except Exception as exc:
            logger.warning("Alert failed: %s", exc)

    def _try_github_issue(
        self, chat_id: str, overall: float, grades: dict, turns: list[dict], fixture_path: Path
    ) -> None:
        token = os.getenv("GITHUB_TOKEN") or os.getenv("FIX_PROPOSER_GH_TOKEN", "")
        if not token:
            return
        try:
            chat_hash = hashlib.sha256(chat_id.encode()).hexdigest()[:12]
            worst = min(grades, key=lambda k: grades.get(k, 0)) if grades else "unknown"
            body_lines = [
                f"**Session:** `{chat_hash}` | **Score:** {overall:.0%} | **Turns:** {len(turns)}",
                "",
                "**Dimension scores:**",
            ]
            for dim, score in sorted(grades.items(), key=lambda x: x[1]):
                emoji = "🔴" if score < 0.60 else "🟡" if score < 0.80 else "🟢"
                body_lines.append(f"- {emoji} `{dim}`: {score:.0%}")
            body_lines += [
                "",
                f"**Fixture:** `{fixture_path.name}`",
                "",
                "**Sample turns:**",
            ]
            for i, turn in enumerate(turns[:3]):
                body_lines.append(f"- Turn {i + 1}: {turn.get('user_message', '')[:120]!r}")
            body = "\n".join(body_lines)
            title = f"Session regression: {chat_hash} scored {overall:.0%} ({worst} weak)"
            subprocess.run(
                [
                    "gh",
                    "issue",
                    "create",
                    "--title",
                    title,
                    "--body",
                    body,
                    "--label",
                    "quality,regression",
                ],
                capture_output=True,
                timeout=30,
                env={**os.environ, "GITHUB_TOKEN": token},
            )
        except Exception as exc:
            logger.warning("GitHub issue creation failed: %s", exc)

    # ── Optional NeonDB write (analysis results only) ─────────────────────────

    def _try_neon_write(
        self,
        chat_id: str,
        turns: list[dict],
        grades: dict,
        overall: float,
        fixture_path: Path,
        category: str,
    ) -> None:
        try:
            import sys

            if str(_REPO_ROOT / "mira-core" / "mira-ingest") not in sys.path:
                sys.path.append(str(_REPO_ROOT / "mira-core" / "mira-ingest"))
            import importlib as _importlib

            _neon = _importlib.import_module("db.neon")
            write_session_analysis = _neon.write_session_analysis

            chat_hash = hashlib.sha256(chat_id.encode()).hexdigest()[:12]
            write_session_analysis(
                {
                    "chat_id_hash": chat_hash,
                    "version": _MIRA_VERSION,
                    "platform": turns[0].get("platform", "unknown") if turns else "unknown",
                    "turn_count": len(turns),
                    "overall_score": round(overall, 4),
                    "grades": grades,
                    "fixture_path": str(fixture_path),
                    "category": category,
                    "session_timestamp": turns[-1].get("timestamp", "") if turns else "",
                }
            )
        except Exception as exc:
            logger.debug("NeonDB write skipped: %s", exc)
