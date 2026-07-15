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


def test_4_marker_token_scan():
    """Check 4: Token scan of tracked files.

    Tokenize content of every tracked TEXT file under printsense/** and
    tests/printsense/** (lowercase, [a-z0-9_]+), sha256 each token, assert
    none match the 4 forbidden hashes.

    Failure mode: a forbidden-hash token found in a tracked file.
    """
    repo_root = _get_repo_root()

    # Forbidden hashes (plaintext terms never appear in this file)
    forbidden_hashes = {
        "27b48730d76b4861184b8be56d5254ebca9ebb7b5c9a5fb1ef3436eddc4f27c7",
        "871ebb645aa85ef6f6245334f99f8ec90e363f14f403d3f8962a12cbd530ff17",
        "8796d14441f85df5ddf17b74ef22033f3541654c1d2818f8d5ca17e25f0bc684",
        "f3b04cfa61435e82c64a5d18e3d330b7a17af83752cbc105f453d0b6b22fbfc3",
    }

    output = _run_git(["ls-files", "-z"], repo_root)
    tracked_files = [f for f in output.split("\0") if f]

    # Filter to printsense/ and tests/printsense/
    relevant_files = [
        f
        for f in tracked_files
        if f.startswith(("printsense/", "tests/printsense/"))
    ]

    token_pattern = re.compile(r"[a-z0-9_]+")
    violations = []

    for fpath in relevant_files:
        full_path = repo_root / fpath
        if not full_path.is_file():
            continue

        # Skip files > 2MB
        try:
            file_size = full_path.stat().st_size
            if file_size > 2_000_000:
                continue
        except (OSError, PermissionError):
            continue

        # Try to read as text; skip binary files
        try:
            content = full_path.read_bytes().decode("utf-8", errors="ignore")
        except Exception:
            continue

        # Tokenize: lowercase, extract [a-z0-9_]+
        lowercase_content = content.lower()
        tokens = token_pattern.findall(lowercase_content)

        for token in tokens:
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            if token_hash in forbidden_hashes:
                violations.append((fpath, token_hash))

    assert not violations, f"Forbidden tokens found in: {violations}"


def test_5_legacy_marker_allowlist():
    """Check 5: Legacy hashes may ONLY appear in allowlist paths.

    Three legacy hashes may appear in pre-existing files; any NEW tracked file
    containing one fails.

    Failure mode: a legacy-hash token found in a file outside the allowlist.
    """
    repo_root = _get_repo_root()

    # Legacy hashes (3)
    legacy_hashes = {
        "1e30b14a8001c7393bcd26b1d6e093a55b527c57edbc4676ce8f3077a777df6f",
        "977d2387026eeab3fc4a05e6044fc7159c01bee55d45db487758f14459a332b4",
        "a596b487ebe630ec2a76cfce269ea2adedb251c2bd94d732cde90c48fef023e5",
    }

    # Allowlist paths (17 pre-existing legacy files)
    allowlist = {
        "printsense/PATH_TO_A.md",
        "printsense/fixtures/scu2/README.md",
        "printsense/fixtures/scu2/explanation.md",
        "printsense/fixtures/scu2/graph.json",
        "printsense/benchmarks/scu2_ap31971_sheet20_opto.md",
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

    output = _run_git(["ls-files", "-z"], repo_root)
    tracked_files = [f for f in output.split("\0") if f]

    # Filter to printsense/ and tests/printsense/
    relevant_files = [
        f
        for f in tracked_files
        if f.startswith(("printsense/", "tests/printsense/"))
    ]

    token_pattern = re.compile(r"[a-z0-9_]+")
    violations = []

    for fpath in relevant_files:
        full_path = repo_root / fpath
        if not full_path.is_file():
            continue

        # Skip files > 2MB
        try:
            file_size = full_path.stat().st_size
            if file_size > 2_000_000:
                continue
        except (OSError, PermissionError):
            continue

        # Try to read as text; skip binary files
        try:
            content = full_path.read_bytes().decode("utf-8", errors="ignore")
        except Exception:
            continue

        # Tokenize
        lowercase_content = content.lower()
        tokens = token_pattern.findall(lowercase_content)

        for token in tokens:
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            if token_hash in legacy_hashes:
                # Legacy hash found; check if file is in allowlist
                if fpath not in allowlist:
                    violations.append((fpath, token_hash))

    assert (
        not violations
    ), f"Legacy hashes found in non-allowlist files: {violations}"


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
