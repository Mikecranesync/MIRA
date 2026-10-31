"""Dumps the exact word lists / regex patterns `scope-check.ts` transcribes
from `guardrails.py`, so a test can assert TS equals Python byte-for-byte
instead of relying on eyeballed transcription.

Run from `mira-bots/`:
    python3 -m shared.eval.dump_guardrails_wordlists \
        > ../mira-hub/src/capabilities/scope-check.wordlists-fixture.json
"""

import json

from shared import guardrails as g


def build() -> dict:
    return {
        "INTENT_KEYWORDS": sorted(g.INTENT_KEYWORDS),
        "GREETING_PATTERNS": sorted(g.GREETING_PATTERNS),
        "HELP_PATTERNS": sorted(g.HELP_PATTERNS),
        "INSTRUCTIONAL_PHRASES": list(g._INSTRUCTIONAL_PHRASES),
        "DOCUMENTATION_PHRASES": list(g._DOCUMENTATION_PHRASES),
        "DOC_RETRIEVAL_REQUEST_RE": g._DOC_RETRIEVAL_REQUEST_RE.pattern,
        "NEGATED_DOC_POSSESSION_RE": g._NEGATED_DOC_POSSESSION_RE.pattern,
        "FAULT_CODE_RE": g._FAULT_CODE_RE.pattern,
        "EQUIPMENT_NAME_RE": g._EQUIPMENT_NAME_RE.pattern,
        "MAINTENANCE_ABBREVIATIONS": g.MAINTENANCE_ABBREVIATIONS,
        "SAFETY_ACTION_PHRASES": sorted(g.SAFETY_ACTION_PHRASES),
        "MENTION_RE": g._MENTION_RE.pattern,
        "SHORTHAND_SEPARATOR_RE": g._SHORTHAND_SEPARATOR_RE.pattern,
        "MODEL_SHORTHAND_SHAPE_RE": g._MODEL_SHORTHAND_SHAPE_RE.pattern,
    }


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
