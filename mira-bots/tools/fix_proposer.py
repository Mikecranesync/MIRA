"""fix_proposer.py — Eval failure clusters → Claude-drafted patch → draft PR.

Runs after the nightly eval. Loads the latest scorecard, clusters failing
scenarios by failure mode (checkpoint + reason-prefix), and for each cluster
of 3+ failures, asks Claude to propose a minimal patch to the relevant
prompt rules or fixture. Opens a draft GitHub PR with the proposed change
and the failure cluster as evidence.

**No auto-merge.** Mike reviews every draft PR before it lands.

This is the autoresearch pattern's "fix proposal" step: when the eval
surfaces a reproducible failure pattern, the system proposes the patch so
the human only has to review, not investigate.

Usage (dry-run — no PR opened):
    python fix_proposer.py --dry-run --runs-dir tests/eval/runs

Environment:
    FIX_PROPOSER_GH_TOKEN         GitHub PAT (contents:write + pull_requests:write)
    ANTHROPIC_API_KEY             Claude API key
    CLAUDE_MODEL                  Model override (default: claude-sonnet-4-6)
    FIX_PROPOSER_DISABLED         Set to "1" to disable
    FIX_PROPOSER_STATE_PATH       State JSON (default: /opt/mira/data/fix_proposer_state.json)
    FIX_PROPOSER_MIN_CLUSTER      Min failures per cluster to propose a fix (default: 3)
    FIX_PROPOSER_MAX_CLUSTERS     Max clusters per run (default: 3)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx

logger = logging.getLogger("mira-fix-proposer")

REPO = "Mikecranesync/MIRA"
_ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
_DEFAULT_MODEL = "claude-sonnet-4-6"


# ── Parsing: scorecard .md → failing scenarios ──────────────────────────────

# Scorecard Failures section:
#   ### scenario_id
#   - **cp_name** FAILED: <reason>
#   - Last response: `...`
_FAILURE_HEADER_RE = re.compile(r"^### (?P<scenario_id>[\w_-]+)\s*$")
_FAILURE_LINE_RE = re.compile(
    r"^\s*-\s+\*\*(?P<checkpoint>cp_\w+)\*\*\s+FAILED:\s*(?P<reason>.+?)\s*$"
)


@dataclass
class FailureRecord:
    """A single failing checkpoint within a scenario."""

    scenario_id: str
    checkpoint: str
    reason: str


def parse_scorecard(md_path: Path) -> list[FailureRecord]:
    """Extract failing (scenario, checkpoint, reason) tuples from a scorecard .md."""
    failures: list[FailureRecord] = []
    try:
        text = md_path.read_text()
    except OSError as e:
        logger.error("Cannot read %s: %s", md_path, e)
        return failures

    # Only parse lines after the "## Failures" section
    in_failures = False
    current_scenario: str | None = None
    for raw_line in text.splitlines():
        if raw_line.strip().startswith("## Failures"):
            in_failures = True
            continue
        if in_failures and raw_line.strip().startswith("## "):
            # Next top-level section — failures done
            break
        if not in_failures:
            continue

        hdr = _FAILURE_HEADER_RE.match(raw_line)
        if hdr:
            current_scenario = hdr.group("scenario_id")
            continue

        fail = _FAILURE_LINE_RE.match(raw_line)
        if fail and current_scenario:
            failures.append(
                FailureRecord(
                    scenario_id=current_scenario,
                    checkpoint=fail.group("checkpoint"),
                    reason=fail.group("reason"),
                )
            )

    return failures


def find_latest_scorecard(runs_dir: Path) -> Path | None:
    """Return the newest scorecard .md file in runs_dir."""
    if not runs_dir.exists():
        return None
    candidates = sorted(runs_dir.glob("*.md"), reverse=True)
    # Prefer judge-enabled runs (they have more signal)
    judge_first = [c for c in candidates if "judge" in c.stem]
    return (judge_first or candidates)[0] if (judge_first or candidates) else None


# ── Clustering: group failures by signature ─────────────────────────────────


def _reason_signature(reason: str, max_chars: int = 40) -> str:
    """Normalize a failure reason to a cluster key.

    Strips scenario-specific details (quoted strings, numbers, brackets) and
    keeps the stable prefix so the same failure mode in different scenarios
    clusters together.
    """
    # Remove quoted strings and brackets
    s = re.sub(r"['\"].*?['\"]", "STR", reason)
    s = re.sub(r"\[.*?\]", "LIST", s)
    s = re.sub(r"\{.*?\}", "DICT", s)
    # Remove numbers
    s = re.sub(r"\b\d+\b", "N", s)
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s[:max_chars]


@dataclass
class FailureCluster:
    """Group of failures that share the same checkpoint + reason signature."""

    checkpoint: str
    reason_signature: str
    failures: list[FailureRecord] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.failures)

    @property
    def cluster_id(self) -> str:
        # Stable ID for branch naming / PR titles
        slug = re.sub(r"[^a-z0-9]+", "-", self.reason_signature).strip("-")[:30]
        return f"{self.checkpoint}-{slug}"


def cluster_failures(failures: list[FailureRecord], min_size: int = 3) -> list[FailureCluster]:
    """Group failures by (checkpoint, reason-signature). Return clusters ≥ min_size."""
    groups: dict[tuple[str, str], list[FailureRecord]] = defaultdict(list)
    for f in failures:
        key = (f.checkpoint, _reason_signature(f.reason))
        groups[key].append(f)

    clusters = [
        FailureCluster(checkpoint=cp, reason_signature=sig, failures=fs)
        for (cp, sig), fs in groups.items()
        if len(fs) >= min_size
    ]
    # Largest clusters first — they're the most impactful to fix
    clusters.sort(key=lambda c: -c.size)
    return clusters


# ── LLM patch proposal ──────────────────────────────────────────────────────


_PATCH_SYSTEM = """\
You are a MIRA eval fix-proposer. A cluster of eval scenarios fail the same
checkpoint for the same reason. Propose a minimal, targeted fix.

Scope of allowed fixes:
- Modify rules in mira-bots/prompts/diagnose/active.yaml (the system prompt)
- Modify or add entries in mira-bots/shared/guardrails.py (keyword lists, etc.)
- Correct a test fixture's expected_keywords or forbidden_keywords if the
  fixture was over-specified

Do NOT propose:
- Changes to engine.py, workers/, or inference/router.py (risk too high for auto-proposals)
- Large refactors or new features
- Changes spanning more than 2 files
- Changes to more than one cluster's root cause (one PR = one fix)

Return ONLY valid JSON — no commentary outside the JSON:
{
  "hypothesis": "One-sentence root-cause hypothesis.",
  "file_path": "relative path from repo root, e.g. mira-bots/prompts/diagnose/active.yaml",
  "change_type": "edit" | "add-rule" | "fixture-correction",
  "rationale": "2-3 sentences explaining why this fix addresses the cluster.",
  "proposed_patch": "The exact text to add/modify. For YAML, include the full new/modified key.",
  "projected_impact": "Which scenarios in the cluster this should convert from FAIL to PASS, and why.",
  "confidence": 0.0 to 1.0
}"""

_PATCH_USER = """\
Failure cluster:
  checkpoint: {checkpoint}
  reason signature: {signature}
  failing scenarios ({count}):
{scenario_list}

Sample raw failure reasons:
{sample_reasons}

Relevant repo context:
{repo_context}

Propose a minimal fix."""


def _build_repo_context(cluster: FailureCluster, repo_root: Path) -> str:
    """Return a short blurb of relevant file snippets for the LLM prompt."""
    parts: list[str] = []
    # For cp_keyword_match failures — include guardrails keyword lists
    if cluster.checkpoint == "cp_keyword_match":
        gr = repo_root / "mira-bots" / "shared" / "guardrails.py"
        if gr.exists():
            snippet = gr.read_text()[:2000]
            parts.append(f"--- guardrails.py (first 2000 chars) ---\n{snippet}")

    # For cp_reached_state failures — include FSM state list from engine
    if cluster.checkpoint == "cp_reached_state":
        eng = repo_root / "mira-bots" / "shared" / "engine.py"
        if eng.exists():
            text = eng.read_text()
            idx = text.find("STATE_ORDER")
            if idx >= 0:
                parts.append(f"--- engine.py:STATE_ORDER ---\n{text[idx : idx + 500]}")

    # Always include active prompt rules
    prompt = repo_root / "mira-bots" / "prompts" / "diagnose" / "active.yaml"
    if prompt.exists():
        parts.append(f"--- active.yaml ---\n{prompt.read_text()[:3000]}")

    return "\n\n".join(parts) if parts else "(no repo context available)"


# ── FixProposer class ───────────────────────────────────────────────────────


@dataclass
class FixProposerConfig:
    anthropic_api_key: str
    gh_token: str
    repo_root: Path
    state_path: Path
    runs_dir: Path
    claude_model: str = _DEFAULT_MODEL
    min_cluster_size: int = 3
    max_clusters_per_run: int = 3
    repo: str = REPO


class FixProposer:
    """Turn eval failure clusters into draft PR proposals."""

    def __init__(self, config: FixProposerConfig) -> None:
        self.cfg = config

    # ── State management ────────────────────────────────────────────────────

    def _load_state(self) -> dict:
        if self.cfg.state_path.exists():
            try:
                return json.loads(self.cfg.state_path.read_text())
            except Exception:
                pass
        return {"last_run_ts": None, "clusters_proposed": []}

    def _save_state(self, state: dict) -> None:
        self.cfg.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.cfg.state_path.write_text(json.dumps(state, indent=2))

    # ── Claude API ──────────────────────────────────────────────────────────

    async def _claude_json(self, system: str, user: str) -> dict | None:
        """Call Claude, return parsed JSON or None on failure."""
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    _ANTHROPIC_API,
                    headers={
                        "x-api-key": self.cfg.anthropic_api_key,
                        "anthropic-version": "2023-06-01",
                        "anthropic-beta": "prompt-caching-2024-07-31",
                        "content-type": "application/json",
                    },
                    json={
                        "model": self.cfg.claude_model,
                        "max_tokens": 2048,
                        "system": [
                            {
                                "type": "text",
                                "text": system,
                                "cache_control": {"type": "ephemeral"},
                            },
                        ],
                        "messages": [{"role": "user", "content": user}],
                    },
                )
                resp.raise_for_status()
                text = resp.json()["content"][0]["text"].strip()
                text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.DOTALL)
                return json.loads(text)
        except httpx.HTTPStatusError as e:
            logger.error("Claude HTTP %s: %s", e.response.status_code, e.response.text[:200])
        except json.JSONDecodeError as e:
            logger.error("Claude returned non-JSON: %s", e)
        except Exception as e:
            logger.error("Claude call failed: %s", e)
        return None

    async def propose_fix(self, cluster: FailureCluster) -> dict | None:
        """Ask Claude to propose a patch for a failure cluster."""
        scenario_list = "\n".join(f"    - {f.scenario_id}" for f in cluster.failures[:10])
        sample_reasons = "\n".join(f"    - {f.reason}" for f in cluster.failures[:5])
        repo_context = _build_repo_context(cluster, self.cfg.repo_root)

        user_msg = _PATCH_USER.format(
            checkpoint=cluster.checkpoint,
            signature=cluster.reason_signature,
            count=cluster.size,
            scenario_list=scenario_list,
            sample_reasons=sample_reasons,
            repo_context=repo_context,
        )

        return await self._claude_json(_PATCH_SYSTEM, user_msg)

    # ── PR creation ─────────────────────────────────────────────────────────

    def open_draft_pr(self, cluster: FailureCluster, patch: dict) -> str | None:
        """Open a draft PR with the proposed patch. Returns PR URL or None."""
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        branch = f"auto/fix-proposal-{date_str}-{cluster.cluster_id}"[:80]
        pr_title = (
            f"auto: fix-proposal for {cluster.checkpoint} cluster "
            f"({cluster.size} failing scenarios)"
        )

        scenarios_table = "\n".join(
            f"| `{f.scenario_id}` | `{f.checkpoint}` | {f.reason[:80]} |" for f in cluster.failures
        )
        pr_body = f"""\
## Auto-generated fix proposal

**Hypothesis:** {patch.get("hypothesis", "(none)")}

**Confidence:** {patch.get("confidence", 0.0):.2f}

### Failure cluster ({cluster.size} scenarios)

| Scenario | Checkpoint | Reason |
|---|---|---|
{scenarios_table}

### Proposed change

**File:** `{patch.get("file_path", "(none)")}`
**Type:** `{patch.get("change_type", "edit")}`

**Rationale:** {patch.get("rationale", "(none)")}

**Projected impact:** {patch.get("projected_impact", "(none)")}

### Patch

```
{patch.get("proposed_patch", "(no patch)")}
```

### Review checklist
- [ ] Patch fixes the failure cluster without regressing other scenarios
- [ ] Change is scoped (single file, no side-effects)
- [ ] Rationale matches the actual root cause
- [ ] Run eval locally before merging: `python tests/eval/run_eval.py`

---
*Auto-generated by `fix_proposer.py`. No auto-merge — human review required.*
"""

        worktree_dir = tempfile.mkdtemp(prefix="mira-fix-proposer-")
        try:

            def _run(cmd: list[str], cwd: str, check: bool = True) -> subprocess.CompletedProcess:
                return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=check)

            _run(
                ["git", "worktree", "add", "-b", branch, worktree_dir, "HEAD"],
                str(self.cfg.repo_root),
            )

            # Write a small marker file so the branch has a commit even if
            # the LLM-proposed patch can't be applied programmatically.
            # The human reviews the PR body for the actual change.
            notes_path = Path(worktree_dir) / "docs" / "fix-proposals"
            notes_path.mkdir(parents=True, exist_ok=True)
            proposal_file = notes_path / f"{date_str}-{cluster.cluster_id}.md"
            proposal_file.write_text(pr_body)

            _run(["git", "add", str(proposal_file.relative_to(worktree_dir))], worktree_dir)
            _run(
                [
                    "git",
                    "commit",
                    "-m",
                    f"auto: fix proposal for {cluster.checkpoint} cluster "
                    f"({cluster.size} scenarios)\n\n"
                    f"Signed-off-by: mira-fix-proposer <eval@mira.local>",
                ],
                worktree_dir,
            )

            env = {**os.environ, "GH_TOKEN": self.cfg.gh_token}
            push_r = subprocess.run(
                ["git", "push", "-u", "origin", branch],
                cwd=worktree_dir,
                capture_output=True,
                text=True,
                env=env,
            )
            if push_r.returncode != 0:
                logger.error("git push failed: %s", push_r.stderr[:300])
                return None

            pr_r = subprocess.run(
                [
                    "gh",
                    "pr",
                    "create",
                    "--draft",
                    "--title",
                    pr_title,
                    "--body",
                    pr_body,
                    "--repo",
                    self.cfg.repo,
                ],
                cwd=worktree_dir,
                capture_output=True,
                text=True,
                env=env,
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
                cwd=str(self.cfg.repo_root),
                capture_output=True,
            )

    # ── Orchestrator ────────────────────────────────────────────────────────

    async def run(self, dry_run: bool = False) -> dict:
        """Main pipeline: scorecard → clusters → patches → PRs."""
        run_ts = datetime.now(timezone.utc).isoformat()

        scorecard = find_latest_scorecard(self.cfg.runs_dir)
        if not scorecard:
            logger.warning("No scorecard found in %s", self.cfg.runs_dir)
            return {"status": "ok", "reason": "no_scorecard", "ts": run_ts}

        failures = parse_scorecard(scorecard)
        if not failures:
            logger.info("No failures in %s — nothing to propose", scorecard)
            return {
                "status": "ok",
                "reason": "no_failures",
                "scorecard": str(scorecard),
                "ts": run_ts,
            }

        clusters = cluster_failures(failures, self.cfg.min_cluster_size)
        if not clusters:
            logger.info("No clusters ≥%d failures — nothing to propose", self.cfg.min_cluster_size)
            return {
                "status": "ok",
                "reason": "no_clusters",
                "failures_total": len(failures),
                "ts": run_ts,
            }

        logger.info(
            "Found %d failure clusters (processing top %d)",
            len(clusters),
            self.cfg.max_clusters_per_run,
        )

        pr_urls: list[str] = []
        proposals: list[dict] = []
        for cluster in clusters[: self.cfg.max_clusters_per_run]:
            logger.info(
                "Proposing fix for cluster %s (%d scenarios)", cluster.cluster_id, cluster.size
            )
            patch = await self.propose_fix(cluster)
            if not patch:
                logger.warning("No patch generated for %s", cluster.cluster_id)
                continue

            proposal = {
                "cluster_id": cluster.cluster_id,
                "size": cluster.size,
                "checkpoint": cluster.checkpoint,
                "hypothesis": patch.get("hypothesis", ""),
                "confidence": patch.get("confidence", 0.0),
            }
            proposals.append(proposal)

            if dry_run:
                logger.info("DRY-RUN: would open PR for %s", cluster.cluster_id)
                continue

            pr_url = self.open_draft_pr(cluster, patch)
            if pr_url:
                pr_urls.append(pr_url)
                proposal["pr_url"] = pr_url

        self._save_state({"last_run_ts": run_ts, "proposals": proposals})

        return {
            "status": "ok",
            "scorecard": str(scorecard),
            "failures_total": len(failures),
            "clusters_found": len(clusters),
            "proposals": proposals,
            "pr_urls": pr_urls,
            "ts": run_ts,
        }


# ── CLI entry point ─────────────────────────────────────────────────────────


def _build_proposer() -> FixProposer:
    return FixProposer(
        FixProposerConfig(
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
            gh_token=os.getenv("FIX_PROPOSER_GH_TOKEN", ""),
            repo_root=Path(os.getenv("MIRA_DIR", "/opt/mira")),
            state_path=Path(
                os.getenv("FIX_PROPOSER_STATE_PATH", "/opt/mira/data/fix_proposer_state.json")
            ),
            runs_dir=Path(os.getenv("FIX_PROPOSER_RUNS_DIR", "/opt/mira/tests/eval/runs")),
            claude_model=os.getenv("CLAUDE_MODEL", _DEFAULT_MODEL),
            min_cluster_size=int(os.getenv("FIX_PROPOSER_MIN_CLUSTER", "3")),
            max_clusters_per_run=int(os.getenv("FIX_PROPOSER_MAX_CLUSTERS", "3")),
        )
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="MIRA eval fix-proposal automation")
    parser.add_argument(
        "--dry-run", action="store_true", help="Print proposals without opening PRs"
    )
    parser.add_argument("--runs-dir", type=Path, help="Override runs directory")
    args = parser.parse_args()

    proposer = _build_proposer()
    if args.runs_dir:
        proposer.cfg.runs_dir = args.runs_dir

    result = asyncio.run(proposer.run(dry_run=args.dry_run))
    print(json.dumps(result, indent=2))
