"""Expert answer keys: signed before any scored run, void if edited after.

PRD §4: a qualified expert writes the fact-level key *before* model outputs are
viewed. The signature is what makes that checkable. `key_sha256` covers the whole
case except the signature fields (question turns, context packets and key body),
so any later edit to the question, a fact, branch, forbidden claim or reference
no longer matches and the case drops out of
scored runs until the expert re-signs it.
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

SIGNATURE_FIELDS = ("signed_by", "signed_at", "key_sha256")


def _signed_content(case: dict[str, Any]) -> dict[str, Any]:
    """Everything that decides what is asked and how it is scored: the whole case
    minus the signature fields (Codex #3487 r2 F4 — a key signed for one question
    must not stay valid after the question is edited)."""
    body = {k: v for k, v in case.items() if k != "expert_key"}
    body["expert_key"] = {
        k: v for k, v in (case.get("expert_key") or {}).items() if k not in SIGNATURE_FIELDS
    }
    return body


def key_sha256(case: dict[str, Any]) -> str:
    """Canonical hash of the signed content: sorted keys, no whitespace, UTF-8."""
    blob = json.dumps(
        _signed_content(case), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def sign(case: dict[str, Any], *, signer: str, date: str) -> dict[str, Any]:
    """Return a copy of `case` with its key signed by `signer` on `date`."""
    if not (signer or "").strip():
        raise ValueError("a key must be signed by a named expert")
    out = copy.deepcopy(case)
    key = out.get("expert_key") or {}
    out["expert_key"] = key
    key["signed_by"] = signer.strip()
    key["signed_at"] = date
    key["key_sha256"] = key_sha256(out)
    return out


def key_status(case: dict[str, Any]) -> str:
    """'signed' | 'unsigned' | 'tampered'."""
    key = case.get("expert_key") or {}
    if not key.get("signed_by") or not key.get("key_sha256"):
        return "unsigned"
    return "signed" if key["key_sha256"] == key_sha256(case) else "tampered"


def unscorable(cases: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """(case id, status) for every case a scored run must refuse."""
    return [(c["id"], s) for c in cases if (s := key_status(c)) != "signed"]
