"""Prompt Optimizer Agent — detects eval failure clusters, proposes prompt improvements.

detect(): parse the latest eval scorecard for checkpoints failing ≥2 times.
act():    call Groq to propose a targeted rule change, write to candidate.yaml.
verify(): validate candidate.yaml is well-formed; escalate to Mike with the diff
          so a human promotes it — never auto-promotes to active.yaml.

NEVER modifies production active.yaml directly.
"""

from __future__ import annotations

import logging
import os
import re
from collections import Counter
from pathlib import Path

import httpx
import yaml

from .base import AgentIssue, AgentResult, MIRAAgent

logger = logging.getLogger("mira-agents")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
RUNS_DIR = Path(os.getenv("EVAL_RUNS_DIR", str(_REPO_ROOT / "tests" / "eval" / "runs")))
ACTIVE_PROMPT = _REPO_ROOT / "mira-bots" / "prompts" / "diagnose" / "active.yaml"
CANDIDATE_PROMPT = _REPO_ROOT / "mira-bots" / "prompts" / "diagnose" / "candidate.yaml"
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

_CP_EXPLANATIONS = {
    "cp_keyword_match": "Response missing expected technical keywords — the prompt may need to emphasize citing specific technical terms",
    "cp_reached_state": "FSM didn't reach expected diagnostic state — state transition rules may need tightening",
    "cp_citation_groundedness": "Numeric specs not grounded in retrieved docs — citation rules may need strengthening",
    "cp_turn_budget": "Conversation using too many turns — the prompt may be too cautious about advancing state",
    "cp_pipeline_active": "Empty or error responses — a structural prompt issue may be causing LLM failures",
    "cp_no_5xx": "HTTP 5xx errors during eval — likely infrastructure, not prompt-related",
}


class PromptOptimizerAgent(MIRAAgent):
    name = "prompt_optimizer"
    description = "Detects eval failure clusters, proposes targeted prompt rule improvements"
    max_issues_per_run = 1  # one prompt change proposal per run
    timeout_seconds = 120

    async def detect(self) -> list[AgentIssue]:
        if not RUNS_DIR.exists():
            logger.info("PROMPT_OPT skip: runs dir %s not found", RUNS_DIR)
            return []

        scorecards = sorted(
            RUNS_DIR.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True
        )
        if not scorecards:
            logger.info("PROMPT_OPT skip: no scorecard .md files found")
            return []

        latest = scorecards[0]
        try:
            text = latest.read_text(encoding="utf-8")
        except Exception as exc:
            logger.warning("PROMPT_OPT failed to read scorecard %s: %s", latest, exc)
            return []

        # Extract failure lines: "**cp_keyword_match** FAILED"
        failure_section = re.search(r"## Failures.*?(?=## |\Z)", text, re.DOTALL)
        if not failure_section:
            return []

        cp_failures = Counter(re.findall(r"\*\*(\w+)\*\*\s+FAILED", failure_section.group()))

        issues = []
        for checkpoint, count in cp_failures.most_common():
            if count >= 2:
                issues.append(
                    AgentIssue(
                        id=f"prompt_fail_{checkpoint}",
                        category="prompt_regression",
                        description=f"{checkpoint} failed {count}× in {latest.name}",
                        severity="medium",
                        data={
                            "checkpoint": checkpoint,
                            "count": count,
                            "scorecard": str(latest),
                            "explanation": _CP_EXPLANATIONS.get(checkpoint, ""),
                        },
                    )
                )

        logger.info(
            "PROMPT_OPT scorecard=%s failure_clusters=%d", latest.name, len(issues)
        )
        return issues

    async def act(self, issue: AgentIssue) -> AgentResult:
        if not GROQ_API_KEY:
            return AgentResult(
                issue_id=issue.id,
                action_taken="skip — GROQ_API_KEY not set",
                success=False,
                details="GROQ_API_KEY required for prompt optimization",
            )

        checkpoint = issue.data.get("checkpoint", "")
        explanation = issue.data.get("explanation", "")

        try:
            prompt_text = ACTIVE_PROMPT.read_text(encoding="utf-8")
            prompt_data = yaml.safe_load(prompt_text)
        except Exception as exc:
            return AgentResult(
                issue_id=issue.id,
                action_taken="read active prompt",
                success=False,
                details=f"Failed to read active.yaml: {exc}",
            )

        system_prompt_excerpt = str(prompt_data.get("system_prompt", ""))[:2000]

        llm_prompt = (
            f"You are reviewing an industrial maintenance AI diagnostic prompt.\n"
            f"The eval checkpoint '{checkpoint}' is failing repeatedly.\n"
            f"Context: {explanation}\n\n"
            f"Current system prompt (first 2000 chars):\n{system_prompt_excerpt}\n\n"
            f"Propose ONE specific, targeted change to one rule that would fix '{checkpoint}' failures.\n"
            f"Output ONLY a YAML block:\n\n"
            f"change_rule: <rule number or name>\n"
            f"current_text: <exact current text snippet, ≤2 lines>\n"
            f"proposed_text: <exact replacement, ≤2 lines>\n"
            f"rationale: <one sentence why this fixes the failure>"
        )

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                    json={
                        "model": "llama-3.3-70b-versatile",
                        "messages": [{"role": "user", "content": llm_prompt}],
                        "max_tokens": 400,
                        "temperature": 0.3,
                    },
                )
                resp.raise_for_status()
                suggestion = resp.json()["choices"][0]["message"]["content"].strip()
        except Exception as exc:
            return AgentResult(
                issue_id=issue.id,
                action_taken="call Groq for suggestion",
                success=False,
                details=f"Groq call failed: {exc}",
            )

        # Write candidate — NEVER touch active.yaml
        try:
            candidate = dict(prompt_data)
            candidate["status"] = "candidate"
            candidate["candidate_for"] = checkpoint
            candidate["agent_suggestion"] = suggestion
            candidate["notes"] = (
                f"Agent-proposed for {checkpoint} ({issue.data.get('count')}× failures). "
                f"Human review required before promoting to active."
            )
            CANDIDATE_PROMPT.parent.mkdir(parents=True, exist_ok=True)
            CANDIDATE_PROMPT.write_text(
                yaml.dump(candidate, allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )
        except Exception as exc:
            return AgentResult(
                issue_id=issue.id,
                action_taken="write candidate.yaml",
                success=False,
                details=str(exc)[:200],
            )

        return AgentResult(
            issue_id=issue.id,
            action_taken=f"Wrote candidate.yaml targeting {checkpoint}",
            success=True,
            details=suggestion[:500],
            data={"candidate_path": str(CANDIDATE_PROMPT), "suggestion": suggestion},
        )

    async def verify(self, result: AgentResult) -> bool:
        if not result.success:
            return False
        try:
            data = yaml.safe_load(CANDIDATE_PROMPT.read_text(encoding="utf-8"))
            assert data.get("status") == "candidate"
            assert "agent_suggestion" in data
            # Always escalate — human must review and promote manually
            # The escalation ntfy shows the suggestion diff
            return False
        except Exception:
            return False

    async def escalate(self, issue: AgentIssue, result: AgentResult) -> None:
        """Override escalate to send the suggestion for human review (not a failure alert)."""
        suggestion = result.data.get("suggestion", result.details)
        msg = (
            f"Prompt candidate ready for review.\n"
            f"Checkpoint: {issue.data.get('checkpoint')} ({issue.data.get('count')}× failures)\n"
            f"Candidate: {CANDIDATE_PROMPT.name}\n\n"
            f"Proposed change:\n{suggestion[:600]}\n\n"
            f"Review and promote: cp prompts/diagnose/candidate.yaml prompts/diagnose/active.yaml"
        )
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"https://ntfy.sh/{__import__('os').getenv('NTFY_TOPIC', 'mira-factorylm-alerts')}",
                    content=msg.encode(),
                    headers={
                        "Title": "Prompt Optimizer: candidate ready for review",
                        "Priority": "default",
                        "Tags": "robot_face,pencil",
                    },
                )
        except Exception as e:
            logger.error("PROMPT_OPT escalate failed: %s", e)
