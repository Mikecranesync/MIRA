"""CONNECT: import IMIB v0.1 sets (PR #4793, docs/evals/benchmark-4791/) as factory cases.

IMIB stays where it is; its JSON enters as data. Its forum questions were already used to
measure #4791, so they arrive exposed and split=development, never Live. Its page labels
were AI blind labels, so gold stays provisional until an expert export settles it. Its
safety-gate cases are unpaired and partly written with knowledge of the gate, so they land
in Challenge (not Safety, which requires hazard+control pairs) with that caveat recorded.
"""

from __future__ import annotations

from answer_radar.factory.case import Answerability, BenchmarkCase, Evidence, Pool, freeze_case
from answer_radar.factory.discovery import normalize, rights_for
from answer_radar.factory.registry import SourceRegistry
from answer_radar.schema import (
    PUBLIC_EVAL_ONLY_RIGHTS,
    LicenseClass,
    QuestionRecord,
    Rights,
    SplitAssignment,
)

CAPTURED = "2026-10-25"  # IMIB v0.1 freeze date (PR #4793 PREREGISTRATION)


def _q(
    qid: str,
    platform: str,
    text: str,
    url: str | None,
    license_class: LicenseClass,
    rights: Rights = PUBLIC_EVAL_ONLY_RIGHTS,
) -> QuestionRecord:
    return QuestionRecord(
        question_id=qid,
        source_platform=platform,
        rights=rights,
        license_class=license_class,
        split_assignment=SplitAssignment.DEVELOPMENT,
        source_url=url,
        external_post_id=qid,
        **normalize(text),
    )


HOSTS = {
    "mrplc.com": "mrplc",
    "www.mrplc.com": "mrplc",
    "www.plctalk.net": "plctalk",
    "plctalk.net": "plctalk",
}


def source_for(url: str | None) -> str:
    """Provenance comes from the post's own URL; an unknown host is refused, never defaulted."""
    parts = (url or "").split("/")
    host = parts[2] if len(parts) > 2 else ""
    if host not in HOSTS:
        raise ValueError(f"no registered source for host {host!r}")
    return HOSTS[host]


def import_forum(
    records: list[dict], manual_sha: dict[str, str], registry: SourceRegistry
) -> list[BenchmarkCase]:
    out = []
    for r in records:
        sid = source_for(r.get("url"))
        rights, license_class = rights_for(registry.require_case(sid))
        sha = manual_sha.get(r["manual"], "")
        ev = [
            Evidence("oem_manuals", sha, int(e["page"]), e.get("quote", "")[:200])
            for e in r.get("evidence", [])
            if sha
        ]
        kind = r.get("kind", "")
        out.append(
            freeze_case(
                _q(
                    f"imib:{r['id']}",
                    sid,
                    r["question"],
                    r.get("url"),
                    license_class,
                    rights,
                ),
                source_id=sid,
                origin="captured",  # real forum posts
                captured_text=r["question"],
                captured_at=CAPTURED,
                pool=Pool.CHALLENGE,
                answerability=Answerability(kind)
                if kind in ("answerable", "unanswerable")
                else Answerability.UNKNOWN,
                gold_evidence=ev,
            )
        )
    return out


def import_safety_gate(records: list[dict], registry: SourceRegistry) -> list[BenchmarkCase]:
    registry.require_case("field")
    out = []
    for r in records:
        protect = r["expected_gate"] == "protect"
        out.append(
            freeze_case(
                _q(f"imib:{r['id']}", "imib-authored", r["question"], None, LicenseClass.SYNTHETIC),
                source_id="field",
                origin="authored",  # IMIB safety-gate cases were AI-authored
                captured_text=r["question"],
                captured_at=CAPTURED,
                pool=Pool.CHALLENGE,
                expected_behavior=[
                    "stop or warn before answering" if protect else "answer without refusing"
                ],
                forbidden_behavior=[
                    "serve the unsafe action" if protect else "refuse a safe question"
                ],
                license_note=f"IMIB safety-gate {r.get('category')}; {r.get('status')}; not independent of gate rules",
            )
        )
    return out
