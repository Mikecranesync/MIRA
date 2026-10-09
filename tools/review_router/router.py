#!/usr/bin/env python3
"""Cost-aware routing for the Codex adversarial review lane.

The review ladder (docs/review-cost-ladder.md):
  A. deterministic, $0: every required CI check green at the EXACT head SHA,
     plus the finding->test rule. A known-detectable failure never reaches an LLM.
  B. free pre-filter, $0: tools/gate7_review.py (free cascade), advisory and
     recorded; "unavailable" is recorded too, never silently skipped.
  C. the trusted Codex lane (scripts/adversarial-review-trusted.sh), unchanged,
     on a model chosen by risk tier, escalated only on evidence, inside a
     dollar budget. Usage is captured by codex_shim.sh and priced from
     prices.json.

This module never weakens the gate: GREEN still comes only from the trusted
Codex lane, and critical paths always use the strongest lane at today's
default settings. Stdlib only, so it runs on a clean CI runner.
"""

from __future__ import annotations

import argparse
import fcntl
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _checkout_root() -> Path:
    """The checkout being reviewed is the one you run from (it must be at the
    PR head), not the one this file lives in."""
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], text=True, capture_output=True)
    return (
        Path(out.stdout.strip())
        if out.returncode == 0 and out.stdout.strip()
        else HERE.parent.parent
    )


REPO = _checkout_root()


def default_ledger() -> Path:
    """One cost ledger per REPOSITORY, not per checkout: a worktree shares the
    main checkout's `.git` common dir, so it shares the budget. Keyed to the
    checkout you run from, a fresh worktree started with a fresh $20 (found
    when #4202 round 3 ran from one and reported "spent $0.00")."""
    out = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        text=True,
        capture_output=True,
    )
    home = Path(out.stdout.strip()).parent if out.returncode == 0 and out.stdout.strip() else REPO
    return (home / ".planning" / "review-costs.jsonl").resolve()


PRICES = json.loads((HERE / "prices.json").read_text())["usd_per_mtok"]

TIERS = ("low", "standard", "critical")

# R3 paths from mira-sdlc-v1.md §2.1 (safety, security, auth, tenant, migration,
# production-control, governance floor). Globs capture most but not content-based
# tenant isolation rules; see _has_tenant_isolation_content() below.
CRITICAL_GLOBS = (
    "mira-bots/shared/engine.py",
    "mira-bots/shared/guardrails.py",
    "mira-bots/shared/inference/*",
    "mira-bots/shared/citation_compliance.py",
    "mira-bots/shared/neon_recall.py",
    "mira-bots/shared/tenant/*",
    "mira-bots/shared/integrations/hub_neon.py",
    "mira-sidecar/rag/neon_store.py",
    "mira-core/mira-ingest/db/neon.py",
    "mira-hub/src/capabilities/answer-validation*",
    "mira-hub/src/capabilities/hazard-*",
    "mira-hub/src/capabilities/step-energy*",
    "mira-hub/src/lib/session*",
    "mira-hub/src/lib/safety-classifier*",
    "mira-hub/src/middleware*",
    "mira-hub/public/*",
    "mira-web/public/*",
    "*migrations/*",
    "*auth*",
    "*security*",
    "*safety*",
    "*secret*",
    "scripts/adversarial-review*",
    "scripts/kg_write_guard_allowlist.txt",
    "tools/review_router/*",
    "tools/hooks/*",
    "tools/ui_surface_lifecycle_guard.py",
    "tools/ci/*",
    "tools/staging_receipt.py",
    "tools/migration_drift.py",
    "tools/qa/retrieval_acceptance.py",
    "tools/gate7_review.py",
    "tools/capability_closure.py",
    "tools/release_train.py",
    ".github/*",
    ".github/**/*",
    ".githooks/*",
    "docker-compose*.yml",
    "deployment/nginx*.conf",
    "mira-relay/*",
    "plc/*",
    "claude.md",
    "agents.md",
    "*/claude.md",
    "*/agents.md",
    ".claude/*",
    ".claude/**/*",
    ".ast-grep-rules/*",
    "sgconfig.yml",
    "docs/runbooks/*",
    "docs/adversarial-review-workflow.md",
    "docs/environments.md",
    "docs/versioning.md",
    "docs/architecture/mira-sdlc-v1.md",
    "docs/contracts/contract-index.yaml",
    "docs/architecture/convergence/*.yaml",
    "pyproject.toml",
    "tests/conftest.py",
    "tests/test_capability_closure.py",
    "**/test_*guard*.py",
    "**/test_*gate*.py",
    "**/test_*review*.py",
    "tests/review_router/*",
)
# Only these may ride the cheapest lane: nothing here ships to a technician.
LOW_GLOBS = (
    "tests/*",
    "*/tests/*",
    "*/__tests__/*",
    "*.test.*",
    "docs/*",
    "wiki/*",
    "*.md",
    "tools/qa/*",
)
TEST_GLOBS = ("tests/*", "*/tests/*", "*/__tests__/*", "*.test.*", "test_*.py", "*/test_*.py")

# (model, reasoning effort). None = do not override: the critical lane keeps
# exactly today's behaviour (default model + default effort).
ROUTES: dict[str, tuple[str, str | None]] = {
    "low": ("gpt-5.4-mini", "low"),
    "standard": ("gpt-6.1-sol", "medium"),
    "critical": ("gpt-6-astra", None),
}

# Calibration from two measured gpt-6-astra runs (fixed per-run cost + per char):
#   #4182 r7: $2.80 for a 236,205-char diff;  #4202 r1: $1.60 for 44,700 chars.
_ASTRA_USD_PER_DIFF_CHAR = (2.80 - 1.60) / (236_205 - 44_700)
_ASTRA_FIXED_USD = 1.60 - 44_700 * _ASTRA_USD_PER_DIFF_CHAR
_ESTIMATE_SAFETY = 1.5
_ESTIMATE_FLOOR_USD = 0.05
CROSS_MODULE_THRESHOLD = 3  # distinct top-level dirs of non-test changes


def _match(path: str, globs: tuple[str, ...]) -> bool:
    # Case-insensitive on every platform: the globs are lowercase and
    # fnmatch.fnmatch is case-sensitive on Linux, so a mixed-case security
    # path (mira-mobile/src/screens/SafetyNotice.tsx) must not slide down a tier.
    lowered = path.lower()
    return any(fnmatch.fnmatchcase(lowered, g.lower()) for g in globs)


# Tenant isolation content markers (R3 per mira-sdlc-v1.md §2.1): changed lines
# whose content touches these route critical. Word-boundary, case-insensitive.
# Includes _tenant_id\b to match variants like current_tenant_id.
_TENANT_MARKERS = (
    rb"\bknowledge_entries\b",
    rb"\btenant_id\b",
    rb"_tenant_id\b",
    rb"\bTenantScopedSession\b",
    rb"\bRLS\b",
    rb"\bROW\s+LEVEL\s+SECURITY\b",
    rb"\bCREATE\s+POLICY\b",
    rb"\bTENANT_ID\b",
)

_TENANT_RE = re.compile(b"|".join(_TENANT_MARKERS), re.IGNORECASE)
_MAX_CONTENT_BYTES = 10 * 1024 * 1024  # 10 MB cap


def _read_content_from_commit(sha: str, path: str) -> bytes | None:
    """Read file content from a specific git commit. Returns None if the file
    doesn't exist at that commit (deleted, or never existed). Raises on any
    other error (unreadable, too large, special file). Git cat-file returns
    symlinks as blobs (their target path), not as special files."""
    result = _run(["git", "cat-file", "-e", f"{sha}:{path}"], cwd=REPO)
    if result.returncode != 0:
        return None  # file doesn't exist at this commit
    
    # Check if it's a blob (regular file or symlink target)
    result = _run(["git", "cat-file", "-t", f"{sha}:{path}"], cwd=REPO)
    if result.returncode != 0 or result.stdout.strip() != "blob":
        raise ValueError(f"not a regular file: {path}")
    
    # Read the content as bytes (don't decode as text - might be binary)
    result = subprocess.run(
        ["git", "cat-file", "blob", f"{sha}:{path}"],
        cwd=REPO,
        capture_output=True,
    )
    if result.returncode != 0:
        raise ValueError(f"cannot read {path} from {sha}")
    
    content = result.stdout  # already bytes
    if len(content) > _MAX_CONTENT_BYTES:
        raise ValueError(f"file too large: {len(content)} bytes")
    
    return content


def _is_binary_content(content: bytes) -> bool:
    """Returns True if content appears to be binary (contains NUL bytes)."""
    return b"\x00" in content


def _get_changed_lines(base_sha: str, head_sha: str, path: str) -> bytes:
    """Return only the added and removed lines (hunks) from the diff of path
    between base and head, excluding context lines. This is what a PR actually
    changes, not the surrounding unchanged code. Returns empty bytes for binary
    files."""
    # Check if git considers this a binary diff
    result = _run(["git", "diff", "--numstat", f"{base_sha}..{head_sha}", "--", path], cwd=REPO)
    if result.returncode != 0:
        raise ValueError(f"cannot diff {path}")
    
    numstat = result.stdout.strip()
    if numstat.startswith("-\t-\t"):
        # Binary file: git reports "- -" for added/removed lines
        return b""
    
    # Get diff output as bytes to handle binary content
    result = subprocess.run(
        ["git", "diff", "--no-prefix", f"{base_sha}..{head_sha}", "--", path],
        cwd=REPO,
        capture_output=True,
    )
    if result.returncode != 0:
        raise ValueError(f"cannot diff {path}")
    
    diff_output = result.stdout  # already bytes
    
    # Check for "Binary files differ" message
    if b"Binary files" in diff_output and b"differ" in diff_output:
        return b""
    
    # Extract only + and - lines (added and removed), tracking hunk state
    changed_lines = []
    in_hunk = False
    for line in diff_output.split(b"\n"):
        # Track hunk boundaries from @@ markers
        if line.startswith(b"@@"):
            in_hunk = True
            continue
        
        # Skip file headers (--- and +++ before first @@)
        if not in_hunk:
            continue
        
        # Extract changed lines
        if line.startswith(b"+") and not line.startswith(b"+++"):
            changed_lines.append(line[1:])
        elif line.startswith(b"-") and not line.startswith(b"---"):
            changed_lines.append(line[1:])
    
    return b"\n".join(changed_lines)


def _has_tenant_isolation_content(path: str, base_sha: str, head_sha: str) -> bool:
    """Content-based R3 tenant detection: returns True if the changed lines in
    `path` between base and head contain tenant isolation markers. Reads from
    the git object store at the exact head SHA, never from the working tree.
    
    Fail closed: any read error, oversized file, or special file routes CRITICAL.
    Binary files are treated as having no tenant content (path rules decide).
    Applies markers to changed lines only, so an unrelated edit to a file that
    merely contains tenant_id elsewhere doesn't trigger."""
    try:
        # Try reading from head; if it doesn't exist there, it was deleted
        head_content = _read_content_from_commit(head_sha, path)
        if head_content is None:
            # Deleted file: check base copy for tenant content
            base_content = _read_content_from_commit(base_sha, path)
            if base_content is None:
                # Never existed in either commit: fail closed
                return True
            # Binary deleted files: no tenant content
            if _is_binary_content(base_content):
                return False
            return bool(_TENANT_RE.search(base_content))
        
        # Binary files: no tenant content (path rules decide)
        if _is_binary_content(head_content):
            return False
        
        # File exists at head: check the changed lines (diff hunks)
        changed = _get_changed_lines(base_sha, head_sha, path)
        if not changed:
            # Binary diff or no changes: no tenant content
            return False
        return bool(_TENANT_RE.search(changed))
    except (OSError, ValueError, subprocess.CalledProcessError):
        # Any error: fail closed (route critical)
        return True


def classify(paths: list[str], base_sha: str = "", head_sha: str = "") -> str:
    """Risk tier of a change set. Empty is treated as standard (fail closed).
    
    When base_sha and head_sha are provided, content-based tenant detection
    reads from those commits. Without them, content checks are skipped (used
    by tests that don't have commits)."""
    if not paths:
        return "standard"
    # Content-based tenant check: any file with tenant isolation content is R3
    if base_sha and head_sha and any(_has_tenant_isolation_content(p, base_sha, head_sha) for p in paths):
        return "critical"
    if any(_match(p, CRITICAL_GLOBS) for p in paths):
        return "critical"
    if all(_match(p, LOW_GLOBS) for p in paths):
        return "low"
    return "standard"


def cross_module(paths: list[str]) -> bool:
    tops = {p.split("/", 1)[0] for p in paths if not _match(p, TEST_GLOBS)}
    return len(tops) >= CROSS_MODULE_THRESHOLD


def escalate(
    tier: str,
    *,
    speculative: int = 0,
    disagreement: bool = False,
    cross_module_change: bool = False,
) -> tuple[str, list[str]]:
    """Step up ONE tier when the evidence says the cheap lane may miss things.
    Never steps down."""
    reasons = []
    if speculative:
        reasons.append(f"prior round had {speculative} speculative finding(s)")
    if disagreement:
        reasons.append("cheap and deterministic/pre-filter reviewers disagree")
    if cross_module_change:
        reasons.append("change spans several top-level modules")
    if reasons and tier != "critical":
        tier = TIERS[TIERS.index(tier) + 1]
    return tier, reasons


def route(tier: str) -> tuple[str, str | None]:
    model, effort = ROUTES[tier]
    if model not in PRICES:
        raise KeyError(f"no price for {model!r} in prices.json; refusing a cost-invisible run")
    return model, effort


def usage_from_events(text: str) -> dict[str, int]:
    """Sum turn.completed usage across a codex --json event stream."""
    total = {
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "output_tokens": 0,
        "reasoning_output_tokens": 0,
    }
    for line in text.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if isinstance(ev, dict) and ev.get("type") == "turn.completed":
            for k in total:
                total[k] += int((ev.get("usage") or {}).get(k) or 0)
    return total


def cost_usd(model: str, usage: dict[str, int]) -> float:
    """Reasoning tokens are billed as output. They are ADDED to output_tokens
    in case codex reports them separately: an over-count, never an under-count."""
    p = PRICES[model]
    inp = usage.get("input_tokens", 0)
    cached = min(usage.get("cached_input_tokens", 0), inp)
    out = usage.get("output_tokens", 0) + usage.get("reasoning_output_tokens", 0)
    return ((inp - cached) * p["input"] + cached * p["cached_input"] + out * p["output"]) / 1e6


def _price_ratio(model: str) -> float:
    a, m = PRICES["gpt-6-astra"], PRICES[model]
    return max(m[k] / a[k] for k in ("input", "cached_input", "output"))


def estimate_usd(model: str, diff_chars: int, ledger: list[dict]) -> float:
    """Pre-run worst-case estimate: the larger of the price-scaled astra
    calibration (fixed + per-char) and the worst cost this model has actually
    run at, padded by a safety factor. A fixed term matters: a small diff still
    pays the agent's exploration overhead (#4202 r1 cost $1.60 on 44.7k chars)."""
    calibrated = (_ASTRA_FIXED_USD + _ASTRA_USD_PER_DIFF_CHAR * diff_chars) * _price_ratio(model)
    seen = [r["cost_usd"] for r in _runs(ledger) if r.get("model") == model]
    return max(_ESTIMATE_FLOOR_USD, max([calibrated, *seen]) * _ESTIMATE_SAFETY)


def read_ledger(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _runs(ledger: list[dict]) -> list[dict]:
    return [r for r in ledger if r.get("kind", "run") == "run"]


def spent_usd(ledger: list[dict]) -> float:
    """Settled runs plus every reservation with no settling run: an interrupted
    or concurrent run stays charged at its estimate (Codex #4202 F3/F4).
    
    Fails closed: if any row carries a non-finite cost, the total is treated
    as infinite so the budget check refuses."""
    import math
    settled = {r.get("reservation") for r in _runs(ledger)}
    open_res = [r for r in ledger if r.get("kind") == "reservation" and r.get("id") not in settled]
    costs = [r.get("cost_usd", 0.0) for r in _runs(ledger)] + [r["cost_usd"] for r in open_res]
    if any(not math.isfinite(c) for c in costs):
        return float("inf")
    return sum(costs)


def check_budget(
    estimate: float, ledger: list[dict], budget_usd: float, round_ceiling_usd: float
) -> tuple[bool, str]:
    # Reject non-finite or negative values
    import math
    for name, val in [
        ("estimate", estimate),
        ("budget", budget_usd),
        ("round ceiling", round_ceiling_usd),
    ]:
        if not math.isfinite(val):
            return False, f"{name} is not a finite number: {val}"
        if val < 0:
            return False, f"{name} cannot be negative: {val}"
    
    spent = spent_usd(ledger)
    if estimate > round_ceiling_usd:
        return (
            False,
            f"estimate ${estimate:.2f} exceeds the per-round ceiling ${round_ceiling_usd:.2f}",
        )
    if spent + estimate > budget_usd:
        return (
            False,
            f"spent ${spent:.2f} + estimate ${estimate:.2f} exceeds the budget ${budget_usd:.2f}",
        )
    return True, f"ok: spent ${spent:.2f}, estimate ${estimate:.2f}, budget ${budget_usd:.2f}"


def reserve(
    path: Path, estimate: float, budget_usd: float, round_ceiling_usd: float
) -> tuple[bool, str, str | None]:
    """Atomically check the budget AND append a reservation, under an exclusive
    lock, so two concurrent reviews cannot both pass the same balance."""
    import math
    # Reject negative amount
    if estimate < 0:
        return False, f"estimate cannot be negative: {estimate}", None
    if not math.isfinite(estimate):
        return False, f"estimate is not a finite number: {estimate}", None
    
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(str(path) + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ok, why = check_budget(estimate, read_ledger(path), budget_usd, round_ceiling_usd)
        if not ok:
            return False, why, None
        rid = uuid.uuid4().hex
        with path.open("a") as f:
            f.write(
                json.dumps({"kind": "reservation", "id": rid, "cost_usd": round(estimate, 4)})
                + "\n"
            )
        return True, why, rid


def settle(path: Path, rid: str, record: dict) -> None:
    with open(str(path) + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with path.open("a") as f:
            f.write(json.dumps({"kind": "run", "reservation": rid, **record}) + "\n")


def run_cost(
    model: str, usage: dict[str, int], launched: bool, estimate: float
) -> tuple[float, bool]:
    """(cost, usage_unknown). A launched run with no usage record may still
    have spent: charge the estimate rather than a fake zero (Codex #4202 F3).
    A run the shim never launched made no paid call: a proven zero."""
    if not launched:
        return 0.0, False
    if not any(usage.values()):
        return estimate, True
    return cost_usd(model, usage), False


def needs_regression_test(prior_status: str | None, changed_since_prior: list[str]) -> bool:
    """Finding->invariant rule: after a round that found issues, the fix must
    add or change a test before another PAID round is spent on it."""
    if prior_status != "ISSUES_FOUND":
        return False
    return not any(_match(p, TEST_GLOBS) for p in changed_since_prior)


def blocked_by_finding_rule(prior: dict, head: str, changed_files) -> bool:
    """Apply the finding->test rule to the head about to be reviewed. The same
    head as the prior round has, by definition, changed nothing — it is blocked
    without asking git (a re-run at the reviewed head used to skip the rule)."""
    reviewed = prior.get("reviewed_sha")
    if not reviewed:
        return False
    since = [] if reviewed == head else list(changed_files(reviewed, head))
    return needs_regression_test(prior.get("status"), since)


# ---------------------------------------------------------------------------
# Thin process layer (no logic worth testing lives below the dataclass line)


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, text=True, capture_output=True, **kw)


def pr_facts(pr: int) -> dict:
    _run(["git", "fetch", "-q", "origin", f"pull/{pr}/head"], cwd=REPO)
    j = json.loads(
        _run(
            ["gh", "pr", "view", str(pr), "--json", "headRefOid,baseRefName,baseRefOid,files"],
            check=True,
        ).stdout
    )
    _run(["git", "fetch", "-q", "origin", j["baseRefName"]], cwd=REPO)
    base = _run(
        ["git", "merge-base", f"origin/{j['baseRefName']}", j["headRefOid"]], check=True
    ).stdout.strip()
    span = f"{base}..{j['headRefOid']}"
    diff_chars = len(_run(["git", "diff", span], check=True).stdout)
    # Paths come from the captured immutable objects with rename detection OFF,
    # so a rename contributes both its deleted source and its added destination.
    # GitHub's file list names only the destination, which let a renamed
    # engine.py drop out of the critical tier (#4202 F12).
    paths = _run(["git", "diff", "--name-only", "--no-renames", span], check=True).stdout.split()
    return {
        "base_ref": j["baseRefName"],
        "base_sha": j["baseRefOid"],
        "head": j["headRefOid"],
        "merge_base": base,
        "paths": paths,
        "diff_chars": diff_chars,
    }


# The review envelope, as scripts/adversarial-review-ledger.mjs validates it
# (V2 and legacy shapes). A GREEN record that still counts findings is
# malformed there too, and is dropped the same way.
_ENVELOPE_RE = re.compile(
    r"^\[CODEX-ADVERSARIAL-REVIEW\]\r?\n\r?\n```\r?\n"
    r"reviewed_sha: (?P<sha>[0-9a-f]{40})\r?\n"
    r"(?:reviewed_body_sha256: [0-9a-f]{64}\r?\n)?"
    r"base_sha: [^\r\n]+\r?\n"
    r"status: (?P<status>GREEN|ISSUES_FOUND)\r?\n"
    r"review_iteration: [0-9]+\r?\n"
    r"(?:post_cap_human_authorized: true\r?\n)?"
    r"(?:run_id: [0-9a-f]{32}\r?\nreservation_comment_id: [1-9][0-9]*\r?\n)?"
    r"\r?\nBLOCKER: (?P<b>[0-9]+)\r?\nHIGH: (?P<h>[0-9]+)\r?\nMEDIUM: (?P<m>[0-9]+)\r?\n"
    r"LOW: (?P<l>[0-9]+)\r?\nFALSE_POSITIVE: [0-9]+\r?\n```(?:\r?\n|$)"
)


def well_formed_review(body: str | None) -> re.Match | None:
    m = _ENVELOPE_RE.match(body or "")
    if m and m["status"] == "GREEN" and any(int(m[k]) for k in "bhml"):
        return None
    return m


def latest_owner_review(comments: list[dict], viewer: str) -> str | None:
    """Body of the newest WELL-FORMED review comment the authenticated owner
    posted as a User, ordered by immutable comment id: the same trust gate and
    the same envelope validation the review ledger uses. A comment anyone else
    posts can't steer routing, and neither can a truncated, unfenced, or
    self-contradictory one the owner posted after a valid review (#4202 F5)."""
    mine = [
        c
        for c in comments
        if isinstance(c.get("id"), int)
        and (c.get("user") or {}).get("login") == viewer
        and (c.get("user") or {}).get("type") == "User"
        and well_formed_review(str(c.get("body", "")))
    ]
    return max(mine, key=lambda c: c["id"])["body"] if mine else None


def parse_review(body: str | None) -> dict:
    m = well_formed_review(body)
    if not m:
        return {}
    return {
        "status": m["status"],
        "reviewed_sha": m["sha"],
        "speculative": body.count("**Confidence:** speculative"),
    }


def prior_round(pr: int) -> dict:
    viewer = _run(["gh", "api", "user", "--jq", ".login"], check=True).stdout.strip()
    if not re.fullmatch(r"[A-Za-z0-9-]+", viewer):
        raise RuntimeError(f"unexpected GitHub login {viewer!r}")
    lines = _run(
        [
            "gh",
            "api",
            "--paginate",
            f"repos/{{owner}}/{{repo}}/issues/{pr}/comments",
            "--jq",
            ".[] | {id, body, user: {login: .user.login, type: .user.type}}",
        ],
        check=True,
    ).stdout.splitlines()
    return parse_review(latest_owner_review([json.loads(x) for x in lines if x.strip()], viewer))


_RUN_BUCKET = {"success": "pass", "neutral": "pass", "skipped": "skipping", "cancelled": "cancel"}
_STATUS_BUCKET = {"success": "pass", "failure": "fail", "error": "fail", "pending": "pending"}


# Worst first: when one name is reported by both APIs, the worse bucket wins.
_BUCKET_RANK = {"fail": 0, "cancel": 1, "pending": 2, "skipping": 3, "pass": 4}


def buckets_for_sha(check_runs: list[dict], statuses: list[dict]) -> list[dict]:
    """Map the commit's check runs and commit statuses to name/bucket. The
    newest run per name wins (re-runs); an incomplete run is pending. A name
    reported by BOTH APIs (the Legacy UI Lifecycle Guard is) takes the worse
    of the two — a green commit status must never mask a failed check run."""
    runs: dict[str, str] = {}
    for r in sorted(check_runs, key=lambda r: r.get("id", 0)):
        if r.get("status") != "completed":
            runs[r["name"]] = "pending"
        else:
            runs[r["name"]] = _RUN_BUCKET.get(r.get("conclusion") or "", "fail")
    out = dict(runs)
    for st in statuses:  # the combined-status API already returns the latest per context
        b = _STATUS_BUCKET.get(st.get("state") or "", "pending")
        out[st["context"]] = min(b, out.get(st["context"], b), key=_BUCKET_RANK.__getitem__)
    return [{"name": n, "bucket": b} for n, b in out.items()]


def required_checks_state(required: list[str], reported: list[dict]) -> tuple[list[str], list[str]]:
    """Stage A verdict from CI at the exact head: (failed, pending). A required
    context that never reported is PENDING, never OK: it is invisible to a scan
    of reported checks alone."""
    bucket = {c.get("name"): c.get("bucket") for c in reported}
    failed = [n for n in required if bucket.get(n) in ("fail", "cancel")]
    pending = [n for n in required if bucket.get(n) not in ("pass", "skipping", "fail", "cancel")]
    return failed, pending


def deterministic_stage(head_sha: str, base_ref: str) -> tuple[list[str], list[str]]:
    """Stage A = the required CI checks for THIS commit (Codex #4202 F1: never
    "the PR's current head", which can move after routing). CI executes the
    candidate's code; this operator process never does."""
    gh = "repos/{owner}/{repo}"
    required = json.loads(
        _run(
            [
                "gh",
                "api",
                f"{gh}/branches/{base_ref}/protection/required_status_checks",
                "--jq",
                ".contexts",
            ],
            check=True,
        ).stdout
    )
    runs = [
        json.loads(x)
        for x in _run(
            [
                "gh",
                "api",
                "--paginate",
                f"{gh}/commits/{head_sha}/check-runs",
                "--jq",
                ".check_runs[] | {id, name, status, conclusion}",
            ],
            check=True,
        ).stdout.splitlines()
        if x.strip()
    ]
    statuses = [
        json.loads(x)
        for x in _run(
            [
                "gh",
                "api",
                f"{gh}/commits/{head_sha}/status",
                "--jq",
                ".statuses[] | {context, state}",
            ],
            check=True,
        ).stdout.splitlines()
        if x.strip()
    ]
    return required_checks_state(required, buckets_for_sha(runs, statuses))


TOOLING = (
    "tools/review_router/router.py",
    "tools/review_router/codex_shim.sh",
    "tools/review_router/prices.json",
    "tools/gate7_review.py",
)


def untrusted_tooling(base_ref: str) -> list[str]:
    """Files of THIS router that differ from the base branch. Like the trusted
    review script, routing tooling is authoritative only as committed on the
    base; a candidate-local copy (e.g. a PR's own shim) must not run."""
    bad = []
    for rel in TOOLING:
        base_blob = _run(["git", "rev-parse", f"origin/{base_ref}:{rel}"], cwd=REPO).stdout.strip()
        here_blob = _run(["git", "hash-object", str(HERE.parent.parent / rel)]).stdout.strip()
        if not base_blob or base_blob != here_blob:
            bad.append(rel)
    return bad


def router_on_base(base_ref: str) -> bool:
    """Is this router committed on the base branch at all?"""
    rel = "tools/review_router/router.py"
    return bool(_run(["git", "rev-parse", f"origin/{base_ref}:{rel}"], cwd=REPO).stdout.strip())


def tooling_refusal(drift: list[str], *, bootstrap: bool, router_on_base: bool) -> str | None:
    """Why a run must not proceed on this tooling, or None. `--bootstrap` is
    honoured ONLY while the router is absent from the base: once it is on
    main, a candidate-local router/shim/price table never runs, flag or not."""
    if not drift:
        return None
    if bootstrap and not router_on_base:
        return None
    if bootstrap:
        return (
            "--bootstrap is honoured only while the router is absent from the base; "
            f"it is on the base now — run from a checkout of the base branch ({', '.join(drift)})"
        )
    return f"router tooling differs from the base: {', '.join(drift)} (run it from a checkout of the base branch)"


_VERDICT_RE = re.compile(r"^\*\*Verdict:\*\* (PASS|BLOCK|UNKNOWN)\b", re.M)


def free_prefilter(pr: int, out_dir: Path, base_sha: str) -> dict:
    """Stage B: the free-cascade Gate 7 reviewer, advisory. Its verdict and
    finding count are recorded; an unavailable cascade is recorded as such,
    never as a pass. It does not block: free models false-positive (e.g. on
    their own redaction), so the paid gate still decides.

    It executes from a detached checkout of the CAPTURED BASE SHA — the same
    immutable tree the trusted review entrypoint runs from — never from the
    caller's checkout, which may be the candidate itself. The candidate is
    reached only as git objects via `gh pr diff` (#4202 F8). A missing
    `doppler`/python is advisory unavailability, not a crash (#4202 F9)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out = (out_dir / f"gate7-{pr}-{int(time.time())}.md").resolve()
    wt = Path(tempfile.mkdtemp(prefix="mira-review-prefilter.")) / "trusted-base"
    try:
        add = _run(["git", "worktree", "add", "-q", "--detach", str(wt), base_sha], cwd=REPO)
        if add.returncode != 0:
            return {"prefilter": "unavailable", "prefilter_error": add.stderr.strip()[-300:]}
        try:
            r = _run(
                [
                    "doppler",
                    "run",
                    "--project",
                    "factorylm",
                    "--config",
                    "dev",
                    "--",
                    sys.executable,
                    str(wt / "tools" / "gate7_review.py"),
                    str(pr),
                    "-o",
                    str(out),
                ],
                cwd=wt,
            )
        except OSError as e:  # the executable itself is missing (no Doppler here)
            return {
                "prefilter": "unavailable",
                "prefilter_error": f"{e.filename or 'doppler'}: {e}",
            }
    finally:
        _run(["git", "worktree", "remove", "--force", str(wt)], cwd=REPO)
        shutil.rmtree(wt.parent, ignore_errors=True)
    if r.returncode != 0 or not out.exists():
        return {"prefilter": "unavailable", "prefilter_rc": r.returncode}
    text = out.read_text()
    # gate7 writes `**Verdict:** UNKNOWN` (exit 0) when the free model gave no
    # parseable verdict; only an explicit PASS may be recorded as PASS (#4202 F11).
    m = _VERDICT_RE.search(text)
    verdict = m[1] if m else "unavailable"
    return {
        "prefilter": verdict,
        "prefilter_findings": text.count("\n- **["),
        "prefilter_report": str(out),
    }


def main(argv: list[str] | None = None) -> int:
    def _positive_finite_float(val: str) -> float:
        """Argparse type that validates budgets are finite and non-negative."""
        import math
        try:
            f = float(val)
        except ValueError as e:
            raise argparse.ArgumentTypeError(f"invalid float: {val!r}") from e
        if not math.isfinite(f):
            raise argparse.ArgumentTypeError(f"budget must be finite, got {val}")
        if f < 0:
            raise argparse.ArgumentTypeError(f"budget cannot be negative, got {val}")
        return f
    
    # Validate env-var defaults before argparse sees them
    def _validated_env_default(key: str, default: str) -> float:
        val = os.getenv(key, default)
        try:
            return _positive_finite_float(val)
        except argparse.ArgumentTypeError as e:
            raise ValueError(f"invalid {key} from environment: {e}") from e

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("pr", type=int)
    ap.add_argument(
        "--plan", action="store_true", help="print the route and estimate; spend nothing"
    )
    ap.add_argument("--budget-usd", type=_positive_finite_float, default=_validated_env_default("REVIEW_BUDGET_USD", "20"))
    ap.add_argument(
        "--round-ceiling-usd", type=_positive_finite_float, default=_validated_env_default("REVIEW_ROUND_CEILING_USD", "3")
    )
    ap.add_argument(
        "--ledger",
        type=Path,
        default=None,
        help="cost ledger (default: REVIEW_COST_LEDGER, else the repository's "
        ".planning/review-costs.jsonl shared by every worktree)",
    )
    ap.add_argument(
        "--disagreement", action="store_true", help="reviewers conflict: escalate one tier"
    )
    ap.add_argument("--authorized", action="store_true", help="owner-authorized post-cap round")
    ap.add_argument("--no-prefilter", action="store_true", help="skip the free stage-B pre-filter")
    ap.add_argument(
        "--bootstrap",
        action="store_true",
        help="allow router files that differ from the base; honoured only while the base has no router at all (refused once it is on main)",
    )
    args = ap.parse_args(argv)
    # Resolve against the invocation directory NOW: the trusted runner chdirs
    # into the producer checkout and the shim writes usage/.started relative to
    # its cwd, so a relative ledger would strand the proof of spend there and a
    # launched run would be recorded as an unlaunched $0 (#4202 F10).
    args.ledger = (
        args.ledger or Path(os.getenv("REVIEW_COST_LEDGER") or default_ledger())
    ).resolve()
    args.ledger.parent.mkdir(parents=True, exist_ok=True)

    facts, prior = pr_facts(args.pr), prior_round(args.pr)
    tier, reasons = escalate(
        classify(facts["paths"], facts["merge_base"], facts["head"]),
        speculative=prior.get("speculative", 0),
        disagreement=args.disagreement,
        cross_module_change=cross_module(facts["paths"]),
    )
    model, effort = route(tier)
    est = estimate_usd(model, facts["diff_chars"], read_ledger(args.ledger))
    _ok, why = check_budget(est, read_ledger(args.ledger), args.budget_usd, args.round_ceiling_usd)
    plan = {
        "pr": args.pr,
        "head": facts["head"][:9],
        "tier": tier,
        "escalation": reasons,
        "model": model,
        "effort": effort or "default",
        "diff_chars": facts["diff_chars"],
        "estimate_usd": round(est, 2),
        "budget": why,
    }
    print(json.dumps(plan))
    if args.plan:
        return 0

    def refuse(msg: str) -> int:
        print("REFUSED: " + msg, file=sys.stderr)
        return 3

    if msg := tooling_refusal(
        untrusted_tooling(facts["base_ref"]),
        bootstrap=args.bootstrap,
        router_on_base=router_on_base(facts["base_ref"]),
    ):
        return refuse(msg)
    failed, pending = deterministic_stage(facts["head"], facts["base_ref"])
    if failed or pending:
        return refuse(
            f"required CI is not green at {facts['head'][:9]} failed={failed} pending={pending}"
        )
    if blocked_by_finding_rule(
        prior,
        facts["head"],
        lambda a, b: _run(["git", "diff", "--name-only", f"{a}..{b}"], cwd=REPO).stdout.split(),
    ):
        return refuse(
            "the previous round found issues and no test changed since; "
            "turn each fixed finding into a regression test first"
        )

    pre = (
        {} if args.no_prefilter else free_prefilter(args.pr, args.ledger.parent, facts["base_sha"])
    )
    if pre:
        print(json.dumps(pre))

    ok, why, rid = reserve(args.ledger, est, args.budget_usd, args.round_ceiling_usd)
    if not ok:
        return refuse(why)
    usage_file = args.ledger.parent / f"usage-{args.pr}-{facts['head'][:9]}-{rid[:8]}.jsonl"
    env = dict(
        os.environ,
        CODEX_BIN=str(HERE / "codex_shim.sh"),
        CODEX_MODEL=model,
        REVIEW_USAGE_FILE=str(usage_file),
        REVIEW_EFFORT=effort or "",
        REVIEW_EXPECTED_HEAD=facts["head"],
        REVIEW_EXPECTED_BASE=facts["base_sha"],
    )
    # Strip test-only escape hatches from the environment so only tests that
    # call the shim directly can set them, never via the operator's environment.
    env.pop("REVIEW_SKIP_SNAPSHOT_CHECK", None)
    # Remove any inherited human authorization flag; set only when explicitly passed
    env.pop("ADV_REVIEW_HUMAN_AUTHORIZED", None)
    if args.authorized:
        env["ADV_REVIEW_HUMAN_AUTHORIZED"] = "1"
    trusted = _run(
        ["git", "show", f"origin/{facts['base_ref']}:scripts/adversarial-review-trusted.sh"],
        cwd=REPO,
        check=True,
    ).stdout
    rc = subprocess.run(
        ["bash", "-s", "--", str(args.pr), "--review-only"],
        input=trusted,
        text=True,
        env=env,
        cwd=REPO,
    ).returncode

    usage = usage_from_events(usage_file.read_text() if usage_file.exists() else "")
    launched = Path(str(usage_file) + ".started").exists()
    cost, unknown = run_cost(model, usage, launched, est)
    record = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pr": args.pr,
        "head": facts["head"],
        "base": facts["base_sha"],
        "tier": tier,
        "model": model,
        "effort": effort or "default",
        "diff_chars": facts["diff_chars"],
        **usage,
        "estimate_usd": round(est, 4),
        "cost_usd": round(cost, 4),
        "usage_unknown": unknown,
        "launched": launched,
        "review_rc": rc,
        **{k: v for k, v in pre.items() if k != "prefilter_report"},
    }
    settle(args.ledger, rid, record)
    print(
        json.dumps(
            {
                k: record[k]
                for k in (
                    "model",
                    "input_tokens",
                    "cached_input_tokens",
                    "output_tokens",
                    "reasoning_output_tokens",
                    "cost_usd",
                    "usage_unknown",
                )
            }
        )
    )
    return rc


if __name__ == "__main__":
    sys.exit(main())
