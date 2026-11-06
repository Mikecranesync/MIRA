# Overnight issues triage — 2026-10-27 (read-only)
Source: cursor-github MCP issue reads, plus /workspace/nitpick/2026-10-27-overnight/. Nothing posted, labelled, built, or touched on any PR.
Sellable path = mira-mobile → Hub equipment-notebook chat → manual-rag.

## #4842 — D4: PF525 F005 answer omits "extend decel" step (p.161)
- **Overlap:** Same miss as #4841, which was closed as **not_planned** at 1:13 AM ET today. #4841 is the better-written one: it has the fixture IDs (PF525 notebook 1417666e…), the verbatim answer, the (a) product-fix vs (b) v2-case choice, and the "don't edit cases_a1.json" rule. #4842 asks to "record notebook IDs" that #4841 already lists. So #4842 is the live copy, and #4841's body should be its reference. Also related to #4851 (the chunkText fault-table splitting): if p.161's action column gets cut off from the cause row, that would explain the omission.
- **Board:** #4372 (readiness): it's a D4 pilot-gate item.
- **Sellable path:** Yes (manual-rag answer quality).
- **Priority:** P1. It's the one FAIL keeping the D4 gate at 5/6, and the answer is right but leaves out the fix.
- **Next:** Copy #4841's fixture and acceptance details into #4842 (needs Mike's OK to edit). First check whether the p.161 chunk holds the action column after #4850 deploys, then decide (a) vs (b). Don't change the A1 record.

## #4844 — Tenant-scoped conversation state (F5=B, split from #4759)
- **Overlap:** Kept apart from #4759 on purpose. Overlaps the #3237 WO-tenant family. It's being built in draft PR #4852 (head 942297d0).
- **Board:** #4372 (readiness), as multi-tenant isolation.
- **Sellable path:** Yes. Conversation state backs the notebook chat.
- **Priority:** P1. A cross-tenant state leak is a security and data-isolation risk, but no exploit has been seen and the work is underway.
- **Next:** Keep going in #4852: Gate-7 on the exact head, then Codex (with Mike's OK). The staging test's tenant-trust question (slice 3) needs Mike's decision. No merge.

## #4846 — Failed answers: red bubble, no Retry, they pile up
- **Overlap:** #4311 (failed-send UX), #4366 (generic failure copy), #4795/#4752 (errors that do offer Try again). The root cause (F5/Back mid-answer kills the turn) is the major sent to Foreman separately and isn't filed yet.
- **Board:** #4732 (round-trip): a question and answer doesn't survive an interruption.
- **Sellable path:** Yes (notebook chat UI).
- **Priority:** P2. You lose the question and have to retype, but nothing is lost permanently. Raise it to P1 if it's combined with the root cause.
- **Next:** File the root-cause issue (Mike's OK needed). Build Retry and de-dup in one lane together with it.

## #4847 — Viewer counter says 11/33 for a p.10 citation
- **Overlap:** Not #4794 (printed vs PDF page; in this manual the two match). Related to #4685 (opens at 40%) and #4684 (blank while loading).
- **Board:** #4732 (round-trip): the citation → page step.
- **Sellable path:** Yes (citation viewer).
- **Priority:** P2. The page shown is right but the counter and thumbnail disagree, which hurts trust in citations.
- **Next:** Bundle it with #4684/#4685 into one viewer fix: open the embedded viewer with `#page=N` and pin page N to the top.

## #4848 — Sidebar project/thread rows can't be reached with Tab
- **Overlap:** A regression from the #4796 tab-stop cut. Related to #4692.
- **Board:** Neither (accessibility polish). Could go on #4372 if accessibility is a readiness criterion.
- **Sellable path:** Yes, as UI shell, but only for keyboard-only users. The phone flow isn't affected.
- **Priority:** P2. Keyboard users can't switch threads at all, and it's a regression from a fix that just shipped.
- **Next:** Roving tabindex on the sidebar list, plus a skip link. Small build in the shared UI lane (#3626, one writer at a time).

## #4849 — Citation digits glued onto words in copied/screen-reader text
- **Overlap:** The #4689 / #4750 / #4431 / #4667 citation-marker family. Same root as the stray "5" markers in pass2 finding 2.
- **Board:** #4732 (round-trip): copy-out of the answer.
- **Sellable path:** Yes.
- **Priority:** P2. Copied text like "ambient temperature 21" reads as a wrong spec number in a work order, which is a real safety-adjacent risk, but it doesn't show on screen.
- **Next:** Fold it into one citation-chip lane with #4689/#4667: aria-label "source N, page P" and visually hidden brackets.

## #4851 — chunkText: row break before 50% still splits variable-length fault rows
- **Overlap:** A direct follow-up to merged PR #4850 (Codex F1, MEDIUM, on head aa9394bb). It isn't a duplicate. #4850 fixed the common case, and this is the leftover edge case (rows of about 400/700/400 chars). Refs #4842.
- **Board:** #4372 (readiness), since it feeds D4 answer completeness.
- **Sellable path:** Yes (manual-rag ingestion and chunking).
- **Priority:** P2. It's an edge case, but split fault rows lose the cause↔action pairing, which is exactly the F005 failure mode. Raise it to P1 if the p.161 chunk turns out to be split.
- **Next:** Small grok-4.6 lane (needs Mike's OK). Show the 3-row test red on aa9394bb0 first, then the fix. Run Gate-7, then Codex on the final SHA. Re-ingest is needed for the fix to affect existing notebooks.

## Needs Mike
1. OK to edit #4842 with #4841's fixture details (or just treat #4841's body as the reference).
2. OK to file the "F5/Back mid-answer kills the turn" root-cause issue.
3. Build-lane OKs: #4851 chunkText follow-up; a viewer bundle (#4847); a citation-chip bundle (#4849); sidebar keyboard (#4848, shared UI lane).
4. The #4852 tenant-trust test decision (slice 3).
