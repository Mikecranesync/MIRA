"""Rich terminal formatter for screener output.

Uses ANSI color codes directly (no external deps beyond stdlib).
Severity colors: P0=red, P1=yellow, P2=cyan, P3=white.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone

from .schema import FixProposal, QualityFlag, SessionQuality

# ANSI codes
_RED = "\033[91m"
_YELLOW = "\033[93m"
_CYAN = "\033[96m"
_GREEN = "\033[92m"
_BOLD = "\033[1m"
_DIM = "\033[2m"
_RESET = "\033[0m"

_NO_COLOR = not sys.stdout.isatty()


def _c(text: str, code: str) -> str:
    if _NO_COLOR:
        return text
    return f"{code}{text}{_RESET}"


_SEVERITY_COLOR = {
    "P0": _RED,
    "P1": _YELLOW,
    "P2": _CYAN,
    "P3": "",
}

_OUTCOME_COLOR = {
    "resolved": _GREEN,
    "escalated": _YELLOW,
    "abandoned": _RED,
    "loop": _RED,
    "invalid": _YELLOW,
}


def _sev(severity: str) -> str:
    return _c(f"[{severity}]", _SEVERITY_COLOR.get(severity, ""))


def print_session_header(session: SessionQuality) -> None:
    outcome_str = _c(session.outcome.upper(), _OUTCOME_COLOR.get(session.outcome, ""))
    flag_count = len(session.quality_flags)
    p0_count = sum(1 for f in session.quality_flags if f.severity == "P0")

    print()
    print(_c("─" * 72, _BOLD))
    print(
        f"{_c('SESSION', _BOLD)} {_c(session.session_id[:40], _DIM)}  "
        f"outcome={outcome_str}  flags={_c(str(flag_count), _RED if p0_count else _YELLOW)}"
    )
    print(
        f"  turns={session.total_turns}  "
        f"avg_conf={session.avg_confidence:.2f}  "
        f"p95={session.p95_response_time_ms}ms  "
        f"frustration={session.frustration_level}  "
        f"fsm_progress={session.fsm_progress_rate:.0%}"
    )
    if session.feedback_rating:
        fb_color = _GREEN if session.feedback_rating in ("positive", "thumbs_up") else _RED
        print(f"  feedback={_c(session.feedback_rating, fb_color)}")
    if session.started_at:
        elapsed = ""
        if session.ended_at:
            delta = session.ended_at - session.started_at
            elapsed = f"  duration={int(delta.total_seconds())}s"
        print(f"  started={session.started_at.strftime('%Y-%m-%d %H:%M:%S UTC')}{elapsed}")


def print_flag(flag: QualityFlag) -> None:
    print(f"\n  {_sev(flag.severity)} {_c(flag.code, _BOLD)}")
    print(f"    {flag.description}")
    if flag.turns_affected:
        turns_str = ", ".join(str(t) for t in flag.turns_affected[:6])
        suffix = f"  (+ {len(flag.turns_affected) - 6} more)" if len(flag.turns_affected) > 6 else ""
        print(f"    turns: [{turns_str}]{suffix}")


def print_proposal(proposal: FixProposal, index: int) -> None:
    sev_str = _sev(proposal.severity)
    conf_pct = f"{proposal.confidence:.0%}"
    print(f"\n  {_c(f'Fix #{index}', _BOLD)} {sev_str}  confidence={conf_pct}")
    print(f"  {_c('→', _CYAN)} {proposal.title}")
    print(f"  {_c('category:', _DIM)} {proposal.fix_category}")
    print(f"  {_c('file:', _DIM)} {proposal.affected_file}")
    print()
    # Wrap proposed_change to 68 chars
    words = proposal.proposed_change.split()
    line = "    "
    for word in words:
        if len(line) + len(word) + 1 > 72:
            print(line)
            line = "    " + word
        else:
            line += (" " if line.strip() else "") + word
    if line.strip():
        print(line)


def print_session_report(
    session: SessionQuality, proposals: list[FixProposal], *, interactive: bool = False
) -> list[FixProposal]:
    """Print full session report. In interactive mode, prompt user to approve each fix.
    Returns list of approved proposals.
    """
    print_session_header(session)

    if not session.quality_flags:
        print(_c("  ✓ No quality flags detected", _GREEN))
        return []

    print(f"\n  {_c('Quality Flags:', _BOLD)}")
    for flag in session.quality_flags:
        print_flag(flag)

    if not proposals:
        return []

    print(f"\n  {_c('Fix Proposals:', _BOLD)}")
    approved: list[FixProposal] = []

    for i, proposal in enumerate(proposals, 1):
        print_proposal(proposal, i)

        if interactive:
            while True:
                choice = input(
                    f"\n  Approve fix #{i}? [y=yes / n=skip / q=quit session]: "
                ).strip().lower()
                if choice in ("y", "yes"):
                    approved.append(proposal)
                    print(_c("  ✓ Approved", _GREEN))
                    break
                elif choice in ("n", "no", ""):
                    print(_c("  ✗ Skipped", _DIM))
                    break
                elif choice in ("q", "quit"):
                    print(_c("  Session review stopped.", _DIM))
                    return approved

    return approved


def print_summary(sessions: list[SessionQuality], total_proposals: int) -> None:
    """Print run summary."""
    p0 = sum(sum(1 for f in s.quality_flags if f.severity == "P0") for s in sessions)
    p1 = sum(sum(1 for f in s.quality_flags if f.severity == "P1") for s in sessions)
    p2 = sum(sum(1 for f in s.quality_flags if f.severity == "P2") for s in sessions)
    resolved = sum(1 for s in sessions if s.outcome == "resolved")

    print()
    print(_c("═" * 72, _BOLD))
    print(_c("SCREENER SUMMARY", _BOLD))
    print(
        f"  sessions={len(sessions)}  "
        f"resolved={_c(str(resolved), _GREEN)}  "
        f"p0={_c(str(p0), _RED)}  "
        f"p1={_c(str(p1), _YELLOW)}  "
        f"p2={_c(str(p2), _CYAN)}"
    )
    print(f"  fix_proposals={total_proposals}")
    print(_c("═" * 72, _BOLD))


def print_live_alert(session: SessionQuality) -> None:
    """Compact real-time alert for live mode."""
    now = datetime.now(timezone.utc).strftime("%H:%M:%S")
    p0_flags = [f for f in session.quality_flags if f.severity == "P0"]
    flag_codes = " ".join(f.code for f in session.quality_flags[:4])
    prefix = _c(f"[{now}]", _DIM)
    sev = _c("[P0 ALERT]", _RED) if p0_flags else _c("[FLAG]", _YELLOW)
    print(
        f"{prefix} {sev} chat={session.chat_id[:12]}  "
        f"outcome={session.outcome}  flags={flag_codes}"
    )
