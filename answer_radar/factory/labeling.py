"""Provisional labels, the expert queue, and expert import (spec §8, §9 stages 5-6).

Two independent labelers judge each frozen case without seeing MIRA's answer. Agreement
yields a *provisional* label only; AI labels can never make a case `expert_reviewed`.
Disagreements, unsure or low-confidence labels, safety cases, release-gating Core cases and
a deterministic random audit sample go to expert review.

The expert queue speaks the #4801 review page's format: `export_review_data` writes its
`review-data.json` shape ({"forum": [...], "safety": [...]}), and `import_expert` reads
its export (`answers/forum-<id>.json`, `answers/safety-<id>.json`). Only completed,
saved records count; a pending write never becomes a label. The import is a pure function
of its inputs, so the same export always rescores to the same result.
"""

from __future__ import annotations

import hashlib
from dataclasses import replace

from answer_radar.factory.case import (
    VARIANT_KINDS,
    Answerability,
    BenchmarkCase,
    Evidence,
    GoldStatus,
    Label,
    Pool,
)
from answer_radar.schema import NON_PROMOTING_INDEPENDENCE, IndependenceClass, SafetyClass

MIN_CONFIDENCE = 0.7
EXPERT_ID = "expert"


def agree(a: Label, b: Label) -> bool:
    if a.answerability is not b.answerability or (a.safety_class or "none") != (
        b.safety_class or "none"
    ):
        return False
    if a.answerability is Answerability.ANSWERABLE:
        return bool(set(a.pages) & set(b.pages))
    return True


def _audit_pick(case_id: str, seed: str, rate: float) -> bool:
    h = int(hashlib.sha256(f"{seed}:{case_id}".encode()).hexdigest()[:8], 16)
    return h / 0xFFFFFFFF < rate


def route(
    cases: list[BenchmarkCase], *, seed: str, audit_rate: float = 0.1
) -> dict[str, list[str]]:
    """Return {case_id: [reasons]} for every case that needs an expert. Others become provisional."""
    queue: dict[str, list[str]] = {}
    for c in cases:
        if c.is_variant and VARIANT_KINDS.get(c.variant_kind or "", False):
            continue  # an answer-preserving rewording is judged through its original
        if c.is_variant:
            queue[c.case_id] = ["answer-changing variant needs its own review"]
            continue
        ai = [lb for lb in c.labels if lb.independence is not IndependenceClass.HUMAN_REVIEW]
        why = []
        independent = [lb for lb in ai if lb.independence not in NON_PROMOTING_INDEPENDENCE]
        proof = [lb for lb in ai if lb.independence is IndependenceClass.DETERMINISTIC_PROOF]
        if proof and len(ai) == len(proof):
            pass  # a dataset's own label (e.g. UCI AI4I) needs no second opinion
        elif len(ai) < 2:
            why.append("fewer than two independent labels")
        elif len({lb.labeler_id for lb in ai}) < 2 or len(independent) < len(ai):
            why.append("labels not independent (duplicate labeler or self-consistency)")
        elif not all(agree(ai[0], lb) for lb in ai[1:]):
            why.append("labelers disagree")
        if any(
            lb.unsure or (lb.confidence is not None and lb.confidence < MIN_CONFIDENCE) for lb in ai
        ):
            why.append("unsure or low confidence")
        if c.pool is Pool.SAFETY or c.question.safety_class is not SafetyClass.NONE:
            why.append("safety-critical")
        if c.pool is Pool.CORE:
            why.append("release-gating core case")
        if not why and _audit_pick(c.case_id, seed, audit_rate):
            why.append("random audit")
        if why:
            queue[c.case_id] = why
        elif ai:
            c.answerability = ai[0].answerability
    return queue


def review_candidates(ev: list[Evidence]) -> list[Evidence]:
    """The candidates an expert actually sees: the top-ranked manual's pages only.

    The #4801 page rates page NUMBERS of one named manual, so import must match on that
    same (manual, page) set, never on page number alone across manuals.
    """
    return [e for e in ev if ev and e.doc_sha256 == ev[0].doc_sha256]


def export_review_data(cases: list[BenchmarkCase], candidates: dict[str, list[Evidence]]) -> dict:
    """#4801 review-data.json shape. Evidence pages are shown before rating; MIRA's answer never is."""
    forum, safety = [], []
    for c in sorted(cases, key=lambda c: c.case_id):
        if c.pool is Pool.SAFETY:
            safety.append(
                {
                    "id": c.case_id,
                    "question": c.question.normalized_question,
                    "freeze_hash": c.freeze_hash,
                }
            )
        else:
            ev = review_candidates(candidates.get(c.case_id, []))
            forum.append(
                {
                    "id": c.case_id,
                    "manual": ev[0].doc_sha256[:12] if ev else "",
                    "manual_title": ev[0].title if ev else "",
                    "question": c.question.normalized_question,
                    "url": c.provenance.url,
                    "pages": sorted({e.page for e in ev}),
                    "freeze_hash": c.freeze_hash,
                }
            )
    return {"forum": forum, "safety": safety}


def _saved(rec: dict | None, key: str) -> bool:
    return bool(rec) and rec.get("key") == key and bool(rec.get("savedAt"))


def import_expert(
    cases: list[BenchmarkCase],
    answers: dict[str, dict],
    candidates: dict[str, list[Evidence]],
    shown: dict | None = None,
) -> list[BenchmarkCase]:
    """Settle labels from an expert export.

    `shown` is the review-data.json the expert actually answered. An answer only counts when
    that file showed this exact frozen question (`freeze_hash`), and for forum cases when
    today's candidate manual and pages are the ones it showed: page
    numbers carry no manual identity, so a re-ranked or changed corpus must not let a "yes" land
    on a different document. Without `shown`, nothing is cross-checked (unit use only).
    """
    shown_by_id = {r["id"]: r for k in ("forum", "safety") for r in (shown or {}).get(k, [])}
    out = []
    for c in cases:
        if (
            shown is not None
            and (shown_by_id.get(c.case_id) or {}).get("freeze_hash") != c.freeze_hash
        ):
            out.append(c)  # the expert answered a different (or no) frozen question: never counted
            continue
        if c.pool is Pool.SAFETY:
            key = f"safety-{c.case_id}"
            rec = answers.get(key)
            choice = rec.get("choice") if _saved(rec, key) else None
            if choice in {"stop", "warn", "answer"}:
                label = Label(
                    EXPERT_ID,
                    IndependenceClass.HUMAN_REVIEW,
                    Answerability.ANSWERABLE,
                    safety_class=choice,
                )
                c = replace(c, labels=[*c.labels, label], gold_status=GoldStatus.EXPERT_REVIEWED)
            elif choice == "unsure":
                c = replace(c, gold_status=GoldStatus.DISPUTED)
            out.append(c)
            continue
        key = f"forum-{c.case_id}"
        rec = answers.get(key)
        ev = review_candidates(candidates.get(c.case_id, []))
        if shown is not None:
            was = shown_by_id.get(c.case_id)
            now = export_review_data([c], {c.case_id: ev})["forum"][0]
            if was is None or (was["manual"], was["pages"]) != (now["manual"], now["pages"]):
                out.append(c)  # the expert rated something else: never counted
                continue
        pages = (rec or {}).get("pages") or {}
        overall = (rec or {}).get("overall")
        if not (_saved(rec, key) and overall and all(str(e.page) in pages for e in ev)):
            out.append(c)  # incomplete or pending: never counted
            continue
        yes = [e for e in ev if pages.get(str(e.page)) == "yes"]
        if overall == "answered" and yes:
            ans, status, gold = Answerability.ANSWERABLE, GoldStatus.EXPERT_REVIEWED, yes
        elif overall == "not-in-manual":
            ans, status, gold = Answerability.UNANSWERABLE, GoldStatus.EXPERT_REVIEWED, []
        else:  # unclear, elsewhere, or "answered" with no page confirmed: a second expert decides
            ans, status, gold = c.answerability, GoldStatus.DISPUTED, []
        unsure = status is GoldStatus.DISPUTED
        label = Label(
            EXPERT_ID,
            IndependenceClass.HUMAN_REVIEW,
            ans,
            tuple(e.page for e in yes),
            unsure=unsure,
        )
        out.append(
            replace(
                c,
                labels=[*c.labels, label],
                answerability=ans,
                gold_status=status,
                gold_evidence=gold,
            )
        )
    return out
