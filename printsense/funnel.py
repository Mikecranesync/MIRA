"""Conversion funnel + survey + pilot qualification (commercial PR-4).

Analytics that structurally CANNOT leak document content or PII: event
properties pass a whitelist (known keys, numeric/bool/short-token values
only); anything content-shaped is rejected at emit time. Free-text survey
comments stay with the intake record — never in analytics.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

from pydantic import BaseModel

EVENTS = (
    "intake_started", "upload_completed", "processing_completed",
    "processing_failed", "report_reviewed", "report_delivered",
    "followup_question_submitted", "package_request_submitted",
    "pilot_qualified", "pilot_won", "pilot_lost",
)

# typed whitelist: numeric-only keys can never smuggle a filename/string;
# token keys accept only short machine tokens (no spaces, no content).
_NUMERIC_KEYS = {"files", "pages", "duration_s", "survey_score",
                 "devices_found", "xrefs_proven"}
_TOKEN_KEYS = {"failed_stage", "review_action", "qualified_reason"}
_TOKEN_RE = re.compile(r"^[a-z0-9_.:-]{1,64}$")


class Survey(BaseModel):
    saved_time: bool
    identified_useful: bool
    would_trust_troubleshooting: bool
    has_complete_package: bool
    consider_paid_pilot: bool

    model_config = {"extra": "forbid"}


class Funnel:
    def __init__(self, root: str | Path):
        self.path = Path(root) / "funnel_events.jsonl"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, event: str, tenant_id: str, intake_id: str,
             props: dict | None = None) -> dict:
        if event not in EVENTS:
            raise ValueError(f"unknown funnel event {event!r}")
        clean: dict = {}
        for k, v in (props or {}).items():
            if k in _NUMERIC_KEYS:
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    raise ValueError(f"prop {k!r} must be numeric")
                clean[k] = v
            elif k in _TOKEN_KEYS:
                if not (isinstance(v, str) and _TOKEN_RE.match(v)):
                    raise ValueError(f"prop {k!r} must be a short machine token")
                clean[k] = v
            else:
                raise ValueError(f"prop {k!r} not whitelisted for analytics")
        row = {"at": time.time(), "event": event, "tenant_id": tenant_id,
               "intake_id": intake_id, "props": clean}
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
        return row

    def counts(self) -> dict:
        out: dict = {}
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                ev = json.loads(line)["event"]
                out[ev] = out.get(ev, 0) + 1
        return out


def qualify_pilot(survey: Survey, full_package_requested: bool,
                  review_pilot_suitable: bool) -> tuple[bool, str]:
    """Deterministic qualification: interest + material + reviewer sign-off."""
    if not review_pilot_suitable:
        return False, "reviewer_did_not_mark_suitable"
    if not survey.has_complete_package:
        return False, "no_complete_package_available"
    if not (full_package_requested or survey.consider_paid_pilot):
        return False, "no_pilot_interest_expressed"
    return True, "interest+package+reviewer_suitable"
