"""active_learner.py — Active learning loop: production 👎 → anonymized fixture → draft PR.

Scans feedback_log for 'bad' entries since last run, reconstructs each conversation from the
interactions table, anonymizes PII via Claude, infers pass criteria from the rating reason,
generates a YAML eval fixture, and opens a draft GitHub PR to tests/eval/fixtures/auto-generated/.

Usage (dry-run — no PR opened):
    python active_learner.py --dry-run --output /tmp/active_learning_dryrun

Environment:
    MIRA_DB_PATH                  SQLite path (default: /opt/mira/data/mira.db)
    ACTIVE_LEARNING_STATE_PATH    State JSON (default: /opt/mira/data/active_learning_state.json)
    ACTIVE_LEARNING_GH_TOKEN      GitHub PAT with contents:write + pull_requests:write
    ANTHROPIC_API_KEY             Claude API key
    CLAUDE_MODEL                  Model override (default: claude-sonnet-4-6)
    ACTIVE_LEARNING_DISABLED      Set to 1 to disable (nightly task checks this)
    ACTIVE_LEARNING_MIN_CONFIDENCE  Float 0-1 (default: 0.45; low-conf tagged needs_review)
    ACTIVE_LEARNING_MAX_FIXTURES_PER_RUN  Int (default: 50)
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml

logger = logging.getLogger("mira-active-learner")

REPO = "Mikecranesync/MIRA"
_ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
_DEFAULT_MODEL = "claude-sonnet-4-6"


# ── Anonymization system prompt ───────────────────────────────────────────────

_ANON_SYSTEM = """\
You are a privacy sanitizer for industrial maintenance chat logs.
Strip all tenant-specific PII from the conversation while preserving the diagnostic signal.

Rules:
- Replace company/facility names → FACILITY_A, FACILITY_B, ... (sequential per session)
- Replace personal names (techs, managers) → TECH_A, TECH_B, ...
- Replace specific building/room identifiers → BUILDING_X
- Keep vendor names verbatim (AutomationDirect, Siemens, Pilz, Yaskawa, ABB, etc.)
- Keep model/part numbers verbatim (GS10, GS20, PSENcode, V1000, PowerFlex, etc.)
- Keep fault codes verbatim (OC, E7, F004, etc.)
- Keep general problem descriptions verbatim
- Keep diagnostic context (motor HP, voltage, load type, etc.)

Return ONLY valid JSON — no commentary outside the JSON block:
{
  "turns": [
    {"role": "user", "content": "<sanitized text>"},
    {"role": "assistant", "content": "<sanitized text>"}
  ],
  "anonymization_notes": "One sentence describing what was replaced, e.g. \\"Replaced \\'Acme Mfg\\' → FACILITY_A; \\'John\\' → TECH_A\\""
}"""

_ANON_USER = """\
Sanitize this conversation:
{conversation_json}"""


# ── Criteria inference system prompt ─────────────────────────────────────────

_CRITERIA_SYSTEM = """\
You are a MIRA eval judge. Given a production chat session where the user rated the final \
assistant turn as BAD (thumbs down), determine what the assistant SHOULD have done.

MIRA is an industrial maintenance diagnostic assistant. Its FSM states are:
IDLE → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED
Special states: SAFETY_ALERT, ASSET_IDENTIFIED
Intents: safety, industrial, documentation, greeting, help, off_topic

Return ONLY valid JSON — no commentary:
{
  "expected_final_state": "<FSM state MIRA should have reached>",
  "expected_intent": "<intent MIRA should have classified>",
  "expected_keywords": ["<word the final response MUST contain>", ...],
  "forbidden_keywords": ["<word the final response must NOT contain>", ...],
  "expected_vendor": "<vendor name or null>",
  "description": "<one sentence: what MIRA should have done>",
  "confidence": <float 0.0-1.0 — how certain you are about these criteria>,
  "tldr": "<5-10 word summary for PR table>"
}"""

_CRITERIA_USER = """\
Rating reason: {reason}
Follow-up comment: {comment}
Conversation (already anonymized):
{conversation_json}"""


class ActiveLearner:
    def __init__(
        self,
        *,
        db_path: str,
        state_path: str,
        gh_token: str,
        anthropic_api_key: str,
        claude_model: str = _DEFAULT_MODEL,
        repo: str = REPO,
        min_confidence: float = 0.45,
        max_fixtures_per_run: int = 50,
    ) -> None:
        self.db_path = db_path
        self.state_path = state_path
        self.gh_token = gh_token
        self.anthropic_api_key = anthropic_api_key
        self.claude_model = claude_model
        self.repo = repo
        self.min_confidence = min_confidence
        self.max_fixtures_per_run = max_fixtures_per_run
        self.auto_land_confidence = 0.85  # ≥ this → commit direct; below → draft PR

    # ── State management ─────────────────────────────────────────────────────

    def _load_state(self) -> dict:
        p = Path(self.state_path)
        if p.exists():
            try:
                return json.loads(p.read_text())
            except Exception:
                pass
        return {"last_run_ts": None}

    def _save_state(self, state: dict) -> None:
        Path(self.state_path).write_text(json.dumps(state, indent=2))

    def _hash_chat_id(self, chat_id: str) -> str:
        return hashlib.sha256(chat_id.encode()).hexdigest()[:12]

    # ── Claude API ────────────────────────────────────────────────────────────

    async def _claude_json(self, system: str, user: str) -> dict | None:
        """Call Claude, return parsed JSON from response, or None on failure."""
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    _ANTHROPIC_API,
                    headers={
                        "x-api-key": self.anthropic_api_key,
                        "anthropic-version": "2023-06-01",
                        "anthropic-beta": "prompt-caching-2024-07-31",
                        "content-type": "application/json",
                    },
                    json={
                        "model": self.claude_model,
                        "max_tokens": 2048,
                        "system": [
                            {"type": "text", "text": system,
                             "cache_control": {"type": "ephemeral"}},
                        ],
                        "messages": [{"role": "user", "content": user}],
                    },
                )
                resp.raise_for_status()
                text = resp.json()["content"][0]["text"].strip()
                # Strip markdown code fences if present
                text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.DOTALL)
                return json.loads(text)
        except httpx.HTTPStatusError as e:
            logger.error("Claude API HTTP %s: %s", e.response.status_code, e.response.text[:200])
        except json.JSONDecodeError as e:
            logger.error("Claude returned non-JSON: %s", e)
        except Exception as e:
            logger.error("Claude call failed: %s", e)
        return None

    # ── Data collection ───────────────────────────────────────────────────────

    def collect_negatives_since(self, checkpoint_ts: str | None) -> list[dict]:
        """Return all 'bad' feedback entries since checkpoint_ts."""
        if not Path(self.db_path).exists():
            logger.warning("DB not found: %s", self.db_path)
            return []
        try:
            db = sqlite3.connect(self.db_path)
            db.row_factory = sqlite3.Row
            if checkpoint_ts:
                rows = db.execute(
                    "SELECT * FROM feedback_log WHERE feedback = 'bad' AND created_at > ?"
                    " ORDER BY created_at LIMIT ?",
                    (checkpoint_ts, self.max_fixtures_per_run),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM feedback_log WHERE feedback = 'bad'"
                    " ORDER BY created_at LIMIT ?",
                    (self.max_fixtures_per_run,),
                ).fetchall()
            db.close()
            return [dict(r) for r in rows]
        except Exception as e:
            logger.error("collect_negatives_since failed: %s", e)
            return []

    def reconstruct_conversation(self, chat_id: str, up_to_ts: str) -> list[dict]:
        """Return user+assistant turns for chat_id up to (and including) up_to_ts."""
        try:
            db = sqlite3.connect(self.db_path)
            db.row_factory = sqlite3.Row
            rows = db.execute(
                "SELECT user_message, bot_response, created_at FROM interactions"
                " WHERE chat_id = ? AND created_at <= ? ORDER BY created_at",
                (chat_id, up_to_ts),
            ).fetchall()
            db.close()
            turns: list[dict] = []
            for row in rows:
                turns.append({"role": "user", "content": row["user_message"]})
                if row["bot_response"]:
                    turns.append({"role": "assistant", "content": row["bot_response"]})
            return turns
        except Exception as e:
            logger.error("reconstruct_conversation failed: %s", e)
            return []

    # ── LLM processing ────────────────────────────────────────────────────────

    async def anonymize(self, conversation: list[dict]) -> dict | None:
        """Strip PII from conversation, preserve vendor/model signal."""
        user_msg = _ANON_USER.format(conversation_json=json.dumps(conversation, indent=2))
        result = await self._claude_json(_ANON_SYSTEM, user_msg)
        if not result or "turns" not in result:
            logger.warning("anonymize() returned no turns")
            return None
        return result

    async def infer_pass_criteria(
        self,
        conversation: list[dict],
        reason: str,
        comment: str,
    ) -> dict | None:
        """Infer what MIRA should have done. Returns None if confidence < threshold."""
        user_msg = _CRITERIA_USER.format(
            reason=reason or "(no reason given)",
            comment=comment or "(no follow-up comment)",
            conversation_json=json.dumps(conversation, indent=2),
        )
        result = await self._claude_json(_CRITERIA_SYSTEM, user_msg)
        if not result:
            return None
        confidence = float(result.get("confidence", 0.0))
        if confidence < self.min_confidence:
            logger.info(
                "Criteria inference confidence %.2f < threshold %.2f — skipping fixture",
                confidence,
                self.min_confidence,
            )
            return None
        return result

    # ── Fixture generation ────────────────────────────────────────────────────

    def generate_fixture(
        self,
        anon_result: dict,
        pass_criteria: dict,
        feedback_entry: dict,
        inference_confidence: float = 0.0,
    ) -> tuple[str, str]:
        """Return (filename, yaml_content) for the auto-generated fixture."""
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        chat_hash = self._hash_chat_id(feedback_entry["chat_id"])
        filename = f"auto_{date_str}_{chat_hash}.yaml"

        # Only keep user turns for the fixture (assistant turns are generated by the pipeline)
        user_turns = [t for t in anon_result["turns"] if t["role"] == "user"]

        fixture: dict[str, Any] = {
            "id": f"auto_{chat_hash}",
            "description": pass_criteria.get("description", "Auto-generated from production feedback"),
            "auto_generated": True,
            "review_required": True,
            "generated_from_feedback_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "source_feedback_hash": self._hash_chat_id(feedback_entry["chat_id"]),
            "anonymization_notes": anon_result.get("anonymization_notes", ""),
            "expected_final_state": pass_criteria.get("expected_final_state", "DIAGNOSIS"),
            "max_turns": len(user_turns) + 2,
            "expected_keywords": pass_criteria.get("expected_keywords", []),
            "expected_vendor": pass_criteria.get("expected_vendor") or "",
            "inference_confidence": round(inference_confidence, 3),
            "wo_expected": False,
            "safety_expected": False,
            "tags": ["auto-generated", "active-learning", "needs-review"],
            "turns": user_turns,
        }
        if pass_criteria.get("forbidden_keywords"):
            fixture["forbidden_keywords"] = pass_criteria["forbidden_keywords"]

        content = yaml.dump(fixture, default_flow_style=False, allow_unicode=True, sort_keys=False)
        return filename, content

    # ── Direct commit (high-confidence fixtures) ──────────────────────────────

    def _commit_fixtures_direct(
        self,
        fixtures: list[tuple[str, str]],
        mira_dir: str,
    ) -> bool:
        """Write high-confidence fixtures directly to tests/eval/fixtures/ and push.

        Returns True on success. Used when inference_confidence ≥ auto_land_confidence.
        """
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        n = len(fixtures)
        try:
            def _run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
                return subprocess.run(cmd, cwd=mira_dir, capture_output=True, text=True, check=check)

            fixtures_dir = Path(mira_dir) / "tests" / "eval" / "fixtures"
            fixtures_dir.mkdir(parents=True, exist_ok=True)

            for fname, content in fixtures:
                (fixtures_dir / fname).write_text(content)

            _run(["git", "add"] + [f"tests/eval/fixtures/{f}" for f, _ in fixtures])
            _run(
                ["git", "commit", "-m",
                 f"auto: land {n} high-confidence active-learning fixture(s) ({date_str})\n\n"
                 f"Signed-off-by: mira-active-learner <eval@mira.local>"],
            )
            env = {**os.environ, "GH_TOKEN": self.gh_token}
            push_r = subprocess.run(
                ["git", "push", "origin", "HEAD"],
                cwd=mira_dir, capture_output=True, text=True, env=env,
            )
            if push_r.returncode != 0:
                logger.error("Direct push failed: %s", push_r.stderr[:300])
                return False
            logger.info("Auto-landed %d fixture(s) directly to main", n)
            return True
        except Exception as e:
            logger.error("_commit_fixtures_direct failed: %s", e)
            return False

    # ── PR creation ───────────────────────────────────────────────────────────

    async def open_draft_pr(
        self,
        new_fixtures: list[tuple[str, str]],
        summary: dict,
        mira_dir: str,
    ) -> str | None:
        """Create branch, commit fixtures, open draft PR. Returns PR URL or None."""
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        branch = f"auto/active-learning-{date_str}"
        n = len(new_fixtures)
        pr_title = f"auto: active-learning fixtures from {date_str} feedback ({n} new)"

        # Build PR body
        rows = "\n".join(
            f"| `{fname}` | {info.get('reason', '')} | {info.get('anon_notes', '')} | {info.get('tldr', '')} |"
            for fname, info in zip(
                [f for f, _ in new_fixtures],
                summary.get("fixture_infos", [{}] * n),
            )
        )
        start_ts = summary.get("start_ts", "")
        end_ts = summary.get("end_ts", "")
        hashes = "\n".join(f"- `{h}`" for h in summary.get("source_hashes", []))
        pr_body = f"""\
## Auto-generated eval fixtures from production feedback

Source: {n} 👎 ratings between {start_ts} and {end_ts}
Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC

### Fixtures in this PR

| Filename | Source reason | Anonymization | TL;DR |
|---|---|---|---|
{rows}

### Review checklist
- [ ] Anonymization preserves vendor/model signal
- [ ] No leftover PII
- [ ] Pass criteria match actual user intent
- [ ] Fixture would have flagged the bug being tracked

### Source chat_ids (hashed)
{hashes}
"""
        worktree_dir = tempfile.mkdtemp(prefix="mira-active-learning-")
        try:
            def _run(cmd: list[str], cwd: str, check: bool = True) -> subprocess.CompletedProcess:
                return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=check)

            # Create worktree on a new branch from HEAD
            _run(["git", "worktree", "add", "-b", branch, worktree_dir, "HEAD"], mira_dir)

            # Write fixtures
            fixtures_dir = Path(worktree_dir) / "tests" / "eval" / "fixtures" / "auto-generated"
            fixtures_dir.mkdir(parents=True, exist_ok=True)

            for fname, content in new_fixtures:
                (fixtures_dir / fname).write_text(content)

            # Commit
            _run(["git", "add", "tests/eval/fixtures/auto-generated/"], worktree_dir)
            _run(
                ["git", "commit", "-m",
                 f"auto: active-learning fixtures from {date_str} ({n} new)\n\n"
                 f"Signed-off-by: mira-active-learner <eval@mira.local>"],
                worktree_dir,
            )

            # Push
            env = {**os.environ, "GH_TOKEN": self.gh_token}
            push_r = subprocess.run(
                ["git", "push", "-u", "origin", branch],
                cwd=worktree_dir, capture_output=True, text=True, env=env,
            )
            if push_r.returncode != 0:
                logger.error("git push failed: %s", push_r.stderr[:300])
                return None

            # Create draft PR
            pr_r = subprocess.run(
                ["gh", "pr", "create", "--draft",
                 "--title", pr_title, "--body", pr_body,
                 "--repo", self.repo],
                cwd=worktree_dir, capture_output=True, text=True, env=env,
            )
            if pr_r.returncode != 0:
                logger.error("gh pr create failed: %s", pr_r.stderr[:300])
                return None

            return pr_r.stdout.strip()

        except Exception as e:
            logger.error("open_draft_pr failed: %s", e)
            return None
        finally:
            subprocess.run(
                ["git", "worktree", "remove", "--force", worktree_dir],
                cwd=mira_dir, capture_output=True,
            )

    # ── Orchestrator ──────────────────────────────────────────────────────────

    async def run(
        self,
        dry_run: bool = False,
        output_dir: str | None = None,
        mira_dir: str = "/opt/mira",
    ) -> dict:
        """Run the full active learning pipeline. Returns a result summary dict."""
        state = self._load_state()
        checkpoint_ts = state.get("last_run_ts")
        run_ts = datetime.now(timezone.utc).isoformat()

        logger.info("Active learner starting (checkpoint=%s, dry_run=%s)", checkpoint_ts, dry_run)

        negatives = self.collect_negatives_since(checkpoint_ts)
        logger.info("Found %d negative feedback entries since %s", len(negatives), checkpoint_ts)

        if not negatives:
            self._save_state({"last_run_ts": run_ts})
            return {"status": "ok", "fixtures_generated": 0, "reason": "no_negatives", "ts": run_ts}

        new_fixtures: list[tuple[str, str]] = []
        fixture_infos: list[dict] = []
        source_hashes: list[str] = []
        skipped = 0

        for entry in negatives:
            chat_id = entry["chat_id"]
            reason = entry.get("reason") or ""
            comment = entry.get("last_reply") or ""
            created_at = entry["created_at"]

            conversation = self.reconstruct_conversation(chat_id, created_at)
            if not conversation:
                logger.warning("No interactions found for chat_id=%s — skipping", chat_id)
                skipped += 1
                continue

            anon = await self.anonymize(conversation)
            if not anon:
                skipped += 1
                continue

            criteria = await self.infer_pass_criteria(anon["turns"], reason, comment)
            if not criteria:
                skipped += 1
                continue

            inf_conf = float(criteria.get("confidence", 0.0))
            fname, content = self.generate_fixture(anon, criteria, entry, inference_confidence=inf_conf)
            new_fixtures.append((fname, content, inf_conf))
            source_hashes.append(self._hash_chat_id(chat_id))
            fixture_infos.append({
                "reason": reason[:80],
                "anon_notes": anon.get("anonymization_notes", "")[:60],
                "tldr": criteria.get("tldr", "")[:60],
                "confidence": inf_conf,
            })

        logger.info(
            "Generated %d fixtures, skipped %d (confidence/data gaps)",
            len(new_fixtures), skipped,
        )

        # Unpack 3-tuples
        fixture_pairs = [(f, c) for f, c, _ in new_fixtures]

        # Dry-run: write to output_dir and stop
        if dry_run:
            out = Path(output_dir or "/tmp/active_learning_dryrun")
            out.mkdir(parents=True, exist_ok=True)
            for fname, content, conf in new_fixtures:
                (out / fname).write_text(content)
                logger.info("DRY-RUN wrote: %s (conf=%.2f)", out / fname, conf)
            self._save_state({"last_run_ts": run_ts})
            return {
                "status": "dry_run",
                "fixtures_generated": len(new_fixtures),
                "skipped": skipped,
                "output_dir": str(out),
                "ts": run_ts,
            }

        if not new_fixtures:
            self._save_state({"last_run_ts": run_ts})
            return {"status": "ok", "fixtures_generated": 0, "skipped": skipped, "ts": run_ts}

        # Split: high-confidence → direct commit; low-confidence → draft PR
        high_conf = [(f, c) for f, c, conf in new_fixtures if conf >= self.auto_land_confidence]
        low_conf = [(f, c) for f, c, conf in new_fixtures if conf < self.auto_land_confidence]

        landed = 0
        if high_conf:
            ok = self._commit_fixtures_direct(high_conf, mira_dir)
            landed = len(high_conf) if ok else 0

        pr_url = None
        if low_conf:
            low_conf_infos = fixture_infos[len(high_conf):]
            summary = {
                "start_ts": checkpoint_ts or "all-time",
                "end_ts": run_ts,
                "fixture_infos": low_conf_infos,
                "source_hashes": source_hashes[len(high_conf):],
            }
            pr_url = await self.open_draft_pr(low_conf, summary, mira_dir)

        self._save_state({"last_run_ts": run_ts})
        return {
            "status": "ok",
            "fixtures_generated": len(new_fixtures),
            "auto_landed": landed,
            "draft_pr_fixtures": len(low_conf),
            "skipped": skipped,
            "pr_url": pr_url,
            "ts": run_ts,
        }


# ── CLI entry point ───────────────────────────────────────────────────────────

def _build_learner() -> ActiveLearner:
    return ActiveLearner(
        db_path=os.getenv("MIRA_DB_PATH", "/opt/mira/data/mira.db"),
        state_path=os.getenv(
            "ACTIVE_LEARNING_STATE_PATH", "/opt/mira/data/active_learning_state.json"
        ),
        gh_token=os.getenv("ACTIVE_LEARNING_GH_TOKEN", ""),
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
        claude_model=os.getenv("CLAUDE_MODEL", _DEFAULT_MODEL),
        min_confidence=float(os.getenv("ACTIVE_LEARNING_MIN_CONFIDENCE", "0.45")),
        max_fixtures_per_run=int(os.getenv("ACTIVE_LEARNING_MAX_FIXTURES_PER_RUN", "50")),
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="MIRA active learning loop")
    parser.add_argument("--dry-run", action="store_true", help="Write fixtures locally, no PR")
    parser.add_argument("--output", default="/tmp/active_learning_dryrun", help="Dry-run output dir")
    parser.add_argument("--mira-dir", default="/opt/mira", help="Repo root on VPS")
    args = parser.parse_args()

    result = asyncio.run(_build_learner().run(
        dry_run=args.dry_run,
        output_dir=args.output,
        mira_dir=args.mira_dir,
    ))
    print(json.dumps(result, indent=2))
