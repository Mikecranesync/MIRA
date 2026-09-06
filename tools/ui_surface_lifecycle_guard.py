#!/usr/bin/env python3
"""FactoryLM Unified UI Cutover — legacy presentation lifecycle guard.

FACTORYLM-UNIFIED-UI-CUTOVER-001. Charter:
docs/architecture/convergence/UNIFIED_UI_CUTOVER.md §3 "Legacy exception
policy" + §3.1 "Trusted enforcement boundary". Governance plan:
docs/superpowers/plans/2026-09-06-factorylm-unified-ui-cutover-governance.md
Task 2.

Fails closed by default on ANY addition, modification, deletion, rename-in,
or rename-out of a guarded legacy presentation path (from
docs/architecture/convergence/REGISTRY.yaml) or a hardcoded CONTROL_PATTERNS
control-plane file — unless the PR carries BOTH the `legacy-ui-exception`
label AND a single, substantive `## Legacy UI exception` PR-body section
(Reason / Canonical replacement impact / Rollback).

This module does no network access and reads no GitHub token — it is pure
policy + text analysis, designed to run from the TRUSTED BASE revision of the
repository (see `.github/workflows/ui-lifecycle-guard.yml`), fed only
metadata (changed files, labels, PR body) fetched by a separate,
token-bearing step. See CLI `main()` at the bottom.

    python3 tools/ui_surface_lifecycle_guard.py --base <sha> --head <sha>
    python3 tools/ui_surface_lifecycle_guard.py \\
        --changes-json-file changed-files.jsonl \\
        --labels-file labels.txt \\
        --pr-body-file pr-body.md
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

import yaml

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REGISTRY_REL = "docs/architecture/convergence/REGISTRY.yaml"

# ---------------------------------------------------------------------------
# CONTROL_PATTERNS — code-owned trusted-base policy.
#
# These paths are guarded UNCONDITIONALLY, regardless of what the registry
# file (loaded from the base revision) says. A PR that edits its own guard
# implementation, its own tests, the registry, the charter, the focused
# Claude rule, the three UI workflow files, or the trusted GitHub workflow
# itself is a self-protection case — it must go through the same audited
# exception as any guarded legacy path, so the enforcement layer can never be
# quietly loosened in the same PR that would benefit from the loosening.
# ---------------------------------------------------------------------------
CONTROL_PATTERNS: tuple[str, ...] = (
    "docs/architecture/convergence/REGISTRY.yaml",
    "docs/architecture/convergence/UNIFIED_UI_CUTOVER.md",
    "tools/ui_surface_lifecycle_guard.py",
    "tests/test_ui_surface_lifecycle_guard.py",
    ".claude/rules/factorylm-unified-ui-cutover.md",
    ".claude/workflows/flm-ui-map.js",
    ".claude/workflows/flm-ui-slice.js",
    ".claude/workflows/flm-ui-verify.js",
    ".github/workflows/ui-lifecycle-guard.yml",
    ".github/pull_request_template.md",
)

# ---------------------------------------------------------------------------
# Public-static sibling-bypass fix (charter §2.2 addendum).
#
# `mira-web/public/**` is served statically by mira-web — a new .html/.css/.js
# file dropped there is a new presentation surface exactly like a new file
# under `mira-web/src/views/`, NOT an inert asset. This classifier is
# code-owned (like CONTROL_PATTERNS) so it applies regardless of what the
# registry's `guarded_paths` say for this prefix: passive data/asset suffixes
# are unguarded, two exact named infrastructure files are exempt, and
# everything else — including unknown suffixes and extensionless names —
# fails closed (guarded).
# ---------------------------------------------------------------------------
PUBLIC_STATIC_GUARDED_ROOTS: tuple[str, ...] = ("mira-web/public/",)

PUBLIC_STATIC_PASSIVE_SUFFIXES: frozenset[str] = frozenset(
    {
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".avif",
        ".ico",
        ".woff",
        ".woff2",
        ".ttf",
        ".otf",
        ".pdf",
        ".map",
        ".json",
        ".txt",
    }
)

PUBLIC_STATIC_EXEMPT_PATHS: frozenset[str] = frozenset(
    {
        "mira-web/public/sw.js",
        "mira-web/public/posthog-init.js",
    }
)

MAX_EXPECTED_CHANGE_COUNT = 3000

_TERMINAL_GLOB = "/**"
_LEGACY_LABEL = "legacy-ui-exception"
_FIELD_LABELS: tuple[str, ...] = (
    "Reason:",
    "Canonical replacement impact:",
    "Rollback:",
)
_PLACEHOLDER_VALUES = {"n/a", "na", "none", "not applicable", "tbd", "todo"}
_ANGLE_PLACEHOLDER_RE = re.compile(r"^<.*>$", re.DOTALL)
_EXCEPTION_HEADER_RE = re.compile(r"^##\s+Legacy UI exception\s*$")
_ANY_H2_RE = re.compile(r"^##\s+")

# GitHub pull-files `status` values this guard understands, mapped to the
# same normalized vocabulary `changed_files_between()` produces from git.
_GITHUB_STATUS_MAP = {
    "added": "added",
    "modified": "modified",
    "removed": "removed",
    "renamed": "renamed",
}
# git --name-status single-letter codes (only A/M/D/R can appear without
# --find-copies, which this module deliberately never passes).
_GIT_STATUS_MAP = {"A": "added", "M": "modified", "D": "removed", "R": "renamed"}


class GuardPolicyError(Exception):
    """Registry, changed-files, or CLI input is malformed.

    Raised instead of silently ignoring or weakening protection — a broken
    `guarded_paths` entry, a duplicate YAML key, or an unparseable
    changed-files record must stop the guard, not quietly pass everything.
    """


@dataclass(frozen=True)
class ChangedFile:
    status: str
    path: str
    previous_path: Optional[str] = None


@dataclass(frozen=True)
class GuardPolicy:
    """Normalized guarded-path patterns. Exact paths, or a path ending in the
    single terminal wildcard form `dir/sub/**` (matches anything under
    `dir/sub/`). `load_guard_policy()` is the only place CONTROL_PATTERNS is
    injected — a bare `GuardPolicy(...)` does not include them, which lets
    tests build minimal fixture policies without carrying the whole
    control-plane list."""

    guarded_paths: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class GuardResult:
    allowed: bool
    guarded_paths: tuple[str, ...]
    missing_fields: tuple[str, ...]
    message: str


# ---------------------------------------------------------------------------
# Strict YAML loading — duplicate top-level (or any) mapping keys are a
# policy error, not a silent last-wins shadow.
# ---------------------------------------------------------------------------
class _StrictUniqueKeyLoader(yaml.SafeLoader):
    pass


def _construct_mapping_no_dupes(loader: yaml.SafeLoader, node: yaml.Node, deep: bool = False):
    mapping: dict = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise GuardPolicyError(f"duplicate YAML key {key!r} in {node.start_mark}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_StrictUniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping_no_dupes
)


def _strict_yaml_load(text: str) -> dict:
    try:
        data = yaml.load(text, Loader=_StrictUniqueKeyLoader)
    except GuardPolicyError:
        raise
    except yaml.YAMLError as exc:
        raise GuardPolicyError(f"registry is not valid YAML: {exc}") from exc
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise GuardPolicyError("registry root must be a mapping of entry name -> entry body")
    return data


# ---------------------------------------------------------------------------
# guarded_paths validation — normalize or fail closed. Never weaken.
# ---------------------------------------------------------------------------
def _validate_guarded_path(raw: object, *, entry_name: str) -> str:
    if not isinstance(raw, str):
        raise GuardPolicyError(f"{entry_name}: guarded_paths entry is not a string: {raw!r}")
    path = raw.strip()
    if not path:
        raise GuardPolicyError(f"{entry_name}: guarded_paths entry is empty")
    if path.startswith("/"):
        raise GuardPolicyError(f"{entry_name}: guarded_paths entry is absolute: {raw!r}")
    if "\\" in path:
        raise GuardPolicyError(f"{entry_name}: guarded_paths entry contains a backslash: {raw!r}")
    if ".." in path.split("/"):
        raise GuardPolicyError(
            f"{entry_name}: guarded_paths entry contains a traversal segment: {raw!r}"
        )
    if "*" in path:
        if not path.endswith(_TERMINAL_GLOB):
            raise GuardPolicyError(
                f"{entry_name}: guarded_paths entry uses an unsupported wildcard form "
                f"(only a terminal /** is allowed): {raw!r}"
            )
        prefix = path[: -len(_TERMINAL_GLOB)]
        if not prefix or "*" in prefix:
            raise GuardPolicyError(
                f"{entry_name}: guarded_paths entry uses an unsupported wildcard form "
                f"(only a terminal /** is allowed): {raw!r}"
            )
    return path


def _entry_guarded_paths(name: str, entry: dict) -> tuple[str, ...]:
    """Extract validated guarded_paths from one registry entry, or () if the
    entry does not carry the full legacy-guard combination at all.

    An entry only "carries" guard policy when ALL of status/change_policy/
    deletion_safe/canonical_replacement match the guarded-legacy shape
    (charter §2.2, §3). An entry with none of that is simply not a guard
    entry — silently skipped, not an error. But an entry that DOES carry that
    combination and then has a malformed `guarded_paths` is a policy error:
    that shape is precisely how protection could be silently disabled.
    """
    if not isinstance(entry, dict):
        return ()
    is_guard_shaped = (
        entry.get("status") == "LEGACY"
        and entry.get("change_policy") == "exception_only"
        and entry.get("deletion_safe") is False
        and isinstance(entry.get("canonical_replacement"), str)
        and entry.get("canonical_replacement").strip() != ""
    )
    if not is_guard_shaped:
        return ()
    raw_paths = entry.get("guarded_paths")
    if not isinstance(raw_paths, list) or len(raw_paths) == 0:
        raise GuardPolicyError(
            f"{name}: status=LEGACY/change_policy=exception_only/deletion_safe=false "
            "entry must carry a non-empty list `guarded_paths` — found "
            f"{raw_paths!r}"
        )
    return tuple(_validate_guarded_path(p, entry_name=name) for p in raw_paths)


def load_guard_policy(registry_path: Path) -> GuardPolicy:
    """Load a `GuardPolicy` from a REGISTRY.yaml-shaped file.

    Always includes CONTROL_PATTERNS (hardcoded, never sourced from the file)
    in addition to whatever guarded legacy entries the registry declares.
    """
    registry_path = Path(registry_path)
    try:
        text = registry_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise GuardPolicyError(f"cannot read registry {registry_path}: {exc}") from exc

    data = _strict_yaml_load(text)
    guarded: list[str] = list(CONTROL_PATTERNS)
    for name, entry in data.items():
        for p in _entry_guarded_paths(str(name), entry):
            if p not in guarded:
                guarded.append(p)
    return GuardPolicy(guarded_paths=tuple(guarded))


# ---------------------------------------------------------------------------
# Path matching
# ---------------------------------------------------------------------------
def _matches_pattern(path: str, pattern: str) -> bool:
    if pattern.endswith(_TERMINAL_GLOB):
        prefix = pattern[: -len(_TERMINAL_GLOB)] + "/"
        return path == prefix.rstrip("/") or path.startswith(prefix)
    return path == pattern


def _is_public_static_guarded(path: str) -> bool:
    """Deterministic classifier for `mira-web/public/**` paths.

    Guards everything EXCEPT: (a) passive data/asset suffixes that cannot
    execute or render a UI on their own, and (b) two exact, named,
    pre-existing infrastructure files. Unknown suffixes and extensionless
    names fail closed (guarded) — this is the "sibling bypass" fix: a new
    file under mira-web/public/ is a new presentation surface by default.
    """
    normalized = path.strip("/")
    if normalized in PUBLIC_STATIC_EXEMPT_PATHS:
        return False
    name = normalized.rsplit("/", 1)[-1]
    suffix = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if suffix in PUBLIC_STATIC_PASSIVE_SUFFIXES:
        return False
    return True


def path_is_guarded(path: str, policy: GuardPolicy) -> bool:
    for root in PUBLIC_STATIC_GUARDED_ROOTS:
        if path.startswith(root):
            return _is_public_static_guarded(path)
    return any(_matches_pattern(path, pattern) for pattern in policy.guarded_paths)


# ---------------------------------------------------------------------------
# git-derived changed files — NUL-delimited `git diff --name-status -z
# --find-renames BASE...HEAD`. Records are `<status>\0<path>\0`, or for a
# rename `<Rnnn>\0<old_path>\0<new_path>\0` (the similarity score suffix on
# the status token is discarded — only the leading letter matters here).
# ---------------------------------------------------------------------------
def changed_files_between(root: Path, base: str, head: str) -> tuple[ChangedFile, ...]:
    try:
        proc = subprocess.run(
            ["git", "diff", "--name-status", "-z", "--find-renames", f"{base}...{head}"],
            cwd=str(root),
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise GuardPolicyError(f"git diff {base}...{head} failed: {exc}") from exc

    tokens = proc.stdout.split("\0")
    if tokens and tokens[-1] == "":
        tokens.pop()

    out: list[ChangedFile] = []
    i = 0
    while i < len(tokens):
        status_raw = tokens[i]
        i += 1
        if not status_raw:
            continue
        code = status_raw[0]
        if code in ("R", "C"):
            if i + 1 >= len(tokens):
                raise GuardPolicyError(f"malformed rename/copy record in git diff output: {tokens}")
            old_path = tokens[i]
            new_path = tokens[i + 1]
            i += 2
            out.append(ChangedFile(status="renamed", path=new_path, previous_path=old_path))
        else:
            normalized = _GIT_STATUS_MAP.get(code)
            if normalized is None:
                raise GuardPolicyError(f"unexpected git status code {status_raw!r}")
            if i >= len(tokens):
                raise GuardPolicyError(f"malformed record in git diff output: {tokens}")
            path = tokens[i]
            i += 1
            out.append(ChangedFile(status=normalized, path=path))
    return tuple(out)


def validate_expected_change_count(count: int) -> None:
    """Fail closed on a count that cannot be trusted.

    Negative counts are malformed. A count over MAX_EXPECTED_CHANGE_COUNT
    means the PR's diff cannot be safely enumerated at all: GitHub's
    `pulls/{n}/files` endpoint silently stops paginating around 3000 entries
    (the truncation this whole check exists to catch), so a PR that big is
    refused rather than evaluated against a possibly-incomplete file list.
    """
    if count < 0:
        raise GuardPolicyError(f"expected change count is negative: {count}")
    if count > MAX_EXPECTED_CHANGE_COUNT:
        raise GuardPolicyError(
            f"expected change count {count} exceeds {MAX_EXPECTED_CHANGE_COUNT} — the "
            "GitHub pull-files endpoint cannot be safely enumerated past this size "
            "(pagination truncates silently); refusing to evaluate an unverifiable diff"
        )


def read_expected_change_count(path: Path) -> int:
    """Read and validate the PR's own authoritative `changed_files` count."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise GuardPolicyError(f"cannot read expected-change-count file {path}: {exc}") from exc
    try:
        count = int(text)
    except ValueError as exc:
        raise GuardPolicyError(
            f"expected-change-count file {path} is not an integer: {text!r}"
        ) from exc
    validate_expected_change_count(count)
    return count


def load_changed_files(
    path: Path, *, expected_count: Optional[int] = None
) -> tuple[ChangedFile, ...]:
    """Parse normalized GitHub pull-files JSON-lines (one `{filename, status,
    previous_filename}` object per line) from a data-only file. Rejects
    unknown or missing fields, duplicate filename records, and — when
    `expected_count` is given (the PR's own authoritative `changed_files`
    field) — a record count that doesn't match it, which is exactly the
    signature of silent pull-files pagination truncation.
    """
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise GuardPolicyError(f"cannot read changed-files file {path}: {exc}") from exc

    out: list[ChangedFile] = []
    seen_filenames: set[str] = set()
    for lineno, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise GuardPolicyError(f"changed-files line {lineno}: invalid JSON: {exc}") from exc
        if not isinstance(record, dict):
            raise GuardPolicyError(f"changed-files line {lineno}: expected a JSON object")

        status = record.get("status")
        normalized = _GITHUB_STATUS_MAP.get(status)
        if normalized is None:
            raise GuardPolicyError(
                f"changed-files line {lineno}: unknown or missing status {status!r}"
            )

        filename = record.get("filename")
        if not isinstance(filename, str) or not filename:
            raise GuardPolicyError(f"changed-files line {lineno}: missing/invalid filename")
        if filename in seen_filenames:
            raise GuardPolicyError(
                f"changed-files line {lineno}: duplicate filename record {filename!r}"
            )
        seen_filenames.add(filename)

        if normalized == "renamed":
            previous = record.get("previous_filename")
            if not isinstance(previous, str) or not previous:
                raise GuardPolicyError(
                    f"changed-files line {lineno}: renamed record missing previous_filename"
                )
            out.append(ChangedFile(status="renamed", path=filename, previous_path=previous))
        else:
            out.append(ChangedFile(status=normalized, path=filename))

    if expected_count is not None and len(out) != expected_count:
        raise GuardPolicyError(
            f"changed-files record count {len(out)} does not match the PR's "
            f"authoritative changed_files count {expected_count} — possible pull-files "
            "pagination truncation; refusing to evaluate an incomplete diff"
        )
    return tuple(out)


# ---------------------------------------------------------------------------
# Exception PR-body parsing — strip fenced code blocks and HTML comments
# FIRST, so neither can be used to smuggle a fake exception section past the
# guard. Require exactly one live `## Legacy UI exception` section with all
# three labeled fields present and substantive.
# ---------------------------------------------------------------------------
def _strip_fenced_code_blocks(text: str) -> str:
    return re.sub(r"```.*?```", "", text, flags=re.DOTALL)


def _strip_html_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)


def _find_exception_sections(pr_body: str) -> list[str]:
    cleaned = _strip_html_comments(_strip_fenced_code_blocks(pr_body or ""))
    lines = cleaned.splitlines()
    sections: list[str] = []
    i = 0
    while i < len(lines):
        if _EXCEPTION_HEADER_RE.match(lines[i]):
            i += 1
            body_lines: list[str] = []
            while i < len(lines) and not _ANY_H2_RE.match(lines[i]):
                body_lines.append(lines[i])
                i += 1
            sections.append("\n".join(body_lines))
        else:
            i += 1
    return sections


def _extract_field(body: str, label: str) -> Optional[str]:
    pattern = re.compile(r"^" + re.escape(label) + r"[ \t]*(.*)$", re.MULTILINE)
    m = pattern.search(body)
    if not m:
        return None
    return m.group(1).strip()


def _is_substantive(value: Optional[str]) -> bool:
    if value is None:
        return False
    v = value.strip()
    if not v:
        return False
    if v.lower() in _PLACEHOLDER_VALUES:
        return False
    if _ANGLE_PLACEHOLDER_RE.match(v):
        return False
    return True


def _exception_missing_fields(pr_body: str) -> list[str]:
    """Return the list of problems with the PR body's exception section —
    empty means exactly one live section with all three fields substantive."""
    sections = _find_exception_sections(pr_body)
    if len(sections) == 0:
        return ["body:## Legacy UI exception section"]
    if len(sections) > 1:
        return ["body:duplicate ## Legacy UI exception sections"]
    body = sections[0]
    missing = []
    for label in _FIELD_LABELS:
        value = _extract_field(body, label)
        if not _is_substantive(value):
            missing.append(f"body:{label}")
    return missing


# ---------------------------------------------------------------------------
# evaluate() — the guard decision
# ---------------------------------------------------------------------------
def evaluate(
    changes: Iterable[ChangedFile],
    labels: "set[str] | frozenset[str]",
    pr_body: str,
    policy: GuardPolicy,
) -> GuardResult:
    """Require an audited exception for any guarded or control-plane touch.

    For a rename, both `previous_path` and `path` are checked — a rename-out
    of a guarded tree and a rename-in to a guarded tree are both violations.
    """
    touched: list[str] = []
    seen: set[str] = set()
    for change in changes:
        for candidate in (change.path, change.previous_path):
            if not candidate or candidate in seen:
                continue
            if path_is_guarded(candidate, policy):
                touched.append(candidate)
                seen.add(candidate)

    if not touched:
        return GuardResult(
            allowed=True,
            guarded_paths=(),
            missing_fields=(),
            message="No guarded legacy or control-plane paths touched.",
        )

    missing: list[str] = []
    if _LEGACY_LABEL not in set(labels):
        missing.append(f"label:{_LEGACY_LABEL}")
    missing.extend(_exception_missing_fields(pr_body))

    if missing:
        return GuardResult(
            allowed=False,
            guarded_paths=tuple(touched),
            missing_fields=tuple(missing),
            message=(
                "Guarded legacy presentation or control-plane path(s) touched without "
                f"an audited `{_LEGACY_LABEL}` exception. Touched: "
                + ", ".join(touched)
                + ". Missing: "
                + ", ".join(missing)
            ),
        )
    return GuardResult(
        allowed=True,
        guarded_paths=tuple(touched),
        missing_fields=(),
        message="Audited legacy-ui-exception approved for: " + ", ".join(touched),
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _read_labels(path: Optional[Path]) -> set[str]:
    if path is None:
        return set()
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise GuardPolicyError(f"cannot read labels file {path}: {exc}") from exc
    return {line.strip() for line in text.splitlines() if line.strip()}


def _read_pr_body(path: Optional[Path]) -> str:
    if path is None:
        return ""
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise GuardPolicyError(f"cannot read PR body file {path}: {exc}") from exc


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--registry",
        type=Path,
        default=ROOT / DEFAULT_REGISTRY_REL,
        help="Path to REGISTRY.yaml (defaults to the repo's canonical location).",
    )
    p.add_argument("--labels-file", type=Path, default=None, help="Newline-delimited label names.")
    p.add_argument("--pr-body-file", type=Path, default=None, help="Raw PR body text.")
    p.add_argument(
        "--changes-json-file",
        type=Path,
        default=None,
        help="GitHub pull-files JSON-lines ({filename, status, previous_filename}).",
    )
    p.add_argument(
        "--expected-change-count-file",
        type=Path,
        default=None,
        help=(
            "Required with --changes-json-file: a file containing the PR's own "
            "authoritative `changed_files` integer, so a pull-files pagination "
            "truncation (silent past ~3000 files) is caught rather than silently "
            "evaluated against an incomplete diff."
        ),
    )
    p.add_argument("--base", default=None, help="Base git ref/SHA (paired with --head).")
    p.add_argument("--head", default=None, help="Head git ref/SHA (paired with --base).")
    return p


def main(argv: Optional[list] = None) -> int:
    args = _build_arg_parser().parse_args(argv)

    has_json = args.changes_json_file is not None
    has_basehead = args.base is not None or args.head is not None
    if has_json == has_basehead:
        print(
            "error: specify exactly one of --changes-json-file or --base/--head",
            file=sys.stderr,
        )
        return 2
    if has_basehead and not (args.base and args.head):
        print("error: --base and --head must both be provided", file=sys.stderr)
        return 2
    if has_json and args.expected_change_count_file is None:
        print(
            "error: --changes-json-file requires --expected-change-count-file "
            "(pull-files pagination truncation defense)",
            file=sys.stderr,
        )
        return 2

    try:
        policy = load_guard_policy(args.registry)
        if has_json:
            expected_count = read_expected_change_count(args.expected_change_count_file)
            changes = load_changed_files(args.changes_json_file, expected_count=expected_count)
        else:
            changes = changed_files_between(Path.cwd(), args.base, args.head)
        labels = _read_labels(args.labels_file)
        pr_body = _read_pr_body(args.pr_body_file)
    except GuardPolicyError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1

    result = evaluate(changes, labels, pr_body, policy)
    if not result.allowed:
        for touched_path in result.guarded_paths:
            print(f"::error file={touched_path}::{result.message}")
        return 1

    print(result.message)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
