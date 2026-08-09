"""Findings — stable identity for a campaign defect, and its disposition.

A conversation id is per-run (`t1_s42_013_reset_procedure`): it carries the
tier, the seed and the index, so the SAME defect gets a different id every
round. That makes "did we already know about this?" unanswerable, and it is why
the two tier-8 SUSPECTs sat untriaged across four rounds.

A *fingerprint* strips the run-varying parts and keeps what identifies the
defect — tier plus scenario name. `t1_013_reset_procedure` (round 1) and
`t1_s42_013_reset_procedure` (round 4) both fingerprint to `t1:reset_procedure`,
so a finding can be tracked, dispositioned once, and deduplicated against the
issues already open on GitHub.

The disposition file is the answer to "was it fixed, and did the fix land?" —
checked in, human-editable, and the thing the end-of-run report renders from.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

DISPOSITIONS_PATH = Path(__file__).parent / "dispositions.yml"

# Valid dispositions. OPEN is the default for anything newly seen.
OPEN = "OPEN"
FIXED = "FIXED"
FALSE_POSITIVE = "FALSE_POSITIVE"
NEEDS_RERUN = "NEEDS_RERUN"
STATUSES = (OPEN, FIXED, FALSE_POSITIVE, NEEDS_RERUN)

# Leading tier marker: "t1_", "t8_".
_TIER_RE = re.compile(r"^t(\d+)_")
# The conversation index is always a zero-padded 3-digit segment.
_INDEX_RE = re.compile(r"^\d{3}_")
# Tier 1/2 scenario ids prefix the seed with "s" ("t1_s42_013_name"); tier 8
# uses a bare seed ("t8_41_003_impatient"). The prefix is what disambiguates a
# seed from a scenario name that happens to start with digits, so a BARE numeric
# segment is only read as a seed on tier 8 — otherwise "t1_013_525_on_cv200"
# would lose the "525" that identifies it.
_SEED_RE = re.compile(r"^s\d+_")
_BARE_SEED_RE = re.compile(r"^\d+_(?=\d{3}_.)")


def fingerprint(conv_id: str, tier: int | str | None = None) -> str:
    """Stable `t<tier>:<scenario>` identity for a conversation id.

    Strips the seed and index so the same scenario maps to one finding across
    rounds. Falls back to the raw id when the shape is unrecognised — better a
    slightly noisy fingerprint than a collision between two real defects.
    """
    rest = conv_id
    m = _TIER_RE.match(rest)
    if m:
        tier = m.group(1)
        rest = rest[m.end() :]
    # Peel the seed, then the index.
    m2 = _SEED_RE.match(rest) or (_BARE_SEED_RE.match(rest) if str(tier) == "8" else None)
    if m2:
        rest = rest[m2.end() :]
    m3 = _INDEX_RE.match(rest)
    if m3:
        rest = rest[m3.end() :]
    rest = rest.strip("_")
    if not rest:
        return conv_id
    return f"t{tier}:{rest}" if tier is not None else rest


@dataclass
class Disposition:
    """What we decided about one finding, and whether the fix actually landed."""

    fingerprint: str
    status: str = OPEN
    summary: str = ""
    fix: str = ""
    applied: bool = False
    issue: str = ""
    first_seen: str = ""
    last_seen: str = ""
    note: str = ""
    convs: list[str] = field(default_factory=list)
    # Every run in which this was observed. first_seen/last_seen alone lose the
    # middle, and the middle is where the interesting shape lives — a defect
    # that failed, passed for two rounds, then came back reads as "seen c1..c5"
    # under an endpoints-only record.
    seen_in: list[str] = field(default_factory=list)
    # Human-approved ROOT CAUSE, distinct from the scenario that revealed it.
    # One defect can surface in several scenarios and one scenario can surface
    # several defects, so issue dedupe keys on this once a human has assigned it.
    defect_id: str = ""

    def as_dict(self) -> dict:
        d = {
            "status": self.status,
            "summary": self.summary,
            "fix": self.fix,
            "applied": self.applied,
            "issue": self.issue,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "note": self.note,
            "convs": sorted(set(self.convs)),
            "seen_in": list(dict.fromkeys(self.seen_in)),
            "defect_id": self.defect_id,
        }
        return {k: v for k, v in d.items() if v not in ("", [], None)} or {"status": self.status}


def load(path: Path | None = None) -> dict[str, Disposition]:
    """Read the disposition file. Missing file is an empty set, not an error."""
    p = path or DISPOSITIONS_PATH
    if not p.exists():
        return {}
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    out: dict[str, Disposition] = {}
    for fp, body in raw.items():
        body = body or {}
        status = body.get("status", OPEN)
        if status not in STATUSES:
            raise ValueError(
                f"{p}: finding {fp!r} has unknown status {status!r} (expected {STATUSES})"
            )
        out[fp] = Disposition(
            fingerprint=fp,
            status=status,
            summary=body.get("summary", ""),
            fix=body.get("fix", ""),
            applied=bool(body.get("applied", False)),
            issue=str(body.get("issue", "") or ""),
            first_seen=body.get("first_seen", ""),
            last_seen=body.get("last_seen", ""),
            note=body.get("note", ""),
            convs=list(body.get("convs", []) or []),
            seen_in=list(body.get("seen_in", []) or []),
            defect_id=body.get("defect_id", "") or "",
        )
    return out


def save(dispositions: dict[str, Disposition], path: Path | None = None) -> Path:
    """Write the disposition file, sorted so diffs stay readable."""
    p = path or DISPOSITIONS_PATH
    body = {fp: dispositions[fp].as_dict() for fp in sorted(dispositions)}
    header = (
        "# Campaign findings — one row per DEFECT (not per conversation).\n"
        "# Keyed by fingerprint from findings.fingerprint(); see that module for why.\n"
        "# status: OPEN | FIXED | FALSE_POSITIVE | NEEDS_RERUN\n"
        "# applied: true only once the fix is merged to main.\n"
    )
    p.write_text(
        header + yaml.safe_dump(body, sort_keys=True, allow_unicode=True), encoding="utf-8"
    )
    return p


def summarize_verdict(verdict_record: dict) -> str:
    """A one-line human summary for a newly-seen finding.

    The judge's `notes` is the best available description of what went wrong;
    tier 1/2 scripted failures have none, so fall back to naming the scenario
    and the expectation it missed. Anything is better than the placeholder that
    ends up in a GitHub issue title.
    """
    note = (verdict_record.get("notes") or "").strip()
    if note:
        return " ".join(note.split())[:200]
    conv = verdict_record.get("conv", "")
    scenario = fingerprint(conv, verdict_record.get("tier")).split(":", 1)[-1].replace("_", " ")
    cat = verdict_record.get("category") or ""
    verdict = verdict_record.get("verdict", "FAIL")
    tail = f" ({cat})" if cat and cat != "UNTRIAGED" else ""
    return f"scripted scenario '{scenario}' returned {verdict}{tail}"


def observe(
    dispositions: dict[str, Disposition],
    conv_id: str,
    tier: int | str,
    campaign: str,
    summary: str = "",
) -> Disposition:
    """Record that a finding was seen in this run, creating it if new.

    Never downgrades a human decision: an existing FIXED / FALSE_POSITIVE row
    keeps its status. Re-appearing after a fix is a real signal, so that case is
    surfaced by the report (see `regressed`) rather than silently reopened here.
    """
    fp = fingerprint(conv_id, tier)
    d = dispositions.get(fp)
    if d is None:
        d = Disposition(fingerprint=fp, status=OPEN, summary=summary, first_seen=campaign)
        dispositions[fp] = d
    if not d.summary and summary:
        d.summary = summary
    d.last_seen = campaign
    if campaign not in d.seen_in:
        d.seen_in.append(campaign)
    if not d.first_seen:
        d.first_seen = d.seen_in[0]
    if conv_id not in d.convs:
        d.convs.append(conv_id)
    return d


def regressed(d: Disposition, campaign: str) -> bool:
    """A fixed-and-applied finding that failed again in a LATER run.

    The run where the defect was originally found, and the runs already recorded
    against it, are not regressions — the fix came after them. Only a sighting in
    a run the disposition has never seen means the fix stopped holding. Without
    that guard, re-rendering an old report announces every since-fixed defect as
    a regression.
    """
    if d.status != FIXED or not d.applied:
        return False
    # Any run already on record predates (or produced) the fix decision. Only a
    # sighting in a run this finding has NEVER been seen in means it came back.
    known = set(d.seen_in) | {d.first_seen, d.last_seen}
    return campaign not in known
