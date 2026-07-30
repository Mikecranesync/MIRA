# Runbook — add an evidence producer (new adapter / kind)

**Audience:** agents + humans · **Hub:** [`bravo-evidence-lane.md`](../architecture/bravo-evidence-lane.md) ·
**Catalog:** [`evidence-catalog.md`](../architecture/evidence-catalog.md)

Use this when a new specialist system needs to feed the one brain. The rule (ADR-0033 Rule 3):
a system that cannot express its output as **typed evidence + confidence + provenance** does not
participate in answers. So you add an **adapter**, never a new prompt path or a second assistant.

## Decide first: new kind, or reuse an existing one?

- Reuse an existing `EvidenceKind` if your output is the same *shape* of fact (e.g. another
  manual-like source → `manual_chunk`). Prefer reuse.
- Add a new `EvidenceKind` only for a genuinely new fact shape. New kind ⇒ new **citation
  prefix letter** — pick a **free** one (taken: `M D G P O H W R T V`; see catalog §A).

## Steps

1. **Write the failing test first** (TDD — repo doctrine). Add
   `tests/test_<producer>_adapter.py` asserting: (a) rows map to the right kind, (b) trust
   defaults to `candidate`, (c) **only a human signal** promotes to `verified`, (d) rejected/
   superseded rows drop, (e) provenance (`producer_name`, citation id) is set, (f) it is pure
   (no I/O, no network). Model it on `tests/test_visual_session_adapter.py` (PR #3016).
2. **Add the adapter** `evidence_from_<x>(rows) -> list[EvidenceItem]` to
   `materialized_evidence/context_contract.py`. Keep it **pure and additive** — no new manifest
   fields (hash-law), no mutation of `EvidenceManifest`.
3. **Stamp trust honestly.** Default `"candidate"`. Promote to `"verified"` *only* on a human
   review signal. Model `confidence` and machine-verification states never promote (hub §3).
4. **Set provenance.** `producer_name="<system>"`, `citation_id=f"<Letter>{i}"`.
5. **If it's a new kind**, add the value to the `EvidenceKind` enum.
6. **Update the [catalog](../architecture/evidence-catalog.md) §A** — one row: kind, adapter
   `:line`, producer, source, cite, trust default. This is not optional: the drift-guard
   (`tests/test_evidence_catalog_sync.py`) fails the build if a kind/adapter is missing here.
7. **Verify** — [verify-the-spine runbook](./evidence-verify-the-spine.md). Adapter tests +
   `test_context_contract.py` + `test_evidence_catalog_sync.py` green; ruff clean.

## Guardrails (do not violate)

- **Read-only.** No `allowed_actions` string may contain a `FORBIDDEN_ACTION_SUBSTRINGS` member.
- **Producer, not speaker.** The adapter returns evidence; it never calls a model or answers.
- **Additive only.** Don't touch `EvidenceManifest` fields or existing adapters' behavior.
- **Bravo boundary.** If the producer runs on Bravo, it materializes evidence — it is not a
  second assistant (`NORTH_STAR.md` § "Bravo runtime boundary").

## Follow-up: generate the catalog (tracked)

The catalog is hand-maintained today, kept honest by the name-level drift-guard. The tracked
enhancement is a small generator that introspects `context_contract.py` (the `EvidenceKind` enum
+ `evidence_from_*` defs) and **emits** catalog §A, so it *cannot* drift. Do that once the
hand-written shape has proven stable — it is a docs-tooling follow-up, not a runtime change.
