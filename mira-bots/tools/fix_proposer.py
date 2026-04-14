"""fix_proposer.py — failure cluster → LLM patch → draft PR automation.

Reads recent eval scorecards, groups failures by root-cause signature,
proposes a minimal patch via Claude API, and opens a DRAFT PR for human review.

Part of the Karpathy eval alignment roadmap (ADR-0010, issue #225).

Environment variables:
  FIX_PROPOSER_GH_TOKEN          GitHub PAT for gh CLI auth
  FIX_PROPOSER_LLM_MODEL         Claude model (default: claude-sonnet-4-6)
  FIX_PROPOSER_MIN_CLUSTER_SIZE  Minimum failures to form a cluster (default: 3)
  FIX_PROPOSER_CONTEXT_DEPTH     Git log entries per file (default: 2)
  FIX_PROPOSER_MAX_PRS_PER_RUN   PR flood guard (default: 3)
  FIX_PROPOSER_DISABLED          Set to "1" to skip all runs

Usage:
  python3 mira-bots/tools/fix_proposer.py --dry-run
  python3 mira-bots/tools/fix_proposer.py --days 7
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import tempfile
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import yaml

logger = logging.getLogger("mira-fix-proposer")

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_API_VERSION = "2023-06-01"

# Checkpoint names as written in scorecard Failures section (grader.py CheckpointResult.name)
_CP_KEYWORD = "cp_keyword_match"
_CP_STATE = "cp_reached_state"
_CP_PIPELINE = "cp_pipeline_active"
_CP_5XX = "cp_no_5xx"
_CP_BUDGET = "cp_turn_budget"

# Maps failure signature → source files most likely to contain the fix
_SIGNATURE_TO_FILES: dict[str, list[str]] = {
    "cp_keyword_match_no_match": [
        "mira-bots/shared/guardrails.py",
        "mira-bots/shared/workers/rag_worker.py",
    ],
    "cp_keyword_match_missed_vendor_url": [
        "mira-bots/shared/guardrails.py",
    ],
    "cp_keyword_match_no_honesty_signal": [
        "mira-bots/shared/guardrails.py",
        "mira-bots/shared/workers/rag_worker.py",
    ],
    "cp_keyword_match_no_safety_terms": [
        "mira-bots/shared/guardrails.py",
    ],
    "cp_forbidden_keywords_hit": [
        "mira-bots/shared/workers/rag_worker.py",
        "mira-bots/shared/guardrails.py",
    ],
    "cp_reached_state_below_expected": [
        "mira-bots/shared/engine.py",
    ],
    "cp_pipeline_inactive": [
        "mira-bots/shared/engine.py",
        "mira-bots/shared/inference/router.py",
    ],
    "cp_5xx_errors": [
        "mira-pipeline/pipeline_api.py",
    ],
    "cp_turn_budget_exceeded": [
        "mira-bots/shared/engine.py",
    ],
}

_SAFE_SLUG_RE = re.compile(r"[^a-z0-9_-]")

# Regex patterns for scorecard parsing
_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")
_FAILURES_SECTION_RE = re.compile(
    r"^## Failures\n(.+?)(?=\n## |\Z)", re.MULTILINE | re.DOTALL
)


# ── Data classes ──────────────────────────────────────────────────────────────


@dataclass
class FailureRecord:
    scenario_id: str
    checkpoint: str
    reason: str
    last_response: str
    run_date: str  # YYYY-MM-DD


@dataclass
class FailureCluster:
    signature: str
    members: list[FailureRecord] = field(default_factory=list)
    fixture_tags: list[str] = field(default_factory=list)
    source_files: list[str] = field(default_factory=list)

    @property
    def slug(self) -> str:
        """URL-safe slug for branch names and temp dirs."""
        raw = f"{self.signature}-{len(self.members)}"
        return _SAFE_SLUG_RE.sub("-", raw)[:60].strip("-")

    @property
    def scenario_ids(self) -> list[str]:
        return [m.scenario_id for m in self.members]


@dataclass
class PatchProposal:
    diff: str
    model: str
    input_tokens: int


@dataclass
class SandboxResult:
    patch_applies: bool
    dry_run_passed: bool
    error: str = ""


# ── Scorecard parsing ─────────────────────────────────────────────────────────


def _parse_scorecard(path: Path) -> list[FailureRecord]:
    """Extract all FailureRecords from a single scorecard .md file."""
    text = path.read_text()

    section_match = _FAILURES_SECTION_RE.search(text)
    if not section_match:
        return []

    failures_text = section_match.group(1)

    date_match = _DATE_RE.search(path.name)
    run_date = date_match.group(1) if date_match else path.stem[:10]

    records: list[FailureRecord] = []

    # Split failures_text into per-scenario blocks on "### " headers
    raw_blocks = re.split(r"\n### ", "\n" + failures_text)
    for block in raw_blocks:
        block = block.strip()
        if not block:
            continue

        lines = block.split("\n")
        scenario_id = lines[0].strip()
        if not scenario_id or " " in scenario_id:
            # Skip non-scenario-id lines (blank, markdown noise)
            continue

        body = "\n".join(lines[1:])

        last_response_m = re.search(r"^- Last response: `(.+)`", body, re.MULTILINE)
        last_response = last_response_m.group(1) if last_response_m else ""

        for cp_m in re.finditer(r"^- \*\*(\w+)\*\* FAILED: (.+)$", body, re.MULTILINE):
            records.append(
                FailureRecord(
                    scenario_id=scenario_id,
                    checkpoint=cp_m.group(1),
                    reason=cp_m.group(2).strip(),
                    last_response=last_response,
                    run_date=run_date,
                )
            )

    return records


# ── Signature classifier ──────────────────────────────────────────────────────


def _classify_signature(checkpoint: str, reason: str) -> str:
    """Map a (checkpoint, reason) pair to a canonical failure signature."""
    r = reason.lower()

    if checkpoint == _CP_KEYWORD:
        if "forbidden keywords" in r:
            return "cp_forbidden_keywords_hit"
        if "honesty signal" in r:
            return "cp_keyword_match_no_honesty_signal"
        if "safety terms" in r:
            return "cp_keyword_match_no_safety_terms"
        if "vendor url" in r or "support url" in r:
            return "cp_keyword_match_missed_vendor_url"
        if "no match from" in r:
            return "cp_keyword_match_no_match"
        return "cp_keyword_match_other"

    if checkpoint == _CP_STATE:
        return "cp_reached_state_below_expected"

    if checkpoint == _CP_PIPELINE:
        return "cp_pipeline_inactive"

    if checkpoint == _CP_5XX:
        return "cp_5xx_errors"

    if checkpoint == _CP_BUDGET:
        return "cp_turn_budget_exceeded"

    return f"unknown_{checkpoint}"


# ── Main class ────────────────────────────────────────────────────────────────


class FixProposer:
    """Failure cluster → LLM patch proposal → draft PR automation.

    Reads recent eval scorecards, groups failures by root-cause signature,
    proposes a minimal patch via Claude API, and opens a DRAFT PR.
    """

    def __init__(
        self,
        scorecards_dir: Path | str,
        repo_path: Path | str,
        gh_token: str,
    ) -> None:
        self.scorecards_dir = Path(scorecards_dir)
        self.repo_path = Path(repo_path)
        self.fixtures_dir = self.repo_path / "tests" / "eval" / "fixtures"
        self.gh_token = gh_token
        self.llm_model = os.getenv("FIX_PROPOSER_LLM_MODEL", "claude-sonnet-4-6")
        self.min_cluster_size = int(os.getenv("FIX_PROPOSER_MIN_CLUSTER_SIZE", "3"))
        self.context_depth = int(os.getenv("FIX_PROPOSER_CONTEXT_DEPTH", "2"))
        self.max_prs = int(os.getenv("FIX_PROPOSER_MAX_PRS_PER_RUN", "3"))
        self._fixture_cache: dict[str, dict] | None = None

    # ── Fixture loader ────────────────────────────────────────────────────────

    def _load_fixtures(self) -> dict[str, dict]:
        """Load all fixture YAMLs, keyed by fixture id."""
        if self._fixture_cache is not None:
            return self._fixture_cache
        self._fixture_cache = {}
        for yaml_path in self.fixtures_dir.glob("*.yaml"):
            try:
                with open(yaml_path) as f:
                    data = yaml.safe_load(f)
                if data and "id" in data:
                    self._fixture_cache[data["id"]] = data
            except Exception as e:
                logger.warning("Failed to load fixture %s: %s", yaml_path.name, e)
        return self._fixture_cache

    # ── Scorecard loader ──────────────────────────────────────────────────────

    def load_recent_scorecards(self, days: int = 7) -> list[FailureRecord]:
        """Load all failure records from scorecards within the last N days."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        records: list[FailureRecord] = []

        for md_path in sorted(self.scorecards_dir.glob("*.md")):
            date_match = _DATE_RE.search(md_path.name)
            if not date_match:
                continue
            try:
                file_date = datetime.strptime(date_match.group(1), "%Y-%m-%d").replace(
                    tzinfo=timezone.utc
                )
            except ValueError:
                continue
            if file_date < cutoff:
                continue
            try:
                found = _parse_scorecard(md_path)
                records.extend(found)
                logger.debug("Parsed %d failures from %s", len(found), md_path.name)
            except Exception as e:
                logger.warning("Failed to parse scorecard %s: %s", md_path.name, e)

        logger.info("Loaded %d failure records from last %d day(s)", len(records), days)
        return records

    # ── Clustering ────────────────────────────────────────────────────────────

    def cluster_failures(self, records: list[FailureRecord]) -> list[FailureCluster]:
        """Group failures by signature; return clusters with ≥ min_cluster_size members.

        Clusters are sorted by member count descending (largest first).
        """
        fixtures = self._load_fixtures()
        buckets: dict[str, list[FailureRecord]] = defaultdict(list)

        for r in records:
            sig = _classify_signature(r.checkpoint, r.reason)
            buckets[sig].append(r)

        clusters: list[FailureCluster] = []
        for sig, members in buckets.items():
            if len(members) < self.min_cluster_size:
                logger.debug(
                    "Skipping cluster %s — %d members < min=%d",
                    sig, len(members), self.min_cluster_size,
                )
                continue

            tag_set: set[str] = set()
            for m in members:
                fixture = fixtures.get(m.scenario_id, {})
                tag_set.update(fixture.get("tags", []))

            cluster = FailureCluster(
                signature=sig,
                members=members,
                fixture_tags=sorted(tag_set),
                source_files=list(_SIGNATURE_TO_FILES.get(sig, [])),
            )
            clusters.append(cluster)
            logger.info(
                "Cluster detected: %s — %d members, tags=%s",
                sig, len(members), cluster.fixture_tags,
            )

        clusters.sort(key=lambda c: len(c.members), reverse=True)
        return clusters

    # ── Context gathering ─────────────────────────────────────────────────────

    def gather_repo_context(self, cluster: FailureCluster) -> str:
        """Assemble context string: source files + git log + failing fixture details."""
        sections: list[str] = []

        for rel_path in cluster.source_files:
            abs_path = self.repo_path / rel_path
            if not abs_path.exists():
                logger.warning("Context file not found: %s", abs_path)
                sections.append(f"### {rel_path}\n[FILE NOT FOUND]")
                continue
            try:
                content = abs_path.read_text()
                # Cap very large files to keep the context window manageable
                if len(content) > 8000:
                    content = content[:8000] + "\n... [truncated — file > 8000 chars]"
                sections.append(f"### {rel_path}\n```python\n{content}\n```")
            except Exception as e:
                logger.warning("Failed to read %s: %s", rel_path, e)
                sections.append(f"### {rel_path}\n[READ ERROR: {e}]")

            try:
                log_r = subprocess.run(
                    ["git", "log", f"--max-count={self.context_depth}", "--oneline", "--", rel_path],
                    cwd=self.repo_path,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if log_r.stdout.strip():
                    sections.append(
                        f"**Recent git log for {rel_path}:**\n```\n{log_r.stdout.strip()}\n```"
                    )
            except Exception as e:
                logger.debug("Git log failed for %s: %s", rel_path, e)

        # Include fixture YAML + last response for up to 5 failing scenarios
        fixtures = self._load_fixtures()
        seen: set[str] = set()
        fixture_parts: list[str] = []
        for m in cluster.members[:5]:
            if m.scenario_id in seen:
                continue
            seen.add(m.scenario_id)
            fixture = fixtures.get(m.scenario_id, {})
            if fixture:
                fixture_yaml = yaml.dump(fixture, default_flow_style=False)
                fixture_parts.append(
                    f"**Fixture `{m.scenario_id}`:**\n```yaml\n{fixture_yaml}```"
                    f"\n**Last response:** `{m.last_response[:300]}`"
                    f"\n**Failure reason:** {m.reason}"
                )

        if fixture_parts:
            sections.append("## Failing Fixtures\n\n" + "\n\n".join(fixture_parts))

        return "\n\n".join(sections)

    # ── Patch proposal ────────────────────────────────────────────────────────

    def propose_patch(self, cluster: FailureCluster, context: str) -> PatchProposal | None:
        """Call Claude API to get a minimal unified diff for the cluster."""
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            logger.error("ANTHROPIC_API_KEY not set — cannot propose patch")
            return None

        reasons_summary = "\n".join(
            f"  - {m.scenario_id}: [{m.checkpoint}] {m.reason}"
            for m in cluster.members[:8]
        )

        prompt = (
            "You are a senior Python engineer reviewing failing automated eval fixtures "
            "for MIRA, an AI-powered industrial maintenance diagnostic platform.\n\n"
            "## Failure Cluster\n\n"
            f"**Signature:** `{cluster.signature}`\n"
            f"**Failing fixtures ({len(cluster.members)}):**\n{reasons_summary}\n"
            f"**Fixture tags:** {', '.join(cluster.fixture_tags)}\n\n"
            "## Relevant Source Code and Context\n\n"
            f"{context}\n\n"
            "## Task\n\n"
            f"Propose the minimum unified diff that would make these {len(cluster.members)} "
            "fixtures pass without breaking other currently-passing fixtures.\n\n"
            "Requirements:\n"
            "1. Output ONLY a valid unified diff (--- a/path\\n+++ b/path\\n@@ ... @@ format)\n"
            "2. Only modify files shown in the context above\n"
            "3. Be minimal — do not refactor, rename, or clean up unrelated code\n"
            "4. Do not change safety keywords, LOTO procedures, or security boundaries\n"
            "5. If you cannot determine a confident fix, respond with exactly: "
            "NO_PATCH_POSSIBLE\n\n"
            "Respond with only the unified diff or NO_PATCH_POSSIBLE — no explanation, "
            "no markdown fences."
        )

        try:
            with httpx.Client(timeout=60) as client:
                resp = client.post(
                    ANTHROPIC_API_URL,
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": ANTHROPIC_API_VERSION,
                        "content-type": "application/json",
                    },
                    json={
                        "model": self.llm_model,
                        "max_tokens": 2048,
                        "temperature": 0.2,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.error(
                "Claude API HTTP %s: %s", e.response.status_code, e.response.text[:300]
            )
            return None
        except Exception as e:
            logger.error("Claude API error: %s", e)
            return None

        data = resp.json()
        diff_text = data["content"][0]["text"].strip()
        input_tokens = data.get("usage", {}).get("input_tokens", 0)

        if diff_text == "NO_PATCH_POSSIBLE":
            logger.warning("Claude returned NO_PATCH_POSSIBLE for cluster %s", cluster.signature)
            return None

        # Sanity check — must look like a unified diff
        if not ("---" in diff_text and "+++" in diff_text and "@@" in diff_text):
            logger.warning(
                "Claude response for %s doesn't look like a valid diff — skipping",
                cluster.signature,
            )
            return None

        return PatchProposal(diff=diff_text, model=self.llm_model, input_tokens=input_tokens)

    # ── Sandbox validation ────────────────────────────────────────────────────

    def sandbox_patch(self, cluster: FailureCluster, patch: PatchProposal) -> SandboxResult:
        """Apply patch in a detached git worktree, run eval --dry-run to check for regressions."""
        sandbox_dir = Path(tempfile.mkdtemp(prefix=f"fix_sandbox_{cluster.slug}_"))

        try:
            wt_r = subprocess.run(
                ["git", "worktree", "add", "--detach", str(sandbox_dir)],
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if wt_r.returncode != 0:
                return SandboxResult(
                    patch_applies=False,
                    dry_run_passed=False,
                    error=f"git worktree add failed: {wt_r.stderr[:200]}",
                )

            # Test patch applicability first (dry-run)
            dry_r = subprocess.run(
                ["patch", "--dry-run", "-p1", "--forward"],
                input=patch.diff,
                cwd=sandbox_dir,
                capture_output=True,
                text=True,
                timeout=15,
            )
            if dry_r.returncode != 0:
                return SandboxResult(
                    patch_applies=False,
                    dry_run_passed=False,
                    error=f"patch --dry-run failed: {dry_r.stderr[:300]}",
                )

            # Apply for real
            apply_r = subprocess.run(
                ["patch", "-p1", "--forward"],
                input=patch.diff,
                cwd=sandbox_dir,
                capture_output=True,
                text=True,
                timeout=15,
            )
            if apply_r.returncode != 0:
                return SandboxResult(
                    patch_applies=False,
                    dry_run_passed=False,
                    error=f"patch apply failed: {apply_r.stderr[:300]}",
                )

            # Run eval --dry-run: validates fixture loading and no import/syntax errors
            eval_r = subprocess.run(
                ["python3", "tests/eval/run_eval.py", "--dry-run"],
                cwd=sandbox_dir,
                capture_output=True,
                text=True,
                timeout=60,
            )
            dry_run_passed = eval_r.returncode in (0, 1)
            error = (
                f"eval dry-run rc={eval_r.returncode}: {eval_r.stderr[:300]}"
                if not dry_run_passed
                else ""
            )

            return SandboxResult(
                patch_applies=True,
                dry_run_passed=dry_run_passed,
                error=error,
            )

        except Exception as e:
            return SandboxResult(patch_applies=False, dry_run_passed=False, error=str(e))

        finally:
            subprocess.run(
                ["git", "worktree", "remove", "--force", str(sandbox_dir)],
                cwd=self.repo_path,
                capture_output=True,
                timeout=15,
            )

    # ── Draft PR creation ─────────────────────────────────────────────────────

    def open_draft_pr(
        self,
        cluster: FailureCluster,
        patch: PatchProposal,
        sandbox: SandboxResult,
    ) -> str | None:
        """Create branch, apply patch, push, open draft PR. Returns PR URL or None."""
        branch = f"auto/fix-{cluster.slug}"
        pr_worktree = Path(tempfile.mkdtemp(prefix=f"fix_pr_{cluster.slug}_"))

        env = os.environ.copy()
        if self.gh_token:
            env["GH_TOKEN"] = self.gh_token
            env["GITHUB_TOKEN"] = self.gh_token

        try:
            # Create new branch worktree from current HEAD
            wt_r = subprocess.run(
                ["git", "worktree", "add", str(pr_worktree), "-b", branch],
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if wt_r.returncode != 0:
                logger.error("git worktree add (PR branch) failed: %s", wt_r.stderr[:200])
                return None

            # Apply patch
            apply_r = subprocess.run(
                ["patch", "-p1", "--forward"],
                input=patch.diff,
                cwd=pr_worktree,
                capture_output=True,
                text=True,
                timeout=15,
            )
            if apply_r.returncode != 0:
                logger.error("Patch apply failed in PR worktree: %s", apply_r.stderr[:200])
                return None

            # Stage and commit
            subprocess.run(
                ["git", "add", "-A"],
                cwd=pr_worktree,
                check=True,
                capture_output=True,
                timeout=15,
            )
            commit_msg = (
                f"auto(fix): propose patch for {cluster.signature} ({len(cluster.members)} fixtures)\n\n"
                f"Cluster signature: {cluster.signature}\n"
                f"Failing fixtures: {', '.join(cluster.scenario_ids)}\n"
                f"Generated by fix_proposer.py (issue #225)\n"
                "Signed-off-by: mira-fix-proposer <fix-proposer@mira.local>"
            )
            subprocess.run(
                ["git", "commit", "-m", commit_msg],
                cwd=pr_worktree,
                check=True,
                capture_output=True,
                text=True,
                timeout=15,
            )

            # Push branch
            push_r = subprocess.run(
                ["git", "push", "origin", branch],
                cwd=pr_worktree,
                capture_output=True,
                text=True,
                timeout=60,
                env=env,
            )
            if push_r.returncode != 0:
                logger.error("git push failed: %s", push_r.stderr[:300])
                return None

            # Build PR body
            sandbox_summary = (
                "Patch applies cleanly, eval dry-run passed."
                if sandbox.patch_applies and sandbox.dry_run_passed
                else (
                    f"Sandbox issues detected — "
                    f"patch_applies={sandbox.patch_applies}, "
                    f"dry_run_passed={sandbox.dry_run_passed}\n"
                    f"```\n{sandbox.error}\n```"
                )
            )
            has_regression = not (sandbox.patch_applies and sandbox.dry_run_passed)
            labels = "auto-generated,needs-human-review,p1"
            if has_regression:
                labels += ",blocked:regression"

            pr_body = (
                f"## Auto-Proposed Fix — `{cluster.signature}`\n\n"
                f"**Cluster:** `{cluster.signature}` | "
                f"**Fixtures:** {len(cluster.members)} | "
                f"**Tags:** {', '.join(cluster.fixture_tags)}\n\n"
                "## Failing Fixtures\n\n"
                + "\n".join(
                    f"- `{m.scenario_id}`: [{m.checkpoint}] {m.reason}"
                    for m in cluster.members
                )
                + f"\n\n## Proposed Patch\n\n```diff\n{patch.diff}\n```\n\n"
                f"## Sandbox Result\n\n{sandbox_summary}\n\n"
                f"_Generated by `fix_proposer.py` — "
                f"model={patch.model}, input_tokens={patch.input_tokens} (issue #225)_\n\n"
                "> **This is a DRAFT PR — do not merge without human review and full live eval.**"
            )

            pr_r = subprocess.run(
                [
                    "gh", "pr", "create",
                    "--draft",
                    "--base", "main",
                    "--head", branch,
                    "--title",
                    f"auto(fix): propose patch for {cluster.signature} ({len(cluster.members)} fixtures)",
                    "--body", pr_body,
                    "--label", labels,
                    "--assignee", "@me",
                ],
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                timeout=60,
                env=env,
            )
            if pr_r.returncode != 0:
                logger.error("gh pr create failed: %s", pr_r.stderr[:300])
                return None

            pr_url = pr_r.stdout.strip()
            logger.info("Opened draft PR: %s", pr_url)
            self._post_pr_comment(pr_url, sandbox, env)
            return pr_url

        except Exception as e:
            logger.error("open_draft_pr failed: %s", e)
            return None

        finally:
            # Remove worktree — branch stays on remote
            subprocess.run(
                ["git", "worktree", "remove", "--force", str(pr_worktree)],
                cwd=self.repo_path,
                capture_output=True,
                timeout=15,
            )

    def _post_pr_comment(self, pr_url: str, sandbox: SandboxResult, env: dict) -> None:
        """Post sandbox test output as a comment on the opened PR."""
        body = (
            "## Sandbox Test Output\n\n"
            f"- **Patch applies cleanly:** {'yes' if sandbox.patch_applies else 'NO'}\n"
            f"- **Eval dry-run passed:** {'yes' if sandbox.dry_run_passed else 'NO'}\n"
        )
        if sandbox.error:
            body += f"\n```\n{sandbox.error}\n```\n"
        body += (
            "\n> Full live eval will run on next nightly cycle. "
            "To verify manually: `python3 tests/eval/run_eval.py`"
        )
        subprocess.run(
            ["gh", "pr", "comment", pr_url, "--body", body],
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )

    # ── Dry-run report ────────────────────────────────────────────────────────

    def dry_run_report(self, clusters: list[FailureCluster], output: Path) -> None:
        """Write cluster detection report to disk without opening any PRs."""
        ts = datetime.now(timezone.utc).isoformat()
        lines = [
            "# Fix Proposer — Dry Run Report",
            f"_Generated: {ts}_",
            f"_min_cluster_size: {self.min_cluster_size}_",
            "",
        ]

        if not clusters:
            lines.append(
                "No clusters reached the min_cluster_size threshold. Nothing to propose."
            )
        else:
            lines.append(f"**{len(clusters)} cluster(s) detected:**\n")
            for c in clusters:
                lines += [
                    f"## Cluster: `{c.signature}`",
                    f"- **Members ({len(c.members)}):** {', '.join(c.scenario_ids)}",
                    f"- **Tags:** {', '.join(c.fixture_tags)}",
                    f"- **Target files:** {', '.join(c.source_files)}",
                    "",
                    "**Sample failure reasons:**",
                ]
                for m in c.members[:3]:
                    lines.append(f"  - `{m.scenario_id}` ({m.run_date}): {m.reason}")
                lines.append("")

        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text("\n".join(lines) + "\n")
        logger.info("Dry-run report written to %s", output)
        print("\n".join(lines))

    # ── Main entry point ──────────────────────────────────────────────────────

    def run(self, days: int = 7, dry_run: bool = False) -> list[str]:
        """Full pipeline: load → cluster → propose → sandbox → PR. Returns PR URLs."""
        if os.getenv("FIX_PROPOSER_DISABLED") == "1":
            logger.info("FIX_PROPOSER_DISABLED=1 — skipping run")
            return []

        records = self.load_recent_scorecards(days=days)
        if not records:
            logger.info("No failure records in last %d day(s) — nothing to propose", days)
            return []

        clusters = self.cluster_failures(records)

        if dry_run:
            # Always write the report in dry-run mode, even if no clusters were found
            self.dry_run_report(clusters, Path("/tmp/fix_proposer_dryrun.md"))
            return []

        if not clusters:
            logger.info(
                "No clusters met min_cluster_size=%d — nothing to propose", self.min_cluster_size
            )
            return []

        pr_urls: list[str] = []
        for cluster in clusters[: self.max_prs]:
            logger.info(
                "Processing cluster: %s (%d members)", cluster.signature, len(cluster.members)
            )
            context = self.gather_repo_context(cluster)
            patch = self.propose_patch(cluster, context)

            if patch is None:
                logger.warning("No patch proposed for %s — skipping PR", cluster.signature)
                continue

            sandbox = self.sandbox_patch(cluster, patch)
            pr_url = self.open_draft_pr(cluster, patch, sandbox)

            if pr_url:
                pr_urls.append(pr_url)

        return pr_urls


# ── CLI ───────────────────────────────────────────────────────────────────────


def main() -> None:
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    _repo_root = Path(__file__).parent.parent.parent
    parser = argparse.ArgumentParser(description="MIRA Fix Proposer — eval failure automation")
    parser.add_argument("--days", type=int, default=7, help="Days of scorecards to scan")
    parser.add_argument("--dry-run", action="store_true", help="Cluster detection only, no PRs")
    parser.add_argument(
        "--scorecards-dir",
        default=str(_repo_root / "tests" / "eval" / "runs"),
    )
    parser.add_argument("--repo-path", default=str(_repo_root))
    args = parser.parse_args()

    gh_token = os.getenv("FIX_PROPOSER_GH_TOKEN", os.getenv("GH_TOKEN", ""))

    proposer = FixProposer(
        scorecards_dir=args.scorecards_dir,
        repo_path=args.repo_path,
        gh_token=gh_token,
    )
    prs = proposer.run(days=args.days, dry_run=args.dry_run)
    if prs:
        print(f"\nOpened {len(prs)} draft PR(s):")
        for url in prs:
            print(f"  {url}")


if __name__ == "__main__":
    main()
