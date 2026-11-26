# Bot-Voted MIRA Fix Plan and Agent Prompts

**Date:** November 26, 2026  
**Status:** Planning  
**Decision method:** Multi-bot voting

---

## Overview

On November 26, 2026, five FactoryLM bots—Foreman, Notebook Prover, FactoryLM Product, Answer Radar, and Librarian—voted on which MIRA fixes would help technicians most. Each bot ranked ten issues, with points awarded from 10 for first place down to 1 for tenth place.

The vote identified four top-priority fixes that every bot voted for:
1. **False "not in the manual" answers** when retrieved pages contain the answer ([#5710](https://github.com/Mikecranesync/MIRA/issues/5710), [#5677](https://github.com/Mikecranesync/MIRA/issues/5677))
2. **Sticky model refusal** that persists incorrectly ([#5720](https://github.com/Mikecranesync/MIRA/issues/5720), [#5416](https://github.com/Mikecranesync/MIRA/issues/5416), [#5652](https://github.com/Mikecranesync/MIRA/issues/5652) via [#5671](https://github.com/Mikecranesync/MIRA/pull/5671))
3. **Missing safety cards** on jumper/bypass requests ([#5680](https://github.com/Mikecranesync/MIRA/issues/5680))
4. **Printed page number mismatches** in citations ([#4794](https://github.com/Mikecranesync/MIRA/issues/4794))

Implementation will proceed in separate per-lane PRs as described in the agent prompts section.

---

## Ranked Tally

**Scoring:** 10 points for 1st place, 9 for 2nd, down to 1 for 10th. All five bots voted.

| Rank | Issue(s) | Points | Votes | Description |
|------|----------|--------|-------|-------------|
| 1 | [#5710](https://github.com/Mikecranesync/MIRA/issues/5710), [#5677](https://github.com/Mikecranesync/MIRA/issues/5677) (FA cluster) | 39 | 5/5 | False "not in the manual" when answer is in retrieved page |
| 2 | [#5720](https://github.com/Mikecranesync/MIRA/issues/5720) (via [#5671](https://github.com/Mikecranesync/MIRA/pull/5671)) | 38 | 5/5 | Sticky model refusal, [#5416](https://github.com/Mikecranesync/MIRA/issues/5416), [#5652](https://github.com/Mikecranesync/MIRA/issues/5652) |
| 3 | [#5680](https://github.com/Mikecranesync/MIRA/issues/5680) | 34 | 5/5 | Jumper/bypass asks get no safety card |
| 4 | [#4794](https://github.com/Mikecranesync/MIRA/issues/4794) | 22 | 5/5 | Printed vs PDF page number mismatch in citations |
| 5 | [#5127](https://github.com/Mikecranesync/MIRA/issues/5127), [#5743](https://github.com/Mikecranesync/MIRA/pull/5743) | 18 | — | Long questions pull wrong pages |
| 6 | [#5669](https://github.com/Mikecranesync/MIRA/issues/5669) | 16 | — | Lost turns ([#4846](https://github.com/Mikecranesync/MIRA/issues/4846), [#5463](https://github.com/Mikecranesync/MIRA/issues/5463), [#5610](https://github.com/Mikecranesync/MIRA/issues/5610)) |
| 7 | [#5195](https://github.com/Mikecranesync/MIRA/issues/5195) | 15 | — | [#5923](https://github.com/Mikecranesync/MIRA/issues/5923), [#4798](https://github.com/Mikecranesync/MIRA/issues/4798) needs CI + phone test |
| 8 | [#5942](https://github.com/Mikecranesync/MIRA/issues/5942) | 13 | — | Stranger sign-in ([#5993](https://github.com/Mikecranesync/MIRA/pull/5993), [#5964](https://github.com/Mikecranesync/MIRA/pull/5964)) |
| 9 | [#5905](https://github.com/Mikecranesync/MIRA/issues/5905), [#5864](https://github.com/Mikecranesync/MIRA/issues/5864) | 11 | — | Safety card coordination |
| 10 | [#5578](https://github.com/Mikecranesync/MIRA/issues/5578) | 11 | — | Duplicate answers + stuck Stop |
| 11 | [#4667](https://github.com/Mikecranesync/MIRA/issues/4667) | 8 | — | Chip/source page mismatch |
| 12 | [#6015](https://github.com/Mikecranesync/MIRA/issues/6015) | 7 | — | Hazard floor |
| 13 | [#5998](https://github.com/Mikecranesync/MIRA/issues/5998), [#6004](https://github.com/Mikecranesync/MIRA/issues/6004), [#5770](https://github.com/Mikecranesync/MIRA/issues/5770) | 6 each | — | PF525 fault table, garbled text, scanned PDF warning |

---

## Issue Close and Reopen Guidance

### Superseded Issues
- [#5557](https://github.com/Mikecranesync/MIRA/issues/5557) superseded by [#5772](https://github.com/Mikecranesync/MIRA/issues/5772) (new tracker)

### Keep Closed
- [#5721](https://github.com/Mikecranesync/MIRA/issues/5721) stays closed

### Close Only After Deployed Walk
The following issues should close **only after** a walk on the deployed staging build re-checks the original reproduction case:
- [#5282](https://github.com/Mikecranesync/MIRA/issues/5282), [#5284](https://github.com/Mikecranesync/MIRA/issues/5284)
- [#4683](https://github.com/Mikecranesync/MIRA/issues/4683), [#5228](https://github.com/Mikecranesync/MIRA/issues/5228)
- [#5551](https://github.com/Mikecranesync/MIRA/issues/5551), [#5731](https://github.com/Mikecranesync/MIRA/issues/5731)
- [#5766](https://github.com/Mikecranesync/MIRA/issues/5766), [#5686](https://github.com/Mikecranesync/MIRA/issues/5686)

---

## Agent Prompts by Lane

**Common rules for all prompts:** Repository Mikecranesync/MIRA, follow the repo's GitHub rules, open a DRAFT PR, cheap review first (no Codex without Mike), never merge or deploy, no prod writes, no secrets, synthetic test data only. Close an issue only after a walk on the deployed staging build passes the original repro.

### Lane A: Claude (Mike's lanes, hand-off prompts only)

These items are owned by Mike's Claude instance. The prompts below describe the work; each will be a separate PR.

#### A1: Split [#5671](https://github.com/Mikecranesync/MIRA/pull/5671) ([#5720](https://github.com/Mikecranesync/MIRA/issues/5720)/[#5416](https://github.com/Mikecranesync/MIRA/issues/5416)/[#5652](https://github.com/Mikecranesync/MIRA/issues/5652) sticky model refusal)

```
Split PR #5671. Part 1: a fault-code/port/parameter filter so tokens like F30011, P-72, PORT2 are never treated as model numbers (P-72 is regressed; add a regression test). Part 2: once a refusal fires, the next on-topic question in the same chat must be answered normally (no sticky refusal). Repro from #5720 and #5416 (part number with spaces). Draft PR per part.
```

#### A2: [#5680](https://github.com/Mikecranesync/MIRA/issues/5680) safety card on jumper/bypass asks

```
Fix #5680: any request to jumper, bypass or defeat a safety function (E-stop, STO, guard, light curtain, brake release, safety signature) must show the safety card with: disconnect power per the manufacturer's manual and lock out per site procedure. Must fire even when retrieval finds nothing (#5864). Coordinate with #5905/#6015, don't duplicate. Add tests for the 3/3 Nov 22 prompts and the Spanish case #6006.
```

#### A3: [#5669](https://github.com/Mikecranesync/MIRA/issues/5669) lost turns ([#4846](https://github.com/Mikecranesync/MIRA/issues/4846)/[#5463](https://github.com/Mikecranesync/MIRA/issues/5463)/[#5610](https://github.com/Mikecranesync/MIRA/issues/5610))

```
Finish PR #5669: a failed turn shows a Retry button instead of a dead red bubble; errors don't pile up; Back or F5 mid-answer never loses the question or creates a duplicate. E2E tests for each repro.
```

---

### Lane B: Cursor agent, answer grounding (one agent, sequential, two PRs)

#### B1: False "not in the manual" (FA cluster: [#5710](https://github.com/Mikecranesync/MIRA/issues/5710), [#5677](https://github.com/Mikecranesync/MIRA/issues/5677) + unfiled)

```
In MIRA's manual-rag notebook chat, MIRA says 'not in the manual' when the retrieved page contains the answer (examples: Kinetix STO p.40, GS10 P06.53 p.223, PF525 fault table #5998). Find why: answer prompt, context truncation, or table rows dropped. Fix so that if a retrieved chunk contains the answer, MIRA cites it; only say 'not found' when no chunk supports it. Also follow 'see page N' cross-references one hop. Add an eval fixture per example (synthetic or public manual text only). Draft PR. Do not touch model-match gate (#5671) or safety cards.
```

#### B2: [#5127](https://github.com/Mikecranesync/MIRA/issues/5127) long questions pull wrong pages (rework [#5743](https://github.com/Mikecranesync/MIRA/pull/5743))

```
Rework draft PR #5743 for #5127: split multi-sentence questions into sub-queries, retrieve per sub-query, merge and rerank. Keep-top-32 alone does not fix the PanelView case; the deciding page must land in top context. Include #5138's unticked cases. Eval before/after on Answer Radar's forum set if available in repo; report scores. Draft PR.
```

---

### Lane C: Cursor agent, citations (one agent, one PR)

#### C1: Printed page numbers ([#4794](https://github.com/Mikecranesync/MIRA/issues/4794) + [#4667](https://github.com/Mikecranesync/MIRA/issues/4667) + [#5620](https://github.com/Mikecranesync/MIRA/issues/5620) + [#5679](https://github.com/Mikecranesync/MIRA/issues/5679))

```
Fix MIRA citations to show the manual's printed page (footer number), not the PDF index. At ingest, detect printed page labels per page (PDF page labels, else footer text); store both. Chips, citation text and footnotes must show the same printed page and open the right PDF page. Fix chip/source mismatch (#4667), text vs chip page mismatch (#5620), wrong footnote page (#5679). Fallback to 'PDF p.N' when no printed label. Tests with a synthetic PDF whose printed pages are offset. Draft PR.
```

---

### Lane D: Cursor agent, Send and access (small UI fixes, one agent, separate PRs)

#### D1: Finish [#5195](https://github.com/Mikecranesync/MIRA/issues/5195) ([#5923](https://github.com/Mikecranesync/MIRA/issues/5923)/[#4798](https://github.com/Mikecranesync/MIRA/issues/4798) double-tap Send hits Stop)

Needs CI green, then Mike's phone test.

#### D2: [#5578](https://github.com/Mikecranesync/MIRA/issues/5578) duplicate answers + stuck Stop

```
Fix #5578: one Send must create exactly one question/answer pair, and Stop must reset after the answer completes. Idempotency key per send; E2E test with double submit and slow network. Draft PR. Don't overlap #5195/#5669.
```

#### D3: [#5393](https://github.com/Mikecranesync/MIRA/issues/5393) 'Creating…' hang with no Cancel

Add Cancel + timeout message. Draft PR.

#### D4: [#5942](https://github.com/Mikecranesync/MIRA/issues/5942) stranger sign-in

Finish [#5993](https://github.com/Mikecranesync/MIRA/pull/5993)/[#5964](https://github.com/Mikecranesync/MIRA/pull/5964) (the pilot can't start without it). Needs Mike to pick which PR survives.

---

### Lane E: Needs Mike's decision before any agent

The following items require Mike's decision before implementation:

- **Over-firing safety cards** on diagnostic/menu questions (F05, FX5, [#5650](https://github.com/Mikecranesync/MIRA/issues/5650)/[#5163](https://github.com/Mikecranesync/MIRA/issues/5163)): sits next to A2; give to Claude with A2 so the card logic changes in one place.
- **Notebook Prover P0** (wrong P047 3 vs 15, E-stop wrong terminal): file first, then it falls under B1/A2.
- [#6004](https://github.com/Mikecranesync/MIRA/issues/6004) garbled text under Grounded: small, can ride with B1.
- [#5770](https://github.com/Mikecranesync/MIRA/issues/5770) scanned PDF no OCR warning (+[#5783](https://github.com/Mikecranesync/MIRA/issues/5783)): later, Librarian lane.

---

## Implementation Order

**Day 1 (parallel):**
- Lane A: A1, A2, A3 (Claude)
- Lanes B/C/D: B1, C1, D2 (3 Cursor agents)

**Subsequent (sequential):**
- B2 after B1 merges
- D3 after D2

**Post-merge:**
Mike merges approved PRs, then a deployed-build walk re-checks each original repro before closing the issue.

---

## Bot Votes Detail

### Foreman
1. [#5720](https://github.com/Mikecranesync/MIRA/issues/5720)/[#5416](https://github.com/Mikecranesync/MIRA/issues/5416) via [#5671](https://github.com/Mikecranesync/MIRA/pull/5671)
2. [#5195](https://github.com/Mikecranesync/MIRA/issues/5195)/[#5923](https://github.com/Mikecranesync/MIRA/issues/5923)
3. [#5669](https://github.com/Mikecranesync/MIRA/issues/5669)
4. [#5578](https://github.com/Mikecranesync/MIRA/issues/5578)
5. FA cluster
6. [#5680](https://github.com/Mikecranesync/MIRA/issues/5680)
7. [#5905](https://github.com/Mikecranesync/MIRA/issues/5905)/[#5864](https://github.com/Mikecranesync/MIRA/issues/5864)
8. [#5942](https://github.com/Mikecranesync/MIRA/issues/5942)
9. [#4794](https://github.com/Mikecranesync/MIRA/issues/4794)
10. Ship 11 drafts + re-walk

**Reopens:** [#5557](https://github.com/Mikecranesync/MIRA/issues/5557) → [#5772](https://github.com/Mikecranesync/MIRA/issues/5772) tracker; keep [#5721](https://github.com/Mikecranesync/MIRA/issues/5721) closed; [#4562](https://github.com/Mikecranesync/MIRA/issues/4562)/[#4613](https://github.com/Mikecranesync/MIRA/issues/4613) regressions; [#5282](https://github.com/Mikecranesync/MIRA/issues/5282)/[#5284](https://github.com/Mikecranesync/MIRA/issues/5284), [#4683](https://github.com/Mikecranesync/MIRA/issues/4683)/[#5228](https://github.com/Mikecranesync/MIRA/issues/5228) label not reopen; [#5551](https://github.com/Mikecranesync/MIRA/issues/5551)/[#5731](https://github.com/Mikecranesync/MIRA/issues/5731), [#5766](https://github.com/Mikecranesync/MIRA/issues/5766)/[#5686](https://github.com/Mikecranesync/MIRA/issues/5686) close only after deployed walk.

**Happy:** Deployed-walk close rule.

### Notebook Prover
1. FA cluster (Kinetix STO p.40, GS10 P06.53 p.223)
2. [#5680](https://github.com/Mikecranesync/MIRA/issues/5680)
3. [#5127](https://github.com/Mikecranesync/MIRA/issues/5127) + revive [#5743](https://github.com/Mikecranesync/MIRA/pull/5743)
4. [#6015](https://github.com/Mikecranesync/MIRA/issues/6015) hazard floor
5. [#5864](https://github.com/Mikecranesync/MIRA/issues/5864)/[#5905](https://github.com/Mikecranesync/MIRA/issues/5905)
6. [#5720](https://github.com/Mikecranesync/MIRA/issues/5720)
7. [#4794](https://github.com/Mikecranesync/MIRA/issues/4794)
8. [#6004](https://github.com/Mikecranesync/MIRA/issues/6004)
9. [#5998](https://github.com/Mikecranesync/MIRA/issues/5998) PF525 fault table
10. [#4846](https://github.com/Mikecranesync/MIRA/issues/4846)/[#5669](https://github.com/Mikecranesync/MIRA/issues/5669)

**Reopens:** [#5557](https://github.com/Mikecranesync/MIRA/issues/5557) superseded by [#5772](https://github.com/Mikecranesync/MIRA/issues/5772); keep [#5721](https://github.com/Mikecranesync/MIRA/issues/5721).

**Missed (unfiled, held):** F16 wrong P047 (3 vs 15, p.88) + E-stop wiring P0; F05 Stop card over-block on diagnostic q (near [#5650](https://github.com/Mikecranesync/MIRA/issues/5650)).

**Happy:** If loaded page has it, cite it.

### FactoryLM Product
1. [#5942](https://github.com/Mikecranesync/MIRA/issues/5942) ([#5993](https://github.com/Mikecranesync/MIRA/pull/5993)/[#5964](https://github.com/Mikecranesync/MIRA/pull/5964))
2. [#5720](https://github.com/Mikecranesync/MIRA/issues/5720)/[#5416](https://github.com/Mikecranesync/MIRA/issues/5416) via [#5671](https://github.com/Mikecranesync/MIRA/pull/5671)
3. [#5680](https://github.com/Mikecranesync/MIRA/issues/5680)
4. [#5669](https://github.com/Mikecranesync/MIRA/issues/5669)
5. [#5195](https://github.com/Mikecranesync/MIRA/issues/5195)
6. FA cluster
7. [#5578](https://github.com/Mikecranesync/MIRA/issues/5578)
8. [#4794](https://github.com/Mikecranesync/MIRA/issues/4794)
9. [#5393](https://github.com/Mikecranesync/MIRA/issues/5393)
10. [#5905](https://github.com/Mikecranesync/MIRA/issues/5905) then [#5926](https://github.com/Mikecranesync/MIRA/issues/5926)/[#5927](https://github.com/Mikecranesync/MIRA/issues/5927)/[#6006](https://github.com/Mikecranesync/MIRA/issues/6006)

**Reopens:** Agree; [#5557](https://github.com/Mikecranesync/MIRA/issues/5557) superseded → [#5772](https://github.com/Mikecranesync/MIRA/issues/5772).

**Missed:** [#5062](https://github.com/Mikecranesync/MIRA/issues/5062) Work Packet lockout line (Mike holds), [#5788](https://github.com/Mikecranesync/MIRA/issues/5788) Android check, prod re-proof v3.460.20.

**Happy:** Send never loses/duplicates ([#5669](https://github.com/Mikecranesync/MIRA/issues/5669)+[#5195](https://github.com/Mikecranesync/MIRA/issues/5195) shipped + re-walked).

### Librarian
1. [#4794](https://github.com/Mikecranesync/MIRA/issues/4794)
2. FA cluster
3. [#4667](https://github.com/Mikecranesync/MIRA/issues/4667)
4. [#5620](https://github.com/Mikecranesync/MIRA/issues/5620)
5. [#5720](https://github.com/Mikecranesync/MIRA/issues/5720)
6. [#5680](https://github.com/Mikecranesync/MIRA/issues/5680)
7. [#5770](https://github.com/Mikecranesync/MIRA/issues/5770)
8. [#5679](https://github.com/Mikecranesync/MIRA/issues/5679)
9. [#6004](https://github.com/Mikecranesync/MIRA/issues/6004)
10. Revive [#5512](https://github.com/Mikecranesync/MIRA/issues/5512) + [#5532](https://github.com/Mikecranesync/MIRA/issues/5532)

**Notes:** Agrees all (b). [#5783](https://github.com/Mikecranesync/MIRA/issues/5783) pairs [#5770](https://github.com/Mikecranesync/MIRA/issues/5770).

**Happy:** Printed page, chip+text agree ([#4794](https://github.com/Mikecranesync/MIRA/issues/4794)+[#4667](https://github.com/Mikecranesync/MIRA/issues/4667)).

### Answer Radar
1. [#5127](https://github.com/Mikecranesync/MIRA/issues/5127) (revive [#5743](https://github.com/Mikecranesync/MIRA/pull/5743) reworked)
2. FA + unfiled upload text order, see-page-N
3. [#5720](https://github.com/Mikecranesync/MIRA/issues/5720)/[#5416](https://github.com/Mikecranesync/MIRA/issues/5416)/[#5652](https://github.com/Mikecranesync/MIRA/issues/5652)
4. [#5680](https://github.com/Mikecranesync/MIRA/issues/5680) + brake-release/safety-signature flags
5. FX5 energized-work false hard stop (unfiled)
6. [#5650](https://github.com/Mikecranesync/MIRA/issues/5650)/[#5163](https://github.com/Mikecranesync/MIRA/issues/5163) lockout over-fire
7. [#5998](https://github.com/Mikecranesync/MIRA/issues/5998)
8. [#4794](https://github.com/Mikecranesync/MIRA/issues/4794)
9. [#5770](https://github.com/Mikecranesync/MIRA/issues/5770)
10. [#6004](https://github.com/Mikecranesync/MIRA/issues/6004)

**Missed:** [#5138](https://github.com/Mikecranesync/MIRA/issues/5138) closed Nov 18 unticked, home in [#5127](https://github.com/Mikecranesync/MIRA/issues/5127).

**Happy:** Sentence-split retrieval.

---

## Summary Statistics

- **Total bots:** 5
- **Total issues voted on:** 30+ (including unfiled items)
- **Unanimous top 4:** All bots voted for the same four critical fixes
- **Implementation lanes:** 5 (A-E), with A owned by Claude, B-D by Cursor agents, E awaiting decision
- **Target PRs:** 10+ draft PRs across all lanes
