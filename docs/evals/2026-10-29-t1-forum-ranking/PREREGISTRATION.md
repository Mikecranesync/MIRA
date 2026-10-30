# Pre-registration — T-1 fresh held-out set (written 2026-10-29, before any candidate ran on it)

Owner: CHARLIE. Decision: Mike chose option A (2026-10-29): fix the ranking, prove it on fresh questions.

## Admission rule for a fresh question (decided before collection finished)
1. Verbatim original post from a public forum thread; URL recorded; a second agent re-fetched the URL and
   confirmed the first ~120 chars appear there.
2. Not in forum-new (19), round1, round2, v0.2 candidates or t4-77 (URL or first 60 chars, case-insensitive).
3. The evidence quote (>=10 consecutive words) is found verbatim (whitespace-normalised) by a script
   (pypdf page text) on the expected PDF page. Script check, not agent say-so.
4. A BLIND second labeller (did not see the proposed page) either picked a shared page, or confirmed the
   proposed page answers the question. Disagreement on both = dropped (listed, not silently).
5. Manual is one of the 19 IMIB manuals. Unanswerable candidates are kept in the file but not scored.

## Measurement
- Harness: unmodified `retrieval_rank.ts` sha256 12ced03b…5f07, production flags (lexical-v2/hybrid/rerank off),
  k=10, 3 repeats; score = right page in top 5, same `score.py` rule as forum-new.
- Baseline = `d9cc113` (main at handoff). Candidate = the fix branch head, run once on the fresh set. No tuning
  against the fresh set: if it fails, report and stop.
- Bar (#4875 row 5): Wilson 95% lower bound >= 70% on the fresh set; also forum-new 19 reported alongside.
- Regression sets, flag off (prod): t4-77 top-6/top-1 net >= 0; oem-fault top-5 net >= 0; robust top-5 net >= 0;
  oem-index (footer-free) top-5 net >= 0. Lost ids listed.
