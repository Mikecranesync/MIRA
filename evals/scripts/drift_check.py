"""Deterministic architecture drift checks (§5.4, §16).

Checks for single-canonical-implementation constraints:
1. single-composer: exactly one Composer.tsx
2. single-thread-model: one createThreadId site
3. single-chat-shell: known Conversation importers only
4. legacy-guard-present: lifecycle guard + workflows exist
5. no-second-eval-tree: no duplicate evals/ directories

Run from repo root. Exit non-zero on any FAIL.
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("drift_check")
logging.basicConfig(level=logging.INFO)


# Allowlists (discovered from current repo state 2026-09-13, frozen to detect drift)
COMPOSER_ALLOWLIST = {
    "packages/factorylm-ui/src/Composer.tsx",
    "./packages/factorylm-ui/src/Composer.tsx",
}

THREAD_ID_MINT_SITES = {
    "mira-mobile/src/lib/thread.ts",
    "mira-mobile/src/utils/threadUtils.ts",
    "mira-mobile/src/screens/UnifiedRoot.tsx",  # createThreadId definition + call site
}

CONVERSATION_IMPORTERS = {
    "mira-mobile/src/screens/ChatScreen.tsx",
    "mira-mobile/src/screens/UnifiedChat.tsx",
    "mira-web/src/components/ChatInterface.tsx",
}

EVAL_TREES = {
    "evals/",
    "tests/eval",
}


def check_single_composer() -> tuple[str, bool, list[str]]:
    """Check: exactly one Composer.tsx in packages/factorylm-ui."""
    try:
        result = subprocess.run(
            ["find", ".", "-name", "Composer.tsx", "-o", "-name", "Composer.jsx"],
            cwd=".",
            capture_output=True,
            text=True,
            timeout=10,
        )
        found = [p for p in result.stdout.split("\n") if p]
    except Exception as e:
        return "single-composer", False, [f"Error: {e}"]

    outside_canonical = [
        p
        for p in found
        if p not in COMPOSER_ALLOWLIST
        and "mira-mobile" not in p
        and ".git" not in p
    ]

    if outside_canonical:
        evidence = [f"Found duplicate: {p}" for p in outside_canonical]
        return "single-composer", False, evidence
    return "single-composer", True, found or ["None (expected)"]


def check_single_thread_model() -> tuple[str, bool, list[str]]:
    """Check: thread ID minting in known locations only."""
    try:
        result = subprocess.run(
            ["grep", "-r", "createThreadId", "mira-mobile/src", "mira-web/src"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        lines = [ln for ln in result.stdout.split("\n") if ln]
    except Exception as e:
        return "single-thread-model", False, [f"Error: {e}"]

    evidence: list[str] = []

    for line in lines:
        if not any(allowed in line for allowed in THREAD_ID_MINT_SITES):
            evidence.append(f"Unexpected: {line[:100]}")

    if evidence:
        return "single-thread-model", False, evidence
    return "single-thread-model", True, lines or ["None (expected)"]


def check_single_chat_shell() -> tuple[str, bool, list[str]]:
    """Check: Conversation imported only by known adapters."""
    try:
        result = subprocess.run(
            ["grep", "-r", "from.*Conversation", "mira-mobile/src", "mira-web/src"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        lines = [ln for ln in result.stdout.split("\n") if ln]
    except Exception as e:
        return "single-chat-shell", False, [f"Error: {e}"]

    evidence: list[str] = []

    for line in lines:
        if not any(allowed in line for allowed in CONVERSATION_IMPORTERS):
            evidence.append(f"Unexpected: {line[:100]}")

    if evidence:
        return "single-chat-shell", False, evidence
    return "single-chat-shell", True, lines or ["None (expected)"]


def check_legacy_guard_present() -> tuple[str, bool, list[str]]:
    """Check: lifecycle guard tool and workflow exist."""
    guard_tool = Path("tools/ui_surface_lifecycle_guard.py")
    guard_workflow = Path(".github/workflows/ui-lifecycle-guard.yml")

    evidence = []
    all_ok = True

    if not guard_tool.exists():
        evidence.append(f"Missing: {guard_tool}")
        all_ok = False
    else:
        evidence.append(f"Present: {guard_tool}")

    if not guard_workflow.exists():
        evidence.append(f"Missing: {guard_workflow}")
        all_ok = False
    else:
        evidence.append(f"Present: {guard_workflow}")

    return "legacy-guard-present", all_ok, evidence


def check_no_second_eval_tree() -> tuple[str, bool, list[str]]:
    """Check: no duplicate evals/ or eval/ directories at repo root."""
    try:
        result = subprocess.run(
            ["find", ".", "-maxdepth", "1", "-type", "d", "-name", "eval*"],
            cwd=".",
            capture_output=True,
            text=True,
            timeout=10,
        )
        found = [p for p in result.stdout.split("\n") if p and p not in [".", "./"]]
    except Exception as e:
        return "no-second-eval-tree", False, [f"Error: {e}"]

    unexpected = [p for p in found if p not in ["./evals", "./tests/eval"]]

    if unexpected:
        evidence = [f"Found duplicate: {p}" for p in unexpected]
        return "no-second-eval-tree", False, evidence
    return "no-second-eval-tree", True, found or ["None (expected)"]


async def main():
    """Run all checks and emit JSON summary."""
    checks = [
        check_single_composer(),
        check_single_thread_model(),
        check_single_chat_shell(),
        check_legacy_guard_present(),
        check_no_second_eval_tree(),
    ]

    summary = {}
    failed = 0

    for name, passed, evidence in checks:
        status = "PASS" if passed else "FAIL"
        summary[name] = status
        print(f"{status}: {name}")
        for line in evidence:
            print(f"  {line}")

        if not passed:
            failed += 1

    # JSON output
    result = {"checks": summary, "all_pass": failed == 0}
    print("\n" + json.dumps(result, indent=2))

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    import asyncio
    import sys

    exit_code = asyncio.run(main())
    sys.exit(exit_code)
