"""
judge_v2.py — Wraps v1 judge.py with runtime pattern injection.
Extends _FAULT_CAUSE_PATTERNS / _NEXT_STEP_PATTERNS in the live module,
calls judge.score(), then restores originals in a finally block.
"""
from pathlib import Path
import sys

_HERE = Path(__file__).parent
_V1 = _HERE.parent / "telegram_test_runner"
sys.path.insert(0, str(_V1))

import judge  # noqa: E402  (v1 module)


class JudgeV2:
    def __init__(self):
        self._judge = judge
        self._injected_fault: list[str] = []
        self._injected_next: list[str] = []

    def inject_patterns(self, fault: list[str], next_step: list[str]) -> None:
        """Store extra patterns to be appended on the next score() call."""
        self._injected_fault = [p.lower() for p in fault]
        self._injected_next = [p.lower() for p in next_step]

    def score(self, case: dict, reply: str | None, elapsed: float = 0.0) -> dict:
        """Extend module-level lists → score → restore (always)."""
        orig_fault = list(self._judge._FAULT_CAUSE_PATTERNS)
        orig_next = list(self._judge._NEXT_STEP_PATTERNS)
        try:
            self._judge._FAULT_CAUSE_PATTERNS.extend(self._injected_fault)
            self._judge._NEXT_STEP_PATTERNS.extend(self._injected_next)
            result = self._judge.score(case, reply, elapsed)
            result["injected_patterns"] = {
                "fault_cause": list(self._injected_fault),
                "next_step": list(self._injected_next),
            }
            return result
        finally:
            self._judge._FAULT_CAUSE_PATTERNS[:] = orig_fault
            self._judge._NEXT_STEP_PATTERNS[:] = orig_next
            self.clear_injected()

    def clear_injected(self) -> None:
        self._injected_fault = []
        self._injected_next = []


def create_judge() -> JudgeV2:
    return JudgeV2()
