# Unseen-manual standard: protocol (frozen before any question is written)

**Purpose.** The 77-question retrieval harness is now development data: we have read its failures, and every fix will be tuned against it. This protocol defines a second set, never inspected while building fixes. It is the standard a retrieval or answer change must pass before staging.

## 1. Manuals

- **How many:** 8–10 public OEM manuals from vendors and product families not used in any earlier test. That excludes everything in `tools/evidence-runoff/bench/manuals_t4.json`, `public-50.json`, and the round-1 and held-out table sets.
- **Where from:** each comes from the manufacturer's official site.
- **What's recorded:** the source URL, sha256 and page count go in `.planning/unseen-set/manifest.json`.
- **What qualifies:** text-based PDFs (no scans), English, with specification, parameter and fault tables and procedures.

## 2. Questions and gold

- **How many:** about 8 per manual, about 70 in total, in this mix:
  - **Table cell lookup (about 30%):** "What is X for Y?" The right row and column are both needed, and a neighbouring cell must not answer it.
  - **Fault or alarm code (about 15%):** its meaning or fix.
  - **Parameter (about 15%):** the default, range, or what it does.
  - **Procedure step or prerequisite (about 15%).**
  - **Specification with a unit (about 10%).**
  - **Unanswerable from this manual (about 15%):** plausible questions the manual does not answer. The correct behaviour is an honest refusal with no citation.
- **Phrasing:** like a technician on a phone, not lifted from the page. At least half use different wording from the page text (synonyms, plant shorthand), because the vocabulary gap is a real failure shape.
- **Gold per question:** accepted page(s), the exact answer value and unit, and the cell's row and column where it applies.
- **Two independent labellers:**
  - A writes the questions and gold from page images and text.
  - B, blind to A's answers, answers each question from the manual and records page, value and unit.
  - Disagreements are adjudicated by re-reading the page.
  - Raw agreement is reported before adjudication, and the adjudication record is kept.
  - Both are Claude, so this is a same-family check. That is disclosed.

## 3. Sealing

- The gold lives in `.planning/unseen-set/` (gitignored), never in the repo.
- Before any fix is evaluated, a **sha256 commitment** of the gold file and the manifest is committed to this document (§6). That proves the set did not change after the results were seen.
- No agent or session building a fix may read `.planning/unseen-set/`. Fix work uses only the 77-question development set.

## 4. Use

- **Evaluate a change once per release candidate**, on the exact head, with the same harness as T4:
  - local throwaway Postgres;
  - `retrieveNodeChunks` from the candidate head;
  - topK 6, doc-scoped.
  
  Report hit@1, hit@6 and the paired difference against main.
- **End to end**, on staging at phone size: correct value, unit, column and page, plus the refusal rate on the unanswerable 15%. Any paid generation needs Mike's approval and a declared cap.
- **Pass rule for a retrieval change:**
  - no net loss on hit@6 against main on the unseen set (exact McNemar, two-sided);
  - a net gain on the 77-question development set that meets its pre-registered rule.
  
  A change that wins on the development set but loses on the unseen set is **overfit** and does not ship.

## 5. Burn and refresh

- Once anyone reads per-question failures on the unseen set to guide a fix, the set becomes **development data**. A new unseen set is then drawn under this same protocol.
- Aggregate scores may be reported without burning the set.

## 6. Commitments

To be filled in **before** the first evaluation:

| File | sha256 | Committed at |
|---|---|---|
| `manifest.json` | | |
| `gold.jsonl` | | |
