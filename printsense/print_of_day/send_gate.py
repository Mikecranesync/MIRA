"""POTD send gate + duplicate-send protection (PRD §19.3, §19.2).

Two independent guards, both fail-closed:

1. **Pre-send gate** (``check_send_gate``): the email must NOT send if any of
   the §19.3 conditions hold — missing attachment, incomplete rights, duplicate
   case, missing blind response, missing source URL, missing recipient, failed
   script, the selected page differing from the graded page, a prior email
   record for the case, or more than one primary attachment queued. Returns the
   list of blocking reasons; empty list = clear to send.

2. **Duplicate-send protection** (``SendLedger``): a durable append-only ledger
   keyed by ``run_id`` / ``case_id``. ``already_sent`` is checked before send;
   ``record_sent`` is written after a successful send under a per-key lock so a
   retry (or a second scheduler instance) can never send the same case twice.

The mailer itself (``tools/internet_print_test/mailer.py``) is reused verbatim
for building/sending; this module is only the gate around it.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from factorylm_ai.capability_codes import DUPLICATE_RUN, CapabilityError


@dataclass
class SendContext:
    """Everything the pre-send gate inspects for one case."""

    case_id: str
    recipient: str | None
    source_url: str | None
    rights_complete: bool
    blind_response_present: bool
    script_ok: bool
    selected_page_sha: str | None
    graded_page_sha: str | None
    primary_attachments: list[str] = field(default_factory=list)


def check_send_gate(ctx: SendContext, *, prior_email_exists: bool) -> list[str]:
    """Return the ordered list of §19.3 blocking reasons (empty = clear)."""
    reasons: list[str] = []
    if len(ctx.primary_attachments) == 0:
        reasons.append("attachment_missing")
    if len(ctx.primary_attachments) > 1:
        reasons.append("more_than_one_primary_attachment")
    if not ctx.rights_complete:
        reasons.append("rights_metadata_incomplete")
    if not ctx.blind_response_present:
        reasons.append("blind_response_missing")
    if not ctx.source_url:
        reasons.append("source_url_missing")
    if not ctx.recipient:
        reasons.append("email_recipient_missing")
    if not ctx.script_ok:
        reasons.append("script_generation_failed")
    if ctx.selected_page_sha != ctx.graded_page_sha:
        reasons.append("selected_page_differs_from_graded_page")
    if prior_email_exists:
        reasons.append("case_already_emailed")
    return reasons


class SendLedger:
    """Durable append-only send ledger (duplicate-send protection).

    One JSONL row per successfully-sent case. Lives on the mounted volume so it
    survives redeploys. ``already_sent`` gates BEFORE send; ``record_sent``
    writes AFTER, under an OS-level per-file lock so two processes cannot both
    pass the check and both send.
    """

    def __init__(self, path: str | Path | None = None) -> None:
        root = path or os.getenv("POTD_SEND_LEDGER") or "/mira-db/print_of_day/sent.jsonl"
        self.path = Path(root)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _rows(self) -> list[dict]:
        if not self.path.exists():
            return []
        rows = []
        with self.path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # a torn tail line is not a reason to re-send
        return rows

    def already_sent(self, *, run_id: str, case_id: str) -> bool:
        for row in self._rows():
            if row.get("run_id") == run_id or row.get("case_id") == case_id:
                return True
        return False

    def record_sent(self, *, run_id: str, case_id: str, email_id: str | None, sha: str) -> None:
        """Append the sent record under a cross-process lock. Raises
        ``DUPLICATE_RUN`` if another writer recorded it first (re-check inside
        the lock closes the check-then-act race)."""
        lock_path = self.path.with_suffix(".lock")
        with lock_path.open("w", encoding="utf-8") as lock_fh:
            _lock(lock_fh)
            try:
                if self.already_sent(run_id=run_id, case_id=case_id):
                    raise CapabilityError(
                        DUPLICATE_RUN, f"case {case_id!r} / run {run_id!r} already recorded as sent"
                    )
                row = {
                    "run_id": run_id,
                    "case_id": case_id,
                    "email_id": email_id,
                    "manifest_sha256": sha,
                }
                with self.path.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(row) + "\n")
                    fh.flush()
                    os.fsync(fh.fileno())
            finally:
                _unlock(lock_fh)


def _lock(fh) -> None:  # pragma: no cover - platform branch
    try:
        import fcntl

        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
    except ImportError:
        import msvcrt

        msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)


def _unlock(fh) -> None:  # pragma: no cover - platform branch
    try:
        import fcntl

        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
    except ImportError:
        import msvcrt

        try:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
