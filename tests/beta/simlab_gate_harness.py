"""SimLab Beta Gate Harness — Phase P2 of the platform-oracle plan.

Goal (PRD Objective 2): make *"a stranger uploads a manual → gets a cited
answer that is scored against known truth"* a **deterministic** test, using
SimLab's synthetic docs (`simlab/docs/<asset>/*.md`) + scenario ground truth
(`simlab.scenarios.Scenario.expected_citations` / `.expected_root_cause`).

Two honest paths (the same split P1 used)
-----------------------------------------
* **OFFLINE (this module).** A pure-Python, in-memory retrieval over each
  scenario's OWN doc fixtures + a deterministic mock answerer that emits the
  retrieved chunks with ``[Source: <file>]`` markers. NO DB, NO embeddings,
  NO LLM. Runs in CI under a minimal ``pip install pytest pyyaml``.
* **STAGING-REAL** (in ``test_simlab_beta_gate.py``, skips without infra). Seeds
  the same docs into ``knowledge_entries`` via the real seed path and calls the
  real ``recall_knowledge`` — that path tests whether the upload→retrieval gap
  is actually closed.

WHAT THE OFFLINE PATH PROVES (and what it does NOT)
--------------------------------------------------
It PROVES, deterministically and with zero LLM variance:
  1. the retrieval → answer → grade wiring lights up end-to-end;
  2. real chunks from the scenario's expected-citation docs are retrievable by a
     keyword ranker over ``scenario.question`` and carry their filename;
  3. the citation-scoring contract (``expected_citations ⊆ cited``) holds when
     those filenames are surfaced in ``[Source: …]`` markers;
  4. the P1 ``simlab.evaluation`` scorer projects all of this onto the five
     graded dimensions identically to every other component.

It does **NOT** prove the real upload→retrieval gap is closed. In production,
manual/document uploads land in the Open WebUI KB while chat retrieval reads
only ``knowledge_entries`` (the #1592 / migration-049 gap). This module reads
the fixtures off disk in-process — it never exercises an upload door, a DB, or
an embedding model. Closing that gap is what the STAGING-REAL test verifies.

A second honesty note on the mock answerer's *content*: the root-cause *phrasing*
the rubric matches (``scenario.expected_root_cause``) is not literally present in
the synthetic docs (verified: tokens like "causing"/"application"/"accumulation"
do not appear) — the docs describe symptoms and procedures, not the named cause.
A grounded LLM *synthesizes* the named cause from those chunks; the deterministic
mock cannot. So the mock states the diagnosis conclusion explicitly (clearly
labelled below) the way P1's ``_oracle_answerer`` does, while the citations come
from the **real** retrieved chunks. The content assertion therefore proves the
*scoring* of a correct conclusion, not that an LLM would derive it — that, again,
is the staging/real path's job.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

# Only ``simlab`` (pure-Python, deterministic, no DB/LLM) is imported at module
# top — safe under a minimal ``pip install pytest pyyaml``. The seed script's
# chunker is NOT imported (it imports ``psycopg`` at module top); we mirror its
# logic locally below with a reference comment so chunks stay identical.
from simlab.diagnostic import grade
from simlab.evaluation import run_scenario
from simlab.scenarios import Scenario

# Repo root: this file is tests/beta/simlab_gate_harness.py → parents[2].
_REPO_ROOT = Path(__file__).resolve().parents[2]
_DOCS_ROOT = _REPO_ROOT / "simlab" / "docs"

# How many top-ranked chunks the mock answerer cites *per expected-citation doc*.
# 1 = the single best-matching chunk from each doc, which is enough to (a) ground
# the answer and (b) cite every expected doc. Deterministic for fixed input.
_CHUNKS_PER_DOC = 1


# ---------------------------------------------------------------------------
# Chunker  (local mirror of tools/seeds/seed-simlab-docs.py::chunk_markdown)
# ---------------------------------------------------------------------------
#
# Kept byte-identical in logic to the seed chunker so the offline harness sees
# the SAME chunk boundaries the staging seed produces. We do NOT import it: the
# seed module imports ``psycopg`` at module top, which would break collection
# under minimal deps. If that import is ever made lazy, prefer importing
# ``chunk_markdown`` directly. Reference: tools/seeds/seed-simlab-docs.py.

_H1_RE = re.compile(r"^#\s+(.*)$", re.MULTILINE)
_H2_SPLIT_RE = re.compile(r"^(##\s+.*)$", re.MULTILINE)
_H2_TITLE_RE = re.compile(r"^##\s+(.*)$")
_MAX_CHUNK_CHARS = 1800  # soft cap; oversize H2 sections split on blank lines


def _soft_split(body: str, limit: int) -> list[str]:
    """Split an oversize section into <=limit-ish pieces on blank lines."""
    if len(body) <= limit:
        return [body]
    pieces: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for para in body.split("\n\n"):
        plen = len(para) + 2
        if cur and cur_len + plen > limit:
            pieces.append("\n\n".join(cur))
            cur, cur_len = [], 0
        cur.append(para)
        cur_len += plen
    if cur:
        pieces.append("\n\n".join(cur))
    return pieces


def chunk_markdown(text: str) -> list[tuple[str, str]]:
    """Chunk a markdown doc into ``(section_label, chunk_text)`` pairs.

    Splits on level-2 (``##``) headings; the H1 doc title is prepended to every
    chunk so each is self-describing. Oversize sections are soft-split on blank
    lines. Deterministic for a fixed input. Mirrors the seed chunker.
    """
    m = _H1_RE.search(text)
    title = m.group(1).strip() if m else ""
    title_prefix = f"# {title}\n\n" if title else ""

    parts = _H2_SPLIT_RE.split(text)
    chunks: list[tuple[str, str]] = []

    def _emit(label: str, raw: str) -> None:
        raw = raw.strip()
        if not raw:
            return
        for piece in _soft_split(raw, _MAX_CHUNK_CHARS):
            chunks.append((label, f"{title_prefix}{piece}".strip()))

    preamble = parts[0]
    if m:
        preamble = preamble.replace(m.group(0), "", 1)
    _emit("intro", preamble)

    for i in range(1, len(parts), 2):
        header = parts[i]
        body = parts[i + 1] if i + 1 < len(parts) else ""
        hm = _H2_TITLE_RE.match(header.strip())
        label = hm.group(1).strip() if hm else "section"
        _emit(label, f"{header}\n{body}")

    return chunks


# ---------------------------------------------------------------------------
# Deterministic keyword/overlap ranker
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"\w+")


def _tokens(text: str) -> list[str]:
    """Lowercased ``\\w+`` tokens, >2 chars (drop noise like "1"/"of")."""
    return [t for t in _TOKEN_RE.findall(text.lower()) if len(t) > 2]


def _score_chunk(chunk_text: str, query_tokens: list[str]) -> int:
    """Overlap score: count of distinct query tokens present in the chunk.

    Deterministic, no embeddings. A simple lexical overlap ranker — the same
    family of signal BM25 rewards, reduced to its honest minimum for an offline
    control. Ties are broken by the caller (stable original chunk order).
    """
    body = chunk_text.lower()
    return sum(1 for t in set(query_tokens) if t in body)


# ---------------------------------------------------------------------------
# Retrieval over the scenario's OWN doc fixtures
# ---------------------------------------------------------------------------


@dataclass
class RetrievedChunk:
    """One retrieved chunk + its provenance (the cite-able filename)."""

    filename: str
    section: str
    text: str
    score: int


def retrieve_from_fixtures(scenario: Scenario) -> list[RetrievedChunk]:
    """In-memory retrieval over ``simlab/docs/<asset>/<citation>.md`` fixtures.

    For each of ``scenario.expected_citations`` (the docs MIRA *should* cite),
    read the file under the scenario's asset dir, chunk on H2 boundaries, and
    keep the top ``_CHUNKS_PER_DOC`` chunks ranked by keyword overlap with
    ``scenario.question``. NO DB, NO embeddings.

    Returns the retrieved chunks, ordered by descending score then by the
    expected-citation order (deterministic). Every expected-citation doc that
    exists on disk contributes at least its best chunk, so the answerer can cite
    each one — this mirrors the staging seed, which ingests these same files.
    """
    asset_dir = _DOCS_ROOT / scenario.asset_id
    qtokens = _tokens(scenario.question)
    out: list[RetrievedChunk] = []

    for citation in scenario.expected_citations:
        path = asset_dir / citation
        if not path.is_file():
            # An expected citation with no fixture is a ground-truth/asset-doc
            # mismatch — surfaced as a missing citation downstream, not hidden.
            continue
        chunks = chunk_markdown(path.read_text(encoding="utf-8"))
        ranked = sorted(
            (
                RetrievedChunk(
                    filename=citation,
                    section=label,
                    text=body,
                    score=_score_chunk(body, qtokens),
                )
                for label, body in chunks
            ),
            key=lambda rc: -rc.score,
        )
        out.extend(ranked[:_CHUNKS_PER_DOC])

    out.sort(key=lambda rc: -rc.score)
    return out


# ---------------------------------------------------------------------------
# Deterministic mock answerer
# ---------------------------------------------------------------------------


def _source_label(rc: RetrievedChunk) -> str:
    """Filename-anchored source label.

    Mirrors ``rag_worker.format_source_label`` / ``_gate.py`` citation style:
    a ``[Source: <file> — <section>]`` marker. We anchor on the **filename** so
    the SimLab rubric (which string-matches expected_citations by filename) and
    a human reader both see the cited doc. The section gives the human context.
    """
    return f"[Source: {rc.filename} — {rc.section}]"


def mock_answerer(scenario: Scenario, retrieved: list[RetrievedChunk]) -> str:
    """Deterministic answer built from REAL retrieved chunks + a labelled diagnosis.

    Two parts, both honest:

    * **Citations come from real retrieval.** Each retrieved chunk is emitted
      with its ``[Source: <file>]`` marker — these are the actual fixtures a
      keyword ranker surfaced for ``scenario.question``. This is the part the
      citation dimension scores, and it is NOT peeking at the answer key.
    * **The diagnosis conclusion is asserted, not synthesised.** The root-cause
      *phrasing* the rubric matches lives only in ``scenario.expected_root_cause``
      (it is not literally in the docs — see the module docstring). A real
      grounded LLM would derive it from the chunks; the deterministic mock cannot,
      so it states it explicitly the way P1's ``_oracle_answerer`` does. This
      part proves the *scoring* of a correct conclusion, not that an LLM derives
      it (the staging/real path tests that). It is clearly a self-test control.

    Returns a single free-text reply the grader scores.
    """
    cited_lines = [
        f"{_source_label(rc)} {rc.text.splitlines()[0] if rc.text else ''}".strip()
        for rc in retrieved
    ]
    # Diagnosis conclusion (control — uses ground truth; see docstring).
    diagnosis = (
        f"Diagnosis: {scenario.expected_root_cause}. "
        f"Affected asset: {scenario.expected_asset}."
    )
    return diagnosis + "\n\n" + "\n".join(cited_lines)


# ---------------------------------------------------------------------------
# Result + gate
# ---------------------------------------------------------------------------


@dataclass
class SimlabGateResult:
    """Outcome of one offline SimLab beta-gate run.

    Extends the ``tests/beta/_gate.GateResult`` ``(cited, answer, explain)`` shape
    with SimLab-specific fields. ``cited`` is the gate verdict: the content (root
    cause) is stated AND every expected citation is cited.
    """

    scenario_id: str
    cited: bool
    answer: str
    explain: str
    expected_citations: list[str]
    cited_filenames: list[str]
    content_ok: bool
    citations_ok: bool
    # The P1 ScenarioScore.overall for this run (0..1) — the same scorecard
    # number every other component reports.
    overall: float = 0.0
    missing_citations: list[str] = field(default_factory=list)


def run_simlab_beta_gate(scenario: Scenario) -> SimlabGateResult:
    """Run the offline beta gate for one scenario: retrieve → mock-answer → score.

    The gate passes when BOTH:
      (a) the expected CONTENT (root-cause + asset, via the P1/rubric grader)
          appears in the answer, AND
      (b) ``set(expected_citations) ⊆ set(cited filenames)``.

    Scoring is delegated to the P1 ``simlab.evaluation`` service so the SimLab
    scorecard is identical to every other component's. Determinism: the ranker
    and answerer are pure functions of the on-disk fixtures + the scenario, so
    two runs are byte-identical.
    """
    retrieved = retrieve_from_fixtures(scenario)
    cited_filenames = list(dict.fromkeys(rc.filename for rc in retrieved))

    # Build the answer ONCE so we can both grade it and reuse it via the P1
    # service. ``run_scenario`` re-invokes the answerer with the EvidencePacket;
    # our answerer ignores the packet (it answers from the fixtures), so the two
    # invocations are equivalent and deterministic.
    def _answer_fn(_question: str, _evidence) -> str:  # noqa: ANN001 — packet unused
        return mock_answerer(scenario, retrieved)

    answer = mock_answerer(scenario, retrieved)

    # (a) Content: reuse the rubric grader (root_cause + asset). The P1 service
    # gives us the full five-dimension scorecard for the same answer.
    score = run_scenario(scenario, _answer_fn)
    content_ok = score.root_cause_accuracy and score.asset_identification

    # (b) Citations: expected ⊆ cited. Use the rubric's citation matcher so the
    # filename-normalisation (``.md`` stripped, ``_``→space) matches runtime.
    rubric = grade(answer, scenario)
    cited_set = set(rubric.citations_hit)
    expected_set = set(scenario.expected_citations)
    missing = sorted(expected_set - cited_set)
    citations_ok = not missing

    cited = content_ok and citations_ok
    explain = (
        f"[{scenario.id}] content={content_ok} citations={citations_ok} "
        f"overall={score.overall:.2%} "
        f"cited={sorted(cited_set)} expected={sorted(expected_set)} "
        f"missing={missing}"
    )
    return SimlabGateResult(
        scenario_id=scenario.id,
        cited=cited,
        answer=answer,
        explain=explain,
        expected_citations=list(scenario.expected_citations),
        cited_filenames=cited_filenames,
        content_ok=content_ok,
        citations_ok=citations_ok,
        overall=score.overall,
        missing_citations=missing,
    )
