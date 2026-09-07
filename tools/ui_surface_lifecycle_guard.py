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
control-plane file — unless the PR carries the `legacy-ui-exception` label, a
single substantive `## Legacy UI exception` PR-body section (Reason /
Canonical replacement impact / Rollback), and a fresh user label event bound
to the current PR head/body snapshot.

This module does no network access and reads no GitHub token — it is pure
policy + text analysis, designed to run from the TRUSTED BASE revision of the
repository (see `.github/workflows/ui-lifecycle-guard.yml`), fed only
metadata (changed files plus one current PR snapshot containing labels, body,
and head) fetched by a separate token-bearing step. See CLI `main()` at the
bottom.

    python3 tools/ui_surface_lifecycle_guard.py --base <sha> --head <sha>
    python3 tools/ui_surface_lifecycle_guard.py \\
        --changes-json-file changed-files.jsonl \\
        --expected-change-count-file expected-change-count.txt \\
        --labels-file labels.txt \\
        --pr-body-file pr-body.md \\
        --event-json-file "$GITHUB_EVENT_PATH" \\
        --current-pull-json-file current-pull.json \\
        --approver-permission-json-file approver-permission.json
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
    "requirements/ui-lifecycle-guard.txt",
)

# ---------------------------------------------------------------------------
# Code-owned presentation classifiers (charter §2.2 addendum).
#
# Registry globs document the broad legacy roots. These classifiers apply
# first and carry the executable exclusions for preserved capability seams.
# That order is essential: a broad `src/**` registry glob closes sibling-UI
# bypasses, while this trusted-base code keeps API/transport/domain paths
# available for the canonical adapters to reuse.
#
# Public trees are blanket guarded. Images, fonts, PDFs, and manifests all
# change the shipped legacy experience; "non-executable" never meant
# "non-presentational". New canonical assets belong in the shared packages or
# a bounded `src/factorylm-ui/**` adapter, not in an old public tree.
# ---------------------------------------------------------------------------
PUBLIC_STATIC_GUARDED_ROOTS: tuple[str, ...] = (
    "mira-web/public/",
    "mira-hub/public/",
)

CLASSIFIED_SOURCE_ROOTS: tuple[str, ...] = (
    "mira-web/src/",
    "mira-hub/src/",
    "mira-mobile/src/",
)

CANONICAL_ADAPTER_ROOTS: tuple[str, ...] = (
    "mira-web/src/factorylm-ui/",
    "mira-hub/src/factorylm-ui/",
    "mira-mobile/src/factorylm-ui/",
)

_PRESENTATION_SUFFIXES: tuple[str, ...] = (
    ".tsx",
    ".jsx",
    ".css",
    ".scss",
    ".sass",
    ".less",
)

# Existing mira-web route modules that are data/API capability seams rather
# than HTML page mounts. Every other current or future production route file
# is guarded by default. New backend work has a durable unambiguous home under
# `mira-web/src/capabilities/**`.
_WEB_PRESERVED_ROUTE_PATHS: frozenset[str] = frozenset(
    {
        "mira-web/src/routes/inbox.ts",
        "mira-web/src/routes/m.ts",
        "mira-web/src/routes/mfa.ts",
        "mira-web/src/routes/probe-state.ts",
    }
)

_WEB_PRESENTATION_LIB_PATHS: frozenset[str] = frozenset(
    {
        "mira-web/src/lib/blog-renderer.ts",
        "mira-web/src/lib/components.ts",
        "mira-web/src/lib/drive-commander-renderer.ts",
        "mira-web/src/lib/feature-renderer.ts",
        "mira-web/src/lib/head.ts",
    }
)

# These are operational/native/transport seams already consumed by the mobile
# application. Everything else under the historical `src/lib/**` bucket fails
# closed: that bucket also contains visible copy, view models, composer
# behavior, citation rendering, and transient-layer behavior, so treating the
# directory itself as a capability boundary is unsafe. New reusable capability
# code belongs in the API/adapter roots or in the shared FactoryLM packages.
_MOBILE_PRESERVED_LIB_PATHS: frozenset[str] = frozenset(
    {
        "mira-mobile/src/lib/live-update.ts",
        "mira-mobile/src/lib/native-pick.ts",
        "mira-mobile/src/lib/offline-queue.ts",
        "mira-mobile/src/lib/open-with.ts",
        "mira-mobile/src/lib/resume-guard.ts",
        "mira-mobile/src/lib/sse.ts",
        "mira-mobile/src/lib/tags.ts",
    }
)

_MOBILE_PRESERVED_CHAT_ADAPTER_PATHS: frozenset[str] = frozenset(
    {
        "mira-mobile/src/chat-adapter/contract.ts",
        "mira-mobile/src/chat-adapter/runtime.tsx",
        "mira-mobile/src/chat-adapter/turns-to-parts.ts",
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
# Values that are ONLY a placeholder if they match EXACTLY (whole value,
# case-insensitive) — these are common real English words/phrases that can
# legitimately open a substantive sentence ("none, this only touches the
# recovery route" is real content, not a placeholder), so they must not be
# treated as prefixes.
_PLACEHOLDER_EXACT_VALUES: frozenset[str] = frozenset({"none", "not applicable"})
# Placeholder-phrase prefixes. Matched against the START of a (lowercased,
# stripped) field value only — never as a substring — so a substantive value
# that merely mentions one of these words mid-sentence ("the TODO comment in
# home.ts was hiding a null deref") is never rejected. A prefix match only
# counts if the next character is not alphanumeric (word-boundary check), so
# "na" doesn't false-positive against "native app rewrite ...". These are
# phrases that are placeholder-shaped even WITH trailing text ("N/A because
# this is a rollback" is still a non-answer), unlike `_PLACEHOLDER_EXACT_VALUES`.
_PLACEHOLDER_PREFIXES: tuple[str, ...] = (
    "n/a",
    "na",
    "tbd",
    "todo",
    "tba",
    "placeholder",
    "fill later",
    "fill in later",
)
_ANGLE_PLACEHOLDER_RE = re.compile(r"^<.*>$", re.DOTALL)
_SUBSTANTIVE_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)
_MIN_SUBSTANTIVE_TOKENS = 3
_MIN_SUBSTANTIVE_ALNUM_CHARS = 12
_FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_EXCEPTION_HEADER_RE = re.compile(r"^##\s+Legacy UI exception\s*$")
_ANY_H2_RE = re.compile(r"^##\s+")
# A "fence" opener: 3+ backticks or 3+ tildes, optionally followed by a
# language tag (```python, ~~~markdown, ...).
_FENCE_OPEN_RE = re.compile(r"^(`{3,}|~{3,})")

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


@dataclass(frozen=True)
class ExceptionApproval:
    """Fresh GitHub label attestation bound to one PR head and body snapshot."""

    valid: bool
    approver: Optional[str]
    reason: str


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
    loader = _StrictUniqueKeyLoader(text)
    try:
        # Use the SafeLoader subclass directly instead of routing through
        # yaml.load. This preserves duplicate-key rejection while making the
        # safe construction boundary explicit to both readers and scanners.
        data = loader.get_single_data()
    except GuardPolicyError:
        raise
    except yaml.YAMLError as exc:
        raise GuardPolicyError(f"registry is not valid YAML: {exc}") from exc
    finally:
        loader.dispose()
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


def _is_test_path(path: str) -> bool:
    parts = path.split("/")
    name = parts[-1]
    return "__tests__" in parts or ".test." in name or ".spec." in name


def _is_hub_api_route(path: str) -> bool:
    """True only for Next route-handler files below an explicit `api` segment.

    This preserves both `app/api/**/route.ts` and the historical
    `app/(hub)/api/**/route.ts` capability seams. A `page.tsx` placed below an
    `api` directory is still presentation and therefore remains guarded.
    """
    prefix = "mira-hub/src/app/"
    if not path.startswith(prefix) or not path.endswith("/route.ts"):
        return False
    return "api" in path[len(prefix) :].split("/")[:-1]


def _classify_web_source(path: str) -> bool:
    """Classify `mira-web/src/**`; True means legacy presentation.

    mira-web mixes HTML templates and backend behavior in `.ts` files, so an
    extension-only rule is unsafe. Existing data/API seams are preserved by
    explicit roots/paths, while route mounts, renderers, content data,
    `server.ts`, and every unknown production sibling fail closed.
    """
    if _is_test_path(path):
        return False
    if path.startswith("mira-web/src/capabilities/"):
        return path.lower().endswith(_PRESENTATION_SUFFIXES)
    if path.startswith("mira-web/src/seed/"):
        return path.lower().endswith(_PRESENTATION_SUFFIXES)
    if path in _WEB_PRESERVED_ROUTE_PATHS:
        return False
    if path.startswith("mira-web/src/routes/"):
        return True
    if path in _WEB_PRESENTATION_LIB_PATHS:
        return True
    if path.startswith("mira-web/src/lib/"):
        # A new renderer is presentation even before its mount lands. Other
        # established lib modules are capability seams; mounting one into the
        # old product still requires a guarded server/route change.
        return path.rsplit("/", 1)[-1].endswith("-renderer.ts")
    if path.startswith("mira-web/src/views/") or path.startswith("mira-web/src/data/"):
        return True
    if path == "mira-web/src/server.ts":
        return True
    # Unknown production roots are not an escape hatch for a new old-site UI.
    return True


def _classify_hub_source(path: str) -> bool:
    """Classify `mira-hub/src/**`; True means legacy presentation."""
    if _is_test_path(path):
        return False
    if _is_hub_api_route(path):
        return False
    if path.startswith("mira-hub/src/messages/"):
        # Locale catalogs are rendered product copy, not inert backend data.
        return True
    if path.startswith("mira-hub/src/app/"):
        return True
    if path.startswith("mira-hub/src/components/"):
        # React/style components are presentation. Plain TypeScript helpers
        # such as notebook-chat-utils.ts and layout/sign-out-action.ts remain
        # reusable capability seams.
        return path.lower().endswith(_PRESENTATION_SUFFIXES)
    if path.startswith("mira-hub/src/providers/"):
        return path.lower().endswith(_PRESENTATION_SUFFIXES)
    # A React/style sibling outside today's conventional directories is still
    # a presentation surface. Plain `.ts` domain/service modules remain open.
    return path.lower().endswith(_PRESENTATION_SUFFIXES)


def _classify_mobile_source(path: str) -> bool:
    """Classify `mira-mobile/src/**`; True means legacy presentation."""
    if _is_test_path(path):
        return False
    if path.startswith("mira-mobile/src/chat-adapter/"):
        return path not in _MOBILE_PRESERVED_CHAT_ADAPTER_PATHS
    if path.startswith("mira-mobile/src/api/"):
        return path.lower().endswith(_PRESENTATION_SUFFIXES)
    if path.startswith("mira-mobile/src/lib/"):
        return path not in _MOBILE_PRESERVED_LIB_PATHS
    if path.startswith("mira-mobile/src/unified/"):
        # Preserve the pure adapter transforms, but freeze the old CSS/React
        # presentation that happened to share this historical directory.
        return path.lower().endswith(_PRESENTATION_SUFFIXES)
    if path == "mira-mobile/src/nav.ts":
        return True
    return path.lower().endswith(_PRESENTATION_SUFFIXES)


def _classify_source_path(path: str) -> Optional[bool]:
    if any(path.startswith(root) for root in CANONICAL_ADAPTER_ROOTS):
        return False
    if path.startswith("mira-web/src/"):
        return _classify_web_source(path)
    if path.startswith("mira-hub/src/"):
        return _classify_hub_source(path)
    if path.startswith("mira-mobile/src/"):
        return _classify_mobile_source(path)
    return None


def path_is_guarded(path: str, policy: GuardPolicy) -> bool:
    for root in PUBLIC_STATIC_GUARDED_ROOTS:
        if path.startswith(root):
            return True
    classified = _classify_source_path(path)
    if classified is not None:
        return classified
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


def _load_json_object(path: Path, *, description: str) -> dict:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise GuardPolicyError(f"cannot read {description} file {path}: {exc}") from exc
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise GuardPolicyError(f"{description} file {path} is not valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise GuardPolicyError(f"{description} file {path} must contain a JSON object")
    return value


def load_exception_approval(
    event_path: Path,
    current_pull_path: Path,
    approver_permission_path: Path,
) -> ExceptionApproval:
    """Validate a fresh label act against the current PR snapshot.

    The persistent label is not approval by itself. The only accepted
    attestation is the `pull_request_target:labeled` event that applied
    `legacy-ui-exception`, performed by a GitHub User, whose event-time head
    SHA and PR body still match a separately fetched current pull request, and
    whose separately fetched repository role is `maintain` or whose legacy
    base permission is `admin`. GitHub maps Maintain to legacy `write`, so both
    `permission` and `role_name` are checked.
    Any later push or body edit causes the next workflow run to fail until an
    authorized user removes/reapplies the label after reviewing the new state.
    """
    event = _load_json_object(event_path, description="GitHub event")
    current = _load_json_object(current_pull_path, description="current pull request")
    permission_record = _load_json_object(
        approver_permission_path, description="approver repository permission"
    )

    event_pr = event.get("pull_request")
    event_label = event.get("label")
    sender = event.get("sender")
    current_head = current.get("head")
    current_base = current.get("base")
    current_labels = current.get("labels")
    permission_user = permission_record.get("user")
    if (
        not all(
            isinstance(value, dict)
            for value in (event_pr, event_label, sender, current_head, current_base)
        )
        or not isinstance(current_labels, list)
        or not isinstance(permission_user, dict)
    ):
        raise GuardPolicyError("exception approval metadata is missing required GitHub objects")

    event_head = event_pr.get("head")
    current_base_repo = current_base.get("repo")
    event_repo = event.get("repository")
    if not all(isinstance(value, dict) for value in (event_head, current_base_repo, event_repo)):
        raise GuardPolicyError("exception approval metadata is missing head/repository objects")

    event_sha = event_head.get("sha")
    current_sha = current_head.get("sha")
    if not isinstance(event_sha, str) or not _FULL_SHA_RE.fullmatch(event_sha):
        raise GuardPolicyError("exception approval event head SHA is missing or malformed")
    if not isinstance(current_sha, str) or not _FULL_SHA_RE.fullmatch(current_sha):
        raise GuardPolicyError("current pull request head SHA is missing or malformed")

    event_body = event_pr.get("body")
    current_body = current.get("body")
    if event_body is not None and not isinstance(event_body, str):
        raise GuardPolicyError("exception approval event PR body is not text or null")
    if current_body is not None and not isinstance(current_body, str):
        raise GuardPolicyError("current pull request body is not text or null")

    label_names: set[str] = set()
    for item in current_labels:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise GuardPolicyError("current pull request labels contain a malformed item")
        label_names.add(item["name"])

    approver = sender.get("login") if isinstance(sender.get("login"), str) else None
    permission_login = (
        permission_user.get("login") if isinstance(permission_user.get("login"), str) else None
    )
    permission = permission_record.get("permission")
    role_name = permission_record.get("role_name")
    has_maintainer_authority = permission == "admin" or (
        permission == "write" and role_name == "maintain"
    )
    checks = (
        (event.get("action") == "labeled", "workflow event is not a label application"),
        (event_label.get("name") == _LEGACY_LABEL, "workflow event applied a different label"),
        (_LEGACY_LABEL in label_names, "exception label is no longer present"),
        (sender.get("type") == "User" and bool(approver), "label actor is not a GitHub User"),
        (permission_login == approver, "permission record actor mismatches label actor"),
        (
            has_maintainer_authority,
            "label actor does not have repository maintain or admin permission",
        ),
        (event.get("number") == current.get("number"), "pull request number changed"),
        (event_pr.get("number") == current.get("number"), "event pull request number mismatches"),
        (
            event_repo.get("full_name") == current_base_repo.get("full_name"),
            "repository identity mismatches",
        ),
        (event_sha == current_sha, "pull request head changed after approval"),
        ((event_body or "") == (current_body or ""), "pull request body changed after approval"),
    )
    failures = [reason for passed, reason in checks if not passed]
    if failures:
        return ExceptionApproval(valid=False, approver=approver, reason="; ".join(failures))
    return ExceptionApproval(
        valid=True,
        approver=approver,
        reason=(
            "fresh label event matches the current pull request head/body and "
            "the actor has repository maintainer authority"
        ),
    )


# ---------------------------------------------------------------------------
# Exception PR-body parsing — strip fenced code blocks and HTML comments
# FIRST, so neither can be used to smuggle a fake exception section past the
# guard. Require exactly one live `## Legacy UI exception` section with all
# three labeled fields present and substantive.
# ---------------------------------------------------------------------------
def _strip_fenced_code_blocks(text: str) -> str:
    """Drop fenced code-block content — backtick OR tilde fences, length >=3,
    CLOSED or UNCLOSED. An unclosed fence drops everything through EOF (never
    left un-stripped and scannable, never left as a way to smuggle a fake
    exception section past the guard by simply never closing the fence)."""
    lines = (text or "").splitlines(keepends=True)
    out: list[str] = []
    in_fence = False
    fence_char = ""
    fence_len = 0
    for line in lines:
        stripped = line.strip()
        if not in_fence:
            m = _FENCE_OPEN_RE.match(stripped)
            if m:
                fence_char = m.group(1)[0]
                fence_len = len(m.group(1))
                in_fence = True
                continue
            out.append(line)
            continue
        close_re = re.compile(r"^" + re.escape(fence_char) + "{" + str(fence_len) + r",}$")
        if close_re.match(stripped):
            in_fence = False
        # else: still inside the fence (or this line is the unclosed-to-EOF
        # tail) — drop it either way.
    return "".join(out)


def _strip_html_comments(text: str) -> str:
    """Drop HTML comments — CLOSED (`<!-- ... -->`) first, then any remaining
    UNCLOSED `<!--` through EOF, so an opened-but-never-closed comment cannot
    leave the rest of the body (potentially including a real exception
    section) unstripped."""
    text = re.sub(r"<!--.*?-->", "", text or "", flags=re.DOTALL)
    text = re.sub(r"<!--[\s\S]*$", "", text)
    return text


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


def _extract_field(body: str, label: str) -> tuple[Optional[str], bool]:
    """Return `(value, ambiguous)`. A field label appearing more than once in
    the section body is ambiguous — fail closed rather than silently take the
    first match (a duplicated `Reason:` line could otherwise hide a
    contradicting or placeholder second value behind a substantive first
    one)."""
    pattern = re.compile(r"^" + re.escape(label) + r"[ \t]*(.*)$", re.MULTILINE)
    matches = list(pattern.finditer(body))
    if not matches:
        return None, False
    if len(matches) > 1:
        return None, True
    return matches[0].group(1).strip(), False


def _starts_with_placeholder_phrase(value_lower: str) -> bool:
    """True if `value_lower` (already `.strip().lower()`d) starts with a
    placeholder-vocabulary phrase at a word boundary — anchored at the START
    of the value only, never a substring match, so a substantive value that
    merely mentions "todo" or "n/a" mid-sentence is never rejected."""
    for prefix in _PLACEHOLDER_PREFIXES:
        if value_lower == prefix:
            return True
        if value_lower.startswith(prefix):
            next_char = value_lower[len(prefix)]
            if not next_char.isalnum():
                return True
    return False


def _is_punctuation_only(value: str) -> bool:
    return bool(value) and not any(c.isalnum() for c in value)


def _is_substantive(value: Optional[str]) -> bool:
    if value is None:
        return False
    v = value.strip()
    if not v:
        return False
    if _ANGLE_PLACEHOLDER_RE.match(v):
        return False
    if _is_punctuation_only(v):
        return False
    if v.lower() in _PLACEHOLDER_EXACT_VALUES:
        return False
    if _starts_with_placeholder_phrase(v.lower()):
        return False
    tokens = _SUBSTANTIVE_TOKEN_RE.findall(v)
    if len(tokens) < _MIN_SUBSTANTIVE_TOKENS:
        return False
    if sum(len(token) for token in tokens) < _MIN_SUBSTANTIVE_ALNUM_CHARS:
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
        value, ambiguous = _extract_field(body, label)
        if ambiguous:
            missing.append(f"body:{label} (duplicate field — ambiguous)")
        elif not _is_substantive(value):
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
    *,
    exception_approval_valid: bool = False,
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
    if not missing and not exception_approval_valid:
        missing.append("approval:fresh legacy-ui-exception label bound to current head/body")

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
        "--event-json-file",
        type=Path,
        default=None,
        help="Raw pull_request_target event JSON used to bind a fresh exception label.",
    )
    p.add_argument(
        "--current-pull-json-file",
        type=Path,
        default=None,
        help="Current GitHub pull-request JSON compared with the label event snapshot.",
    )
    p.add_argument(
        "--approver-permission-json-file",
        type=Path,
        default=None,
        help="Current GitHub repository-permission JSON for the label-event actor.",
    )
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
    approval_files = (
        args.event_json_file,
        args.current_pull_json_file,
        args.approver_permission_json_file,
    )
    if any(path is not None for path in approval_files) and not all(
        path is not None for path in approval_files
    ):
        print(
            "error: --event-json-file, --current-pull-json-file, and "
            "--approver-permission-json-file must be provided together",
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
        approval = (
            load_exception_approval(
                args.event_json_file,
                args.current_pull_json_file,
                args.approver_permission_json_file,
            )
            if args.event_json_file is not None
            else ExceptionApproval(
                valid=False,
                approver=None,
                reason="no GitHub label-event attestation was supplied",
            )
        )
    except GuardPolicyError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1

    result = evaluate(
        changes,
        labels,
        pr_body,
        policy,
        exception_approval_valid=approval.valid,
    )
    if not result.allowed:
        for touched_path in result.guarded_paths:
            print(f"::error file={touched_path}::{result.message}")
        return 1

    print(result.message)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
