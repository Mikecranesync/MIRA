"""Privacy and repository safeguard guard tests (W5).

Deterministic, hermetic checks that git state obeys confidentiality and
labeling constraints. Runs in CI where the confidential local dir does not exist.
Each check documents its failure mode.
"""

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path


def _get_repo_root() -> Path:
    """Derive repo root from __file__ by traversing parents."""
    current = Path(__file__).resolve()
    while current != current.parent:
        if (current / ".git").exists():
            return current
        current = current.parent
    raise RuntimeError("Cannot find repo root (no .git dir found)")


def _run_git(args: list[str], cwd: Path) -> str:
    """Run git command; return stdout as string."""
    result = subprocess.run(
        ["git"] + args,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def test_1_no_tracked_images():
    """Check 1: No image files tracked anywhere under printsense/.

    Failure mode: a .jpg/.jpeg/.png/.webp/.gif is in git ls-files.
    """
    repo_root = _get_repo_root()
    output = _run_git(["ls-files", "-z"], repo_root)
    tracked_files = [f for f in output.split("\0") if f]

    image_extensions = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    image_files = [
        f
        for f in tracked_files
        if f.startswith("printsense/") and Path(f).suffix.lower() in image_extensions
    ]

    assert (
        not image_files
    ), f"Found tracked image files under printsense/: {image_files}"


def test_2_gitignore_patterns():
    """Check 2: printsense/benchmarks/.gitignore contains required patterns.

    Failure mode: .gitignore is missing _eval_inputs/, *.jpg, *.jpeg, *.png.
    """
    repo_root = _get_repo_root()
    gitignore_path = repo_root / "printsense" / "benchmarks" / ".gitignore"

    assert gitignore_path.exists(), f".gitignore not found at {gitignore_path}"

    content = gitignore_path.read_text()
    required_patterns = ["_eval_inputs/", "*.jpg", "*.jpeg", "*.png"]

    for pattern in required_patterns:
        assert (
            pattern in content
        ), f"Required pattern '{pattern}' not found in {gitignore_path}"


def test_3_untracked_underscored_dirs_ignored():
    """Check 3: Every untracked underscore-prefixed dir under printsense/benchmarks/
    that exists locally is FULLY git-ignored.

    Failure mode: git check-ignore returns false for a file in such a dir.
    Skipped if no untracked underscore dirs exist locally.
    """
    repo_root = _get_repo_root()
    benchmarks_dir = repo_root / "printsense" / "benchmarks"

    if not benchmarks_dir.exists():
        return  # Skip if the directory doesn't exist

    # Get all tracked files to identify which underscored dirs are truly untracked
    output = _run_git(["ls-files", "-z"], repo_root)
    tracked_files = {f for f in output.split("\0") if f}

    # Find all underscore-prefixed directories locally
    underscored_dirs = []
    try:
        for item in benchmarks_dir.iterdir():
            if item.is_dir() and item.name.startswith("_"):
                underscored_dirs.append(item)
    except (OSError, PermissionError):
        pass  # Skip on access errors

    if not underscored_dirs:
        import pytest
        pytest.skip("No untracked underscore-prefixed directories found locally")

    # For each underscore dir, check if it is UNTRACKED (has no tracked files)
    untracked_dirs = []
    for underscored_dir in underscored_dirs:
        has_tracked = False
        for root, dirs, files in os.walk(underscored_dir):
            for fname in files:
                fpath = os.path.relpath(os.path.join(root, fname), repo_root)
                # Normalize path to forward slashes for comparison with git ls-files
                fpath_normalized = fpath.replace("\\", "/")
                if fpath_normalized in tracked_files:
                    has_tracked = True
                    break
            if has_tracked:
                break
        if not has_tracked:
            untracked_dirs.append(underscored_dir)

    if not untracked_dirs:
        import pytest
        pytest.skip("No fully untracked underscore-prefixed directories found locally")

    # For each untracked directory, verify all files are git-ignored
    for underscored_dir in untracked_dirs:
        for root, dirs, files in os.walk(underscored_dir):
            for fname in files:
                fpath = os.path.join(root, fname)
                # Use git check-ignore; returncode 0 means ignored
                result = subprocess.run(
                    ["git", "check-ignore", fpath],
                    cwd=str(repo_root),
                    capture_output=True,
                )
                assert (
                    result.returncode == 0
                ), f"File {fpath} is not git-ignored (expected to be ignored)"


# Fixed public salt: raises the brute-force cost of recovering the low-entropy
# marker terms from these committed hashes (privacy-review recommendation).
_SALT = "printsense-privacy-guard-v1:"

# Two tokenization passes: pass 1 keeps `_` as a joiner (catches the marker
# terms as written); pass 2 treats `_` as a delimiter so a marker fused into
# an underscore-joined identifier (filename stems, dict keys) is still caught.
_TOKEN_PASSES = (re.compile(r"[a-z0-9_]+"), re.compile(r"[a-z0-9]+"))


def _salted(token: str) -> str:
    return hashlib.sha256((_SALT + token).encode()).hexdigest()


def _hash_hits(text: str, hash_set: set[str]) -> list[str]:
    """Pure matching core (exposed for the sabotage positive-control test):
    dual-pass tokenize, salt-hash, return matching hashes."""
    lowercase = text.lower()
    seen: set[str] = set()
    for pattern in _TOKEN_PASSES:
        seen.update(pattern.findall(lowercase))
    return [h for h in (_salted(t) for t in seen) if h in hash_set]


def _scan_tracked(repo_root: Path, hash_set: set[str]) -> list[tuple[str, str]]:
    """Return (path, hash) hits of salted-token matches in tracked text files
    under printsense/** and tests/printsense/**."""
    output = _run_git(["ls-files", "-z"], repo_root)
    tracked_files = [f for f in output.split("\0") if f]
    relevant_files = [
        f for f in tracked_files
        if f.startswith(("printsense/", "tests/printsense/"))
    ]
    hits = []
    for fpath in relevant_files:
        full_path = repo_root / fpath
        if not full_path.is_file():
            continue
        try:
            if full_path.stat().st_size > 2_000_000:
                continue
            content = full_path.read_bytes().decode("utf-8", errors="ignore")
        except Exception:
            continue
        lowercase = content.lower()
        seen: set[str] = set()
        for pattern in _TOKEN_PASSES:
            seen.update(pattern.findall(lowercase))
        for token in seen:
            token_hash = _salted(token)
            if token_hash in hash_set:
                hits.append((fpath, token_hash))
    return hits


def test_4_marker_token_scan():
    """Check 4: Salted dual-pass token scan of tracked files.

    Failure mode: a forbidden-marker token (salted-hash match) found in any
    tracked text file under printsense/** or tests/printsense/**.
    """
    repo_root = _get_repo_root()

    # Salted forbidden hashes (plaintext terms never appear in this file)
    forbidden_hashes = {
        "8bb02b0d1c6cb08eaeb0ce1c6a03cbeba6b614ffe058e915f27e6fb917bc0067",
        "b473ba7f72e03a2cfb00f14dc6b1ad5f235232453ec264d795f37bf14eea600c",
        "28b598515318299fbe175b5f3c513d0f2f2754532c1676784292eabe6e54dac5",
        "de6367ad335f2f324dfbb0acd92daa6e68e140be25f8dcb2d147faa80d0dded5",
        "ff808091298fd37b682f62b0898f3452ed3099a3a206ed640653dd2bf1d3c48a",
    }

    violations = _scan_tracked(repo_root, forbidden_hashes)
    assert not violations, f"Forbidden tokens found in: {violations}"


def test_5_legacy_marker_allowlist():
    """Check 5: Legacy hashes may ONLY appear in allowlist paths.

    Three legacy hashes may appear in pre-existing files; any NEW tracked file
    containing one fails.

    Failure mode: a legacy-hash token found in a file outside the allowlist.
    """
    repo_root = _get_repo_root()

    # Legacy hashes (salted; 3 terms present only in pre-existing files)
    legacy_hashes = {
        "69cccd0f48a5672f5904ec575884ba80664f50ed35b05551ab11616826e91109",
        "22e5fa84b80b832522361a26e5becd5046f7b94cc369af5ef2f5250558436269",
        "c72cd45807755337e642a2c290d707c8e84949402bd118c6c58a42faa2c4c749",
    }

    # Allowlist paths (17 pre-existing legacy files)
    allowlist = {
        "printsense/PATH_TO_A.md",
        "printsense/fixtures/scu2/README.md",
        "printsense/fixtures/scu2/explanation.md",
        "printsense/fixtures/scu2/graph.json",
        "printsense/benchmarks/scu2_sheet20_opto.md",
        "printsense/benchmarks/scu2_sheet20/response_b.graph.json",
        "printsense/benchmarks/scu2_sheet20/response_b_tiled.graph.json",
        "printsense/benchmarks/scu2_sheet20/response_b_verified.graph.json",
        "printsense/benchmarks/_brief_eval/blurred_sheet20.AFTER_brief.txt",
        "printsense/benchmarks/_brief_eval/blurred_sheet20.graph.json",
        "printsense/benchmarks/_brief_eval/sheet16.graph.json",
        "printsense/benchmarks/_brief_eval/sheet18.graph.json",
        "printsense/benchmarks/_brief_eval/sheet20.graph.json",
        "printsense/benchmarks/_brief_eval/sheet5.graph.json",
        "printsense/benchmarks/_eval_outputs/01_sheet20_upright.json",
        "printsense/benchmarks/_eval_outputs/03_sheet20_lowres.json",
        "printsense/benchmarks/_eval_outputs/04_scu2_sheet5.json",
    }

    violations = [
        (fpath, token_hash)
        for fpath, token_hash in _scan_tracked(repo_root, legacy_hashes)
        if fpath not in allowlist
    ]

    assert (
        not violations
    ), f"Legacy hashes found in non-allowlist files: {violations}"


def test_7_tracked_ignore_rules_are_versioned():
    """Check 7 (privacy review): the confidential-dir protection must be a
    TRACKED rule, not only a local in-dir .gitignore (which is itself ignored
    and vanishes on a fresh clone with no diff to review).

    Failure mode: the generic underscore-dir rule disappears from the tracked
    printsense/benchmarks/.gitignore, or the Docker build-context exclusion
    disappears from the root .dockerignore.
    """
    repo_root = _get_repo_root()

    gitignore = (repo_root / "printsense" / "benchmarks" / ".gitignore").read_text()
    assert "_*/" in gitignore.split(), (
        "tracked generic underscore-dir ignore rule (_*/) missing from "
        "printsense/benchmarks/.gitignore")
    for reinclude in ("!_brief_eval/", "!_eval_outputs/"):
        assert reinclude in gitignore, f"{reinclude} re-include missing"

    dockerignore = (repo_root / ".dockerignore").read_text()
    assert "printsense/benchmarks/_*/" in dockerignore, (
        "Docker build-context exclusion for confidential eval dirs missing "
        "from root .dockerignore")


def test_6_draft_labeling_truth_status():
    """Check 6: Every tracked JSON under printsense/** with a truth_status key
    has a value in the allowed set.

    Failure mode: truth_status has an invalid value or is not one of the allowed.
    """
    repo_root = _get_repo_root()

    output = _run_git(["ls-files", "-z"], repo_root)
    tracked_files = [f for f in output.split("\0") if f]

    # Filter to JSON files under printsense/
    json_files = [f for f in tracked_files if f.startswith("printsense/") and f.endswith(".json")]

    allowed_statuses = {
        "frozen_human_confirmed",
        "draft_llm_authored",
        "draft_unfrozen",
        "synthetic",
    }

    violations = []

    for fpath in json_files:
        full_path = repo_root / fpath
        if not full_path.is_file():
            continue

        try:
            data = json.loads(full_path.read_text())
        except Exception:
            continue

        # Check if truth_status key exists
        if "truth_status" in data:
            status_value = data["truth_status"]
            if status_value not in allowed_statuses:
                violations.append((fpath, status_value))

    assert (
        not violations
    ), f"Invalid truth_status values found: {violations}"
