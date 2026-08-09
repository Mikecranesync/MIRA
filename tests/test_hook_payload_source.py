"""Claude Code hooks must read their tool payload from stdin, never from env vars.

Why this exists
---------------
On 2026-08-09 the ``PostToolUse(Edit|Write)`` hook in ``.claude/settings.json`` was
found to have never run. It interpolated ``$CLAUDE_FILE_PATH``, which the harness
does not set. Dumping the hook environment on a real ``Write`` gave::

    CLAUDE_PROJECT_DIR=<set>  CLAUDE_CODE_SESSION_ID=<set>  CLAUDE_PID=<set>
    CLAUDE_TOOL_INPUT=[]      CLAUDE_FILE_PATH=<absent>
    STDIN={"session_id":...,"tool_input":{"file_path":...},"tool_response":{...}}

So *session/project* env vars are populated, but the **tool payload** arrives only
as JSON on stdin. Every hook that keyed on a payload env var was silently a no-op:

* ``PostToolUse(Edit|Write)`` — ruff/pyright/review_hook/touched-files log, all dead.
  ``pyright ""`` additionally falls back to scanning the whole project, which is the
  real mechanism behind the orphaned-pyright thrash that #3100 bounded with an alarm.
* the inline gitleaks-on-commit ``PreToolUse(Bash)`` hook — no secret scan ever ran.
* ``tools/hooks/worktree-file-guard.sh`` — dead twice over, since its primary
  extraction also used ``grep -oP``, unsupported by BSD grep on macOS.
* ``~/.claude/hooks/ruff-on-edit.sh`` (user-global, not covered by this test).

The failure mode is *silence*: a mis-keyed hook exits 0 and looks identical to a
hook that ran and found nothing. Hence a deterministic test rather than doctrine.

The rule
--------
A hook may still *mention* a payload env var as a legacy fallback (``prod-guard.sh``,
``rm-guard.sh`` and ``git-state-guard.sh`` do, after their stdin read). What it may
not do is rely on one as its **only** source. So: if a hook references a payload env
var, it must also read stdin.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SETTINGS = REPO / ".claude" / "settings.json"

# Env vars the harness does NOT populate with the tool payload. Session/project vars
# (CLAUDE_PROJECT_DIR, CLAUDE_CODE_SESSION_ID, CLAUDE_PID, CLAUDE_CODE_EFFORT_LEVEL)
# ARE set and are deliberately absent from this list.
PAYLOAD_ENV_VARS = ("CLAUDE_TOOL_INPUT", "CLAUDE_FILE_PATH", "CLAUDE_TOOL_FILE_PATH")

# Any of these counts as "reads the payload from stdin".
STDIN_READS = ("$(cat", "| cat", "cat)", "/dev/stdin", "sys.stdin", "read -r", "json.load(")


def _hook_commands():
    """Yield (label, command) for every inline command hook in settings.json."""
    settings = json.loads(SETTINGS.read_text())
    for event, groups in settings.get("hooks", {}).items():
        for group in groups:
            matcher = group.get("matcher", "-")
            for hook in group.get("hooks", []):
                cmd = hook.get("command")
                if cmd:
                    yield f"{event}/{matcher}", cmd


def _referenced_env_vars(text: str):
    return [v for v in PAYLOAD_ENV_VARS if v in text]


def _reads_stdin(text: str) -> bool:
    return any(tok in text for tok in STDIN_READS)


def test_settings_json_is_parseable():
    """A malformed settings.json silently disables EVERY setting in the file."""
    json.loads(SETTINGS.read_text())


@pytest.mark.parametrize(
    "label,cmd", list(_hook_commands()), ids=lambda v: v if isinstance(v, str) and "/" in v else ""
)
def test_inline_hook_does_not_rely_on_payload_env_var(label, cmd):
    used = _referenced_env_vars(cmd)
    if not used:
        return
    assert _reads_stdin(cmd), (
        f"Hook {label} references {used} but never reads stdin. The harness does not "
        f"set those vars; the tool payload arrives as JSON on stdin. This hook would "
        f"silently no-op. Extract with: IN=$(cat); "
        f"printf '%s' \"$IN\" | jq -r '.tool_input.file_path'"
    )


# Feeding a parser FROM a payload env var — `echo "$CLAUDE_TOOL_INPUT" | jq`, or
# `python3 -c ... <<< "$CLAUDE_TOOL_INPUT"`. This is the subtle form: the pre-fix
# worktree-file-guard.sh did contain `sys.stdin.read()`, so a naive "does it read
# stdin?" check passed it — but that stdin was the herestring of an always-empty
# variable. The data source is what matters, not the syntax used to consume it.
_FED_FROM_ENV = re.compile(
    r"(?:<<<|\becho\b|\bprintf\b)[^\n]*\$\{?(?:" + "|".join(PAYLOAD_ENV_VARS) + r")\b"
)


def _assert_not_fed_from_env(label: str, code: str) -> None:
    m = _FED_FROM_ENV.search(code)
    assert not m, (
        f"{label} pipes a parser from {m.group(0)!r}. That variable is always empty — "
        f"the payload is JSON on stdin. Reading stdin that was itself fed from the env "
        f"var is the same bug wearing a disguise."
    )


@pytest.mark.parametrize(
    "label,cmd", list(_hook_commands()), ids=lambda v: v if isinstance(v, str) and "/" in v else ""
)
def test_inline_hook_not_fed_from_payload_env_var(label, cmd):
    _assert_not_fed_from_env(f"Hook {label}", cmd)


def _hook_scripts():
    """Hook scripts under tools/hooks/ that settings.json actually invokes."""
    cmds = " ".join(cmd for _, cmd in _hook_commands())
    out = []
    for path in sorted((REPO / "tools" / "hooks").glob("*.sh")):
        if path.name in cmds:
            out.append(path)
    return out


@pytest.mark.parametrize("script", _hook_scripts(), ids=lambda p: p.name)
def test_hook_script_does_not_rely_on_payload_env_var(script):
    # Comments stripped: fixed scripts name the dead vars in their headers to explain
    # the bug, and that prose must not be read as a live reference.
    text = "\n".join(
        line for line in script.read_text().splitlines() if not line.lstrip().startswith("#")
    )
    _assert_not_fed_from_env(str(script.relative_to(REPO)), text)
    used = _referenced_env_vars(text)
    if not used:
        return
    assert _reads_stdin(text), (
        f"{script.relative_to(REPO)} references {used} as its only payload source. "
        f"Read the PreToolUse/PostToolUse JSON from stdin instead (see rm-guard.sh "
        f"for the canonical stdin-first shape, including the note on draining stdin "
        f"to avoid SIGPIPEing the caller)."
    )


@pytest.mark.parametrize("script", _hook_scripts(), ids=lambda p: p.name)
def test_hook_script_avoids_grep_perl_regex(script):
    """`grep -oP` is a GNU extension; BSD grep on macOS (CHARLIE) does not support it.

    worktree-file-guard.sh used it as its primary extraction, so the guard failed on
    the very platform it shipped on.
    """
    # Strip comments first: the fixed scripts *describe* the old `grep -oP` bug in
    # their headers, and matching prose would fail the very files that fixed it.
    text = "\n".join(
        line for line in script.read_text().splitlines() if not line.lstrip().startswith("#")
    )
    assert not re.search(r"grep\s+(-\w*P|\S*\s+-P)\b", text), (
        f"{script.relative_to(REPO)} uses `grep -P`, unsupported by BSD grep on macOS. "
        f"Parse JSON with python3/jq instead."
    )


def test_posttooluse_edit_write_hook_actually_reads_stdin():
    """Positive assertion: the specific hook that was dead must stay wired."""
    for label, cmd in _hook_commands():
        if label.startswith("PostToolUse/") and "Edit" in label:
            assert _reads_stdin(cmd), f"{label} must read the payload from stdin"
            return
    pytest.fail("No PostToolUse Edit|Write hook found in .claude/settings.json")


def test_gitleaks_config_extends_default_ruleset():
    """A gitleaks config declaring [[rules]] REPLACES the ~170 built-ins unless it
    opts in via [extend] useDefault. Until 2026-08-09 this repo's config declared 4
    custom rules and no extend, so a live-shaped AWS key pair staged for commit
    scanned clean. Verified by re-running the same fixture after the fix: detected.
    """
    cfg = (REPO / ".gitleaks.toml").read_text()
    if "[[rules]]" not in cfg:
        return
    normalized = re.sub(r"\s+", "", cfg)
    assert "usedefault=true" in normalized.lower(), (
        ".gitleaks.toml declares [[rules]] without `[extend] useDefault = true`, which "
        "disables every built-in rule (AWS/GitHub/GCP/Stripe/Slack/private keys). "
        "Add the extend block."
    )
