# Forum batch 2 — retrieval repair, frozen before/after, and the need breakdown (2026-10-26)

Source of truth: `docs/briefs/2026-10-25/` (PR #4790 @ `daf10d42`, 109/109 sha256 OK). Issues: #4788, #4780, #4783, #4784.
Nothing here is posted, scheduled, or deployed. No model was called to produce these numbers.

## 1. Frozen baseline (from the brief, not re-graded)

The batch-2 live test on staging (hub 3.419.18, `feaabc25`, 2026-10-25):

- **Sanity facts:** 2/5 cited the right page (ACS355 p.359, S7-1200 p.1047).
- **Forum questions:** 0/6 passed. That's 1 PARTIAL, 1 false ABSTAIN, 1 FAIL, and 3 not run because the gate stopped them.

`cases.json` freezes the 11 questions exactly as sent, their notebooks and documents, the expected pages and the baseline verdicts. F4 and F6 have no frozen manual page, because their best answers were field fixes. They can only be graded from answers.

## 2. What was wrong (diagnosed, each red → green)

| # | Failure | Where | Fix (commit) |
|---|---|---|---|
| A | A question naming a model ("PowerFlex 525", "TP700") rejected every chunk of the family manual ("520-Series", "Comfort Panels") | `documentCoversRequest` has no family rule on the named-ask branch (`manual-rag.ts:1639`) | `documentCoversNamedAsk`: family root admits members; a title also naming a different member stays rejected (`a5d6506a2`) |
| 1d | "a5001" never searched "5001", which is how the manual's alarm table (p.356) prints it | `expandIndustrialQuery` exact tokens | A/F prefix + exactly 4 digits also searches the digits (`e89826829`) |
| new | "ACS355 fault code 0001" treated "ACS355" as a code, so every page repeating ACS355 outranked the fault table (p.359) | code tokens in an unbound notebook | The model the question names is dropped from code tokens, as the notebook's own model already was (`ebde1c5ec`, `6fceeef98`) |

## 3. Proof: zero-token retrieval check, same staging data, same call

`mira-hub/scripts/eval-forum-retrieval.ts` makes the chat route's own `retrieveNodeChunks` call against staging Neon. It's read-only and makes no model calls.

A "hit" means an expected page is in the top-6 the model reads.

**Staging and production retrieval differ.** Staging Doppler sets `NOTEBOOK_HYBRID_RETRIEVAL=1 NOTEBOOK_RERANK=1 NOTEBOOK_LEXICAL_V2=1`, and production sets none of them. The production-flag run is the one that predicts what users get:

| Case | Expected | main `e28bb182d` (prod flags) | branch (prod flags) |
|---|---|---|---|
| S1 PF525 P034 | p.65+ | miss (nothing admitted) | **hit** p.65 |
| S2 ACS355 0001 | p.359 | miss | **hit** p.359 |
| S3 Micro820 default IP | p.64 | miss | miss |
| S4 S7-1200 ERROR LED | p.1047 | hit | hit |
| S5 TP700 touch calibration | p.91 | miss (nothing admitted) | **hit** p.91 |
| F1 S7 memory card | p.114/1047 | hit | hit |
| F2 S7 + TP700 SCADA | pp.526–529 | miss (pool 0) | miss (pool 0) |
| F3 ACS355 A5001 | p.356 | miss | **hit** p.356 |
| F4 PF525 no output | — (field) | nothing admitted | manual admitted; answer-gradable only |
| F5 Micro820 BOOTP | p.64 | miss | miss |
| F6 PF525 F080 | — (field) | nothing admitted | manual admitted; answer-gradable only |

**Retrieval totals, production flags:**
- Known facts: 1/5 → **4/5**.
- Gradable forum questions: 1/4 → **2/4**.

Receipts: `run-prodflags-main-e28bb182d.json`, `run-prodflags-branch.json`.

**Gate status: NOT MET.**
- The gate asks for 5/5 known facts cited to the right page. Retrieval reaches 4/5, so the answer-level gate cannot pass yet either.
- The answer-level run (citations, safety behaviour, PASS/PARTIAL grading of the 6 threads) needs this code on staging, and staging deploys only merged commits (SDLC §5.2).
- No GO claim is made.

**Dominant remaining failure modes:**
1. **Micro820 p.64 (S3, F5):** wording. "default IP address" vs the manual's DHCP text. p.64 is not in the top-12 candidates. Next smallest experiment: the weak-AND guard (brief fix D), with a debug trace.
2. **F2:** a question that names a second device ("TP700" HMI) in the S7-1200 notebook rejects the S7 manual outright (pool 0). This is the same named-ask filter, now on multi-device questions.
3. **Staging ≠ production.** Staging's hybrid fusion demoted the exact-code page that lexical ranking put first (p.356). Staging evidence should be read with that in mind until the flags match.

Retrieval success is not useful guidance. F1 already retrieves p.114 and still got PARTIAL, because it didn't apply p.1047 to the symptom.

## 4. Actual demand — 35 frozen questions, coded by evidence-based need

`need-tags.json` covers 29 Answer Radar freezes and the 6 batch-2 threads. Each tag carries a verbatim quote, and 40/40 quotes are found in their source file. Multiple tags per question are allowed.

| Need | Questions |
|---|---|
| unknown (OP-only freezes: community replies never read) | **25** |
| field_experience | 7 |
| cant_find_page | 3 |
| missing_manual | 2 |
| cant_interpret_apply | 2 |

Examples:
- **cant_find_page:** [S7-1200 + TP700 SCADA](https://www.plctalk.net/forums/threads/tp-700-comfort-scada-and-plc-communication.142881/). The manual covers it; the answer came from a forum regular.
- **field_experience:**
  - [PF525 F080](https://www.plctalk.net/forums/threads/powerflex-525-f080-autotune-failure-anomaly.126768/): power-module swap, confirmed by the OP.
  - [Fatek USB](https://www.plctalk.net/forums/threads/issue-communicating-with-fatek-fbs-through-the-usb-port.150122/): driver vs. Prolific chip.
- **cant_interpret_apply:**
  - [ACS355 A5001](https://www.plctalk.net/forums/threads/acs355.102851/): the OP already knew the manual's meaning.
  - [M340 BMXAMI0810](https://www.plctalk.net/forums/threads/m340-bmxami0810-showing-io-error.150103/).
- **missing_manual:** [WAGO 750-301 GSD](https://mrplc.com/forums/topic/45895-wagob750gsd/), a config file rather than a manual.

**Reading:**
- Where the replies were read (10 of 35), "I can't get the manual" is the rarest need (2).
- Experience-based fixes (7) and applying information (2) appear as often as page-finding (3).
- 25/35 cannot be classified at all, because the freezes never captured the replies.
- These are public questions. They aren't engaged users or customers, and say nothing about payment.

## 5. Discovery tooling audit (verified on main, nothing enabled)

| Tool | State (verified) | Problem | Proposal |
|---|---|---|---|
| `reddit_intent.py` / `youtube_intent.py` | Keyword list is buyer-intent ("alternative to MaintainX", "CMMS recommendation") | Hunts CMMS buyers, not the problem; against "don't imply MIRA needs a CMMS" | Replace keywords with problem language: "manual", "can't find", "which page", "fault code meaning", "what does … mean", "parameter for"; drop CMMS terms |
| `_intent_scorer.py` | One Groq call, fails open | Groq is suspended (overdue payment), so it scores nothing | Score deterministically (problem-phrase match + equipment-named + no accepted answer). No paid scorer |
| `intent_digest.py` + beat trio | Only in the default beat profile | Production runs only the `synthetic-dogfood` and `historian` profiles, so it never runs | Keep off. Don't schedule until the quality criteria below are met on a frozen sample |
| `mira-bots/reddit/bot.py` | `profiles: ["dormant"]` | `REDDIT_DRY_RUN` defaults to **0**, so it would post if started | Keep dormant. Flip the default to `1` in a separate reviewed change |
| Answer Radar (Grok team agent) | The only loop that listens for real problems | Freezes OP-only (25/35 unknown); learning step is manual | Freeze the accepted/best reply too; grade every frozen question with this harness |

**Low-maintenance learning loop:**
1. Answer Radar freezes the question *and* its best reply.
2. A human tags the need (the §4 schema).
3. The question joins `cases.json` with an expected page, or "field" if there is none.
4. `eval-forum-retrieval.ts` scores retrieval at zero tokens on every retrieval change.
5. The answer-level grade runs on staging after merge.

Quality criteria for any scout to be scheduled: ≥70% of a frozen 20-item sample tagged non-`unknown`, and ≥50% name specific equipment. No outreach either way.

## 6. Positioning this evidence supports

"Find the right page in the manual you already have, and say what it means for your fault." The evidence doesn't support "we find your manual for you". Field-experience questions (7/10 of those with replies read) are where a manual-only tool stops. Say so, and don't claim them.

## Reproduce

```bash
# production flags (what users get); add NOTEBOOK_RETRIEVAL_DEBUG=1 for per-candidate traces
doppler run -p factorylm -c stg -- env NOTEBOOK_HYBRID_RETRIEVAL=0 NOTEBOOK_RERANK=0 NOTEBOOK_LEXICAL_V2=0 \
  bun run mira-hub/scripts/eval-forum-retrieval.ts out.json
```
