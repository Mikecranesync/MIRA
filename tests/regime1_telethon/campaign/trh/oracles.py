"""Expected-evidence oracles — what the corpus SHOULD have answered with.

Without an oracle, "retrieval is bad" is an opinion. With one, it is a rank.

The distinction this module exists to make, and the one the 5-seed run got
wrong by collapsing three issues into one root cause:

    the expected passage does not exist in the corpus   -> INGEST
    it exists but never enters the retrieved set        -> RETRIEVAL
    it enters but ranks far down / behind a wrong sense -> RETRIEVAL (with rank)
    it is retrieved and the answer ignores it           -> EVIDENCE / GENERATION

`corpus_coverage()` decides the first line and **the caller must stop there** —
per the directive and per measurement, retrieval tuning against absent content
is wasted work. PowerFlex 525 has 113 fault-clear passages; AutomationDirect has
zero across 4,295 rows. Same symptom on the wire, opposite repair.

## Polysemy traps

`forbidden_evidence` records the *wrong senses* that currently win. This is not
decoration: for "how do I reset it" on a PF525, ranks 0-2 are position reset,
F111 safety-hardware reset, and rotor reset. Recording them turns "retrieval is
weak" into "retrieval is retrieving a different sense of the word", which is a
different fix. A trap hit alongside an expected miss is the signature.

## Matching is substring-on-normalised-text, deliberately

Chunk ids are not stable across re-ingest (re-chunking renumbers everything), so
an oracle keyed on ids would rot silently and read as a regression. Keyed on a
distinctive phrase, it survives re-chunking and fails loudly only when the
CONTENT actually goes missing — which is the thing worth alarming on.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ORACLE_PATH = Path(__file__).parent / "oracles.yml"


def _norm(text: str) -> str:
    """Collapse whitespace and case; strip the typographic noise PDFs inject."""
    text = (text or "").lower()
    text = text.replace("’", "'").replace("“", '"').replace("”", '"')
    text = text.replace("•", " ").replace("–", "-").replace("—", "-")
    return " ".join(text.split())


@dataclass(frozen=True)
class ExpectedEvidence:
    """One passage that must exist, and ought to be retrieved."""

    match: str
    why: str = ""
    #: Where a human can verify it — page/section. Never used for matching.
    locator: str = ""

    def matches(self, text: str) -> bool:
        return _norm(self.match) in _norm(text)


@dataclass(frozen=True)
class EvidenceHit:
    expected: ExpectedEvidence
    rank: int
    meta: dict = field(default_factory=dict)


@dataclass
class Oracle:
    """The known-correct answer surface for one fixture."""

    id: str
    question_intent: str = ""
    scope: dict[str, str] = field(default_factory=dict)
    expected_evidence: list[ExpectedEvidence] = field(default_factory=list)
    forbidden_evidence: list[ExpectedEvidence] = field(default_factory=list)
    #: Tokens/phrases a CORRECT answer would contain. Behaviour, not vocabulary
    #: policing — see the CIT-005 correction, where grading on the literal words
    #: "manufacturer/model" penalised a better-phrased reply. Any ONE suffices.
    answer_tokens: list[str] = field(default_factory=list)
    #: Seed questions the synthetic generator paraphrases.
    seed_questions: list[str] = field(default_factory=list)
    notes: str = ""

    # -- INGEST ----------------------------------------------------------

    def corpus_coverage(self, corpus) -> tuple[list[ExpectedEvidence], list[ExpectedEvidence]]:
        """(present, missing) within THIS ORACLE'S VENDOR SCOPE.

        `corpus` is anything with `.contains_phrase(str, scope) -> bool | None`.
        A None answer means "could not determine" and is counted as PRESENT —
        the fail-safe direction, matching `fabrication.CorpusIndex`: silence
        must never manufacture an INGEST failure out of a network blip.

        **The scope is load-bearing, not an optimisation.** An unscoped lookup
        asks "does this phrase exist anywhere", and the answer for
        "clear the fault by one of these methods" is yes — in *Rockwell's*
        manual. That would score the GS10 oracle's INGEST as PASS and send the
        next investigation off to tune retrieval for a vendor that has no
        fault-clear documentation at all. Scoped, the same probe correctly
        returns missing for AutomationDirect and present for PowerFlex 525:
        one probe, two verdicts, which is the whole point of keeping both
        oracles in the registry.
        """
        present: list[ExpectedEvidence] = []
        missing: list[ExpectedEvidence] = []
        for e in self.expected_evidence:
            got = corpus.contains_phrase(e.match, self.scope)
            if got is False:
                missing.append(e)
            else:
                present.append(e)
        return present, missing

    # -- RETRIEVAL -------------------------------------------------------

    def retrieval_hits(
        self, retrieved_meta: list[dict]
    ) -> tuple[list[EvidenceHit], list[ExpectedEvidence]]:
        """(hits with rank, expected passages that never appeared)."""
        hits: list[EvidenceHit] = []
        seen: set[str] = set()
        for rank, meta in enumerate(retrieved_meta or []):
            text = _chunk_text(meta)
            for e in self.expected_evidence:
                if e.match in seen:
                    continue
                if e.matches(text):
                    hits.append(EvidenceHit(e, rank, meta))
                    seen.add(e.match)
        missing = [e for e in self.expected_evidence if e.match not in seen]
        return hits, missing

    def trap_hits(self, retrieved_meta: list[dict]) -> list[EvidenceHit]:
        """Known WRONG-SENSE passages that made it into the retrieved set."""
        out: list[EvidenceHit] = []
        for rank, meta in enumerate(retrieved_meta or []):
            text = _chunk_text(meta)
            for e in self.forbidden_evidence:
                if e.matches(text):
                    out.append(EvidenceHit(e, rank, meta))
        return out

    # -- SCOPE -----------------------------------------------------------

    def scope_matches(self, resolved: str) -> tuple[bool, str]:
        """Did MIRA land on the right machine?

        Compared loosely on purpose: the resolver legitimately renders the same
        asset as "Rockwell Automation, 525", "Allen-Bradley PowerFlex 525", or
        "PowerFlex 525". Requiring one spelling would fail correct behaviour —
        the vocabulary-grading mistake, one layer down.
        """
        got = _norm(resolved)
        if not got:
            return False, "nothing resolved"
        model = _norm(self.scope.get("model", ""))
        # Model identity is what actually scopes retrieval; manufacturer naming
        # varies far more (Rockwell / Allen-Bradley are the same vendor).
        if model:
            digits = re.findall(r"\d{2,4}", model)
            if digits and not any(d in got for d in digits):
                return False, f"resolved {resolved!r}, expected model {self.scope['model']!r}"
            if not digits and model not in got:
                return False, f"resolved {resolved!r}, expected model {self.scope['model']!r}"
        forbidden = self.scope.get("not_model", "")
        if forbidden and _norm(forbidden) in got:
            return False, f"resolved the wrong machine {resolved!r} (trap: {forbidden!r})"
        return True, f"resolved {resolved!r}, consistent with {self.scope.get('model', '?')!r}"

    # -- GENERATION ------------------------------------------------------

    def answer_uses_evidence(self, reply: str) -> str | None:
        """The first expected answer token the reply actually contains, if any."""
        low = _norm(reply)
        for tok in self.answer_tokens:
            if _norm(tok) in low:
                return tok
        return None


def _chunk_text(meta: dict) -> str:
    """Best available text for a retrieved chunk.

    The probe records metadata and a snippet, never full corpus content (the
    ledger must not become a corpus copy). Whatever text IS present is what an
    oracle can match on.
    """
    if not isinstance(meta, dict):
        return str(meta)
    for key in ("content", "snippet", "text", "excerpt"):
        if meta.get(key):
            return str(meta[key])
    return " ".join(str(meta.get(k, "")) for k in ("manufacturer", "model_number", "source_type"))


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def _parse_evidence(raw: Any) -> list[ExpectedEvidence]:
    out: list[ExpectedEvidence] = []
    for item in raw or []:
        if isinstance(item, str):
            out.append(ExpectedEvidence(match=item))
        else:
            out.append(
                ExpectedEvidence(
                    match=item["match"],
                    why=item.get("why", ""),
                    locator=item.get("locator", ""),
                )
            )
    return out


def load(path: Path | None = None) -> dict[str, Oracle]:
    """Load the oracle registry. Returns {} when the file is absent."""
    path = path or ORACLE_PATH
    if not path.exists():
        return {}
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: dict[str, Oracle] = {}
    for entry in raw.get("oracles", []):
        oracle = Oracle(
            id=entry["id"],
            question_intent=entry.get("question_intent", ""),
            scope=entry.get("scope", {}) or {},
            expected_evidence=_parse_evidence(entry.get("expected_evidence")),
            forbidden_evidence=_parse_evidence(entry.get("forbidden_evidence")),
            answer_tokens=entry.get("answer_tokens", []) or [],
            seed_questions=entry.get("seed_questions", []) or [],
            notes=entry.get("notes", ""),
        )
        out[oracle.id] = oracle
    return out


def for_case(case_id: str, registry: dict[str, Oracle] | None = None) -> Oracle | None:
    """Resolve the oracle for a campaign conversation id.

    Campaign ids look like `t1_s42_013_reset_procedure`; oracle ids are the
    scenario stem (`reset_procedure`). Longest-suffix wins so
    `reset_procedure_gs10` is preferred over `reset_procedure` when both exist.
    """
    reg = registry if registry is not None else load()
    if not reg:
        return None
    if case_id in reg:
        return reg[case_id]
    matches = [oid for oid in reg if case_id.endswith(oid)]
    if matches:
        return reg[max(matches, key=len)]
    return None


# ---------------------------------------------------------------------------
# Corpus adapters
# ---------------------------------------------------------------------------


def scope_key(scope: dict[str, str] | None) -> str:
    """Stable cache key for a vendor scope."""
    if not scope:
        return "*"
    return f"{_norm(scope.get('manufacturer', ''))}|{_norm(scope.get('model', ''))}"


class PhraseCorpus:
    """Wraps a live DB lookup for `contains_phrase`, with a scoped cache.

    Mirrors `fabrication.CorpusIndex`'s contract exactly, including its
    fail-safe: an unresolvable phrase returns None ("unproven"), never False.
    A grader that read a DB outage as "the manual is missing" would file INGEST
    defects for a network blip.

    Cache keys include the scope, so the same phrase can be cached as present
    for Rockwell and absent for AutomationDirect — which is exactly the pair the
    PF525/GS10 oracles rely on.
    """

    def __init__(self, fetch=None, cache: dict[str, bool] | None = None):
        self._fetch = fetch
        self._cache: dict[str, bool] = dict(cache or {})

    def contains_phrase(self, phrase: str, scope: dict[str, str] | None = None) -> bool | None:
        key = f"{scope_key(scope)}::{_norm(phrase)}"
        if key in self._cache:
            return self._cache[key]
        if self._fetch is None:
            return None
        try:
            got = bool(self._fetch(phrase, scope or {}))
        except Exception:  # noqa: BLE001 - unproven, never "absent"
            return None
        self._cache[key] = got
        return got

    def as_cache(self) -> dict[str, bool]:
        return dict(self._cache)


class HarnessCorpus:
    """Both lookups the graders need, behind one object.

    INGEST asks `contains_phrase(phrase, scope)`; GROUNDING asks `exists(token)`
    via `fabrication.CorpusIndex`. Passing a bare `PhraseCorpus` used to make the
    GROUNDING grader raise AttributeError, which its fail-safe turned into
    INCONCLUSIVE — so a real fabrication silently stopped being reported and the
    report looked cleaner than the data. Exactly the optimistic-direction failure
    this harness exists to catch, so the two lookups are bundled rather than left
    to the caller to remember.

    Both halves keep the fail-safe: unresolved is None ("unproven"), never False.
    """

    def __init__(self, phrases: PhraseCorpus, tokens=None):
        self._phrases = phrases
        self._tokens = tokens

    def contains_phrase(self, phrase: str, scope: dict[str, str] | None = None) -> bool | None:
        return self._phrases.contains_phrase(phrase, scope)

    def exists(self, token: str) -> bool | None:
        if self._tokens is None:
            return None
        return self._tokens.exists(token)


def neon_phrase_corpus(cache: dict[str, bool] | None = None) -> PhraseCorpus:
    """A `PhraseCorpus` backed by staging Neon (read-only existence check).

    Vendor scoping is `manufacturer OR model_number`, deliberately the broader
    of the two: it asks "does this VENDOR's documentation contain the passage
    anywhere", which is the honest INGEST question. Scoping on model alone would
    call PF525 content missing for any vendor whose rows are mis-tagged — and
    mis-tagging is a finding to report (#3177), not a reason to fabricate an
    INGEST failure for content that is actually present.
    """

    def _fetch(phrase: str, scope: dict[str, str]) -> bool:
        import os

        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        url = os.environ.get("NEON_DATABASE_URL")
        if not url:
            raise RuntimeError("NEON_DATABASE_URL not set")
        eng = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
        params: dict[str, str] = {"p": f"%{phrase}%"}
        # The tenant predicate is written LITERALLY in the SQL string rather than
        # joined from a list, so the Architecture Check can statically verify it
        # (`tools/qa/security/check_knowledge_entries_filters.py`). A dynamically
        # assembled WHERE reads as UNFILTERED and the only alternative is a
        # line-keyed allowlist entry, which shifts on every edit to this file and
        # has repeatedly failed CI as a phantom "UNFILTERED".
        #
        # Anonymous read: shared OEM corpus only (is_private = false). This is a
        # read-only existence probe for oracle coverage — it never returns content
        # and never touches per-tenant uploads.
        vendor_or = []
        if scope.get("manufacturer"):
            vendor_or.append("manufacturer ILIKE :mfr")
            params["mfr"] = f"%{scope['manufacturer']}%"
        if scope.get("model"):
            vendor_or.append("model_number ILIKE :mdl")
            params["mdl"] = f"%{scope['model']}%"
        vendor_clause = f" AND ({' OR '.join(vendor_or)})" if vendor_or else ""
        sql = (
            "SELECT 1 FROM knowledge_entries "
            "WHERE is_private = false "
            "AND content ILIKE :p"
            f"{vendor_clause} "
            "LIMIT 1"
        )
        with eng.connect() as conn:
            return bool(conn.execute(text(sql), params).first())

    return PhraseCorpus(fetch=_fetch, cache=cache)
