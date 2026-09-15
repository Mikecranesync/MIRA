#!/usr/bin/env python3
"""Validate agent identity metadata for pull requests and their commits."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Dict, Iterable, List


IDENTITY_RE = re.compile(
    r"^(?P<agent>[a-z][a-z0-9_-]*)/(?P<machine>[a-z0-9][a-z0-9._-]*)/(?P<session>[a-z0-9][a-z0-9._-]*)$"
)
ROLE_VALUES = {"implementation", "review", "triage"}
MARKER_RE = re.compile(
    r"^(Agent-Identity|Agent-Role|Human-Owner|Human-Authorization):\s*(\S.*)\s*$",
    re.MULTILINE,
)


def extract_markers(text: str) -> Dict[str, str]:
    return {name: value.strip() for name, value in MARKER_RE.findall(text)}


def validate_identity(identity: str) -> List[str]:
    if not identity:
        return ["missing Agent-Identity"]
    match = IDENTITY_RE.fullmatch(identity)
    if not match:
        return [
            "Agent-Identity must be <agent>/<machine>/<session> using lowercase letters, digits, '.', '_' or '-'; "
            f"got {identity!r}"
        ]
    if match.group("agent") not in {"codex", "claude", "hermes"}:
        return [f"unsupported agent {match.group('agent')!r}; use codex, claude, hermes, or update the policy"]
    return []


def validate_role(identity: str, role: str, allow_codex_implementation: bool = False) -> List[str]:
    errors: List[str] = []
    if role not in ROLE_VALUES:
        return [f"Agent-Role must be one of {sorted(ROLE_VALUES)}; got {role!r}"]
    agent = identity.split("/", 1)[0] if "/" in identity else ""
    if agent == "codex" and role == "implementation" and not allow_codex_implementation:
        errors.append("Codex is review/triage-only under .claude/rules/multi-session-protocol.md")
    return errors


def validate_metadata(
    markers: Dict[str, str], context: str, allow_codex_implementation: bool = False
) -> List[str]:
    errors: List[str] = []
    identity = markers.get("Agent-Identity", "")
    role = markers.get("Agent-Role", "")
    owner = markers.get("Human-Owner", "")
    errors.extend(f"{context}: {error}" for error in validate_identity(identity))
    errors.extend(
        f"{context}: {error}"
        for error in validate_role(identity, role, allow_codex_implementation)
    )
    if not owner.startswith("@") or len(owner) == 1:
        errors.append(f"{context}: Human-Owner must be a GitHub handle beginning with '@'")
    return errors


def validate_commit_messages(
    messages: Iterable[str], allow_codex_implementation: bool = False
) -> List[str]:
    errors: List[str] = []
    for index, message in enumerate(messages, start=1):
        markers = extract_markers(message)
        context = f"commit {index}"
        identity = markers.get("Agent-Identity", "")
        role = markers.get("Agent-Role", "")
        errors.extend(f"{context}: {error}" for error in validate_identity(identity))
        errors.extend(
            f"{context}: {error}"
            for error in validate_role(identity, role, allow_codex_implementation)
        )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr-body-file", type=Path, required=True)
    parser.add_argument("--commits-file", type=Path, required=True)
    args = parser.parse_args()

    pr_body = args.pr_body_file.read_text(encoding="utf-8")
    commit_blob = args.commits_file.read_bytes()
    commit_messages = [chunk.decode("utf-8") for chunk in commit_blob.split(b"\0") if chunk.strip()]

    errors = validate_metadata(extract_markers(pr_body), "pull request body")
    pr_markers = extract_markers(pr_body)
    authorization = pr_markers.get("Human-Authorization", "")
    allow_codex_implementation = (
        pr_markers.get("Agent-Identity", "").startswith("codex/")
        and pr_markers.get("Agent-Role") == "implementation"
        and authorization.startswith("@")
    )
    errors = validate_metadata(
        pr_markers,
        "pull request body",
        allow_codex_implementation=allow_codex_implementation,
    )
    if not commit_messages:
        errors.append("no commit messages were provided; refusing to pass closed input")
    errors.extend(
        validate_commit_messages(
            commit_messages,
            allow_codex_implementation=allow_codex_implementation,
        )
    )

    if errors:
        for error in errors:
            print(f"::error::{error}")
        return 1
    print(f"Agent identity check passed for PR metadata and {len(commit_messages)} commit(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
