"""Read/assemble/score/answer over `wiring_connections` (migration 026).

Reads the ONE `wiring_connections` table — never a second wiring
architecture. Only `approval_state == 'verified'` rows are trusted;
everything else is readable but never asserted as fact. Read-only: no
writes, no control. See `docs/discovery/2026-07-09-wiring-print-extraction-recovery.md`
and `tools/wiring_map_import.py` (the writer this package reads behind).

Public API:
- `schema`: `WiringConnection`, `MachineWiringProfile`, `normalize`
- `reader`: `profile_from_rows` (pure), `load_profile` (DB glue)
- `scorecard`: `WiringTrustScore`, `score_profile`
- `ask`: `WiringAnswer`, `answer_wiring_question`
"""

from __future__ import annotations

from .ask import WiringAnswer, answer_wiring_question
from .reader import load_profile, profile_from_rows
from .schema import MachineWiringProfile, WiringConnection, normalize
from .scorecard import WiringTrustScore, score_profile

__all__ = [
    "MachineWiringProfile",
    "WiringAnswer",
    "WiringConnection",
    "WiringTrustScore",
    "answer_wiring_question",
    "load_profile",
    "normalize",
    "profile_from_rows",
    "score_profile",
]
