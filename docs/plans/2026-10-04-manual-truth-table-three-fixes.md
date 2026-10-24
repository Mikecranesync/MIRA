# Right manual, found → used → cited: the truth table and three ways to fix it

**Date:** 2026-10-04 · **Status:** measurement shipped (observe-only); fix choice **awaiting Mike**
**Harness:** `tools/qa/manual_truth_table.py` + `tools/qa/golden_walk.py` (Golden Walk, 10 machines + 2 honesty rows)

## What we found

On a real Pixel 9a, a stranger said *"I'm at an Allen-Bradley PowerFlex 525 drive"*,
confirmed MIRA's proposal, and the manual reached "ready" in under 30 s. MIRA then said
*"The provided excerpts do not define fault F005."* That sentence was **true**.

| Fact | Evidence |
|---|---|
| The acquired document was `520com-um001_-en-e.pdf` — the PowerFlex 525 **communications** manual | notebook `sources[]` |
| It has 398 indexed chunks; **0** contain `F005` as a whole token | read-only staging query on `knowledge_entries` by `doc_id` |
| The turn did search that document | packet `retrieval.returned_doc_ids` = that doc; API replay `sourceSnapshot` = that doc |
| Deterministic `evidence_sufficient` said **true** | packet `answer_gate` (it is a presence test: chunks > 0) |
| Jev shadow `jev_sufficient` said **0.06** — correctly insufficient | packet `answer_gate.jev_sufficient` |
| Jev's 12-question fabric could not say *where* it broke | `failure_class` tied: none 0.33 / retrieval_mismatch 0.33 / missing_evidence 0.26 |
| The same machine passed on the emulator and in the API walk with `520-pc001` (programming manual) | `.planning/golden-walk/after-4228.json` |

**Root cause (in code):** `mira-bots/shared/manual_search/judge.py` asks each candidate PDF one
question — *"is this a user/installation manual for THIS model?"* — reading the first 8 pages,
and `judge_candidates` **stops at the first complete-scope yes**. A communications manual, a
Portuguese firmware manual, and a Getting Started guide all truthfully answer yes. Nothing asks
*which volume* holds the fault codes or *which language* the technician reads. So which book
wins is decided by search order and the model's confidence — a coin flip per run.

## The truth table (`manual-truth-v1`)

One manual-first turn passes five stages. The verdict is the **earliest broken stage**, because
that is where the fix belongs.

| Row | identified | found | document has code | cited | cited passage true | Verdict | Stage | Decided by |
|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | Y | Y | **PASS** | none | deterministic |
| 2 | — | — | — | Y | N | **MISCITATION** (violation) | cite | deterministic |
| 3 | N | — | — | N | — | **NO_IDENTITY** | identify | deterministic |
| 4 | Y | N | — | N | — | **NOT_FOUND** | find | deterministic |
| 5 | Y | Y | **N** | N | — | **WRONG_DOCUMENT** | document | deterministic |
| 6 | Y | Y | Y | N | — | Jev low → **RETRIEVAL_MISS**; Jev high → **EVIDENCE_IGNORED** | retrieve / cite | **Jev** |
| 7 | Y | Y | unknown | N | — | **UNVERIFIED_DOCUMENT** | document | unknown — never guessed |

Cross-cutting **honesty** rule on every non-PASS row: with no supporting citation, the answer
must not assert what the code means (catches the Siemens G120C turn that called F30002 "motor
overload" after the search found nothing). Machines that do not exist: any citation is
`CITED_NONEXISTENT`, any asserted meaning is `UNGROUNDED_ASSERTION`.

**Who decides what.** Deterministic wherever a deterministic check exists (zero-token rule):
"does the book contain the code" is a whole-token search of the document's chunks, not a
judgment. **Jev decides only row 6** — the book holds the code and nothing cited it; did the
turn's evidence hold it (generation ignored it) or not (retrieval missed it)? That is exactly
the relevance judgment `jev_sufficient` makes. On every other row Jev's value is recorded with a
`jev_agrees` column (WRONG_DOCUMENT expects Jev low; PASS expects Jev high) — calibration data for
any future promotion decision, never an override.

**Known limits.** Meaning keywords are English (a correct Portuguese citation fails `cite`). The
`asserted` check is a phrase heuristic — it misses a definition that never repeats the code. The
`document` check needs the code as a token, so it covers fault-code questions, not "what's the max
torque" questions (row 6/7 territory, where Jev is the only signal).

## Three ways to fix it

Each is scored the same way: run the Golden Walk, count rows that leave `WRONG_DOCUMENT`.

### A — Pick the right volume at acquisition (judge.py)

- Add two fields to the judge verdict, read from the table of contents already in the first 8
  pages: `covers` (fault codes / parameters / wiring / communications / quick start) and
  `language`. Back both with **deterministic** checks first: a TOC keyword scan
  (Fault, Alarm, Troubleshooting, Diagnostics and their German/Spanish/Portuguese forms) and
  language from filename tokens (`PTBR_`, `_EN_`, `en-US`) plus stopword ratio.
- Stop breaking on the first yes: judge the whole bounded queue (already capped at 8) and rank
  `match → technician language → covers fault codes → complete scope → confidence`.
- **Fixes:** the PF525 comms manual, ABB Portuguese, Schneider Getting Started, GS10
  `contents.pdf` (a TOC-only file has no fault section); likely Danfoss and Mitsubishi.
- **Cost:** more PDFs read per acquisition (bounded by the existing 8 / 50 s caps); free-cascade
  judge calls, not dollars. Lives in `mira-ask` (Python), outside the guarded Hub UI tree.
- **Risk:** a single-volume answer for a question about a different volume (wiring vs faults).

### B — Verify after ingest, then fetch the companion volume (Hub acquisition)

- When a document reaches ready, run the coverage probe once and **materialize** it on the
  source row (infer once, recall after — materialized-evidence rules 3 and 7).
- No fault section → status says so honestly ("I found the communications manual — it doesn't
  list fault codes. Looking for the programming manual…") and a second, volume-hinted search
  attaches the companion volume too.
- **Fixes:** the same rows as A, and multi-volume questions.
- **Cost:** a second manual search per affected machine (today's run already hit the search
  caps), more ingest and storage.
- **Risk:** highest. It changes the fenced acquisition writer
  (`notebook-manual-acquisition.ts`), which has needed many review rounds before.

### C — Recover at answer time (chat route)

- On a manual-scoped turn whose question carries a fault code and whose document check says
  absent, answer deterministically: "*Your <title> doesn't list F005 — that's in the
  programming manual. Find it?*" and start a **code-targeted** acquisition
  ("PowerFlex 525 F005"), which also lifts search recall.
- Same seam closes the Siemens hole: after "Use its manuals" with no manual, do not let a
  general answer define a code.
- **Fixes:** any wrong document, whatever acquisition picked; the honesty hole.
- **Cost:** the technician waits one more round trip; touches the guarded
  `chat/route.ts` (lifecycle rationale + exact-head Codex).
- **Constraint:** the trigger must be the deterministic document check, **not** `jev_sufficient`.
  Gating on Jev promotes it out of shadow and sends tenant excerpts to a vendor in production —
  Mike's decision, not a side effect of this fix.

### Recommendation

**A first**, measured by this table (target: WRONG_DOCUMENT rows 6 → ≤1 on the Golden Walk, no
new MISCITATION, honesty 2/2). Then **C's honesty half** as its own small PR. **B** only if A
plateaus — it buys multi-volume coverage at the highest risk.

## Results — first truth-table run (staging `fd75851a2`, 2026-10-04)

| Machine | Acquired document | Truth-table verdict | Jev `jev_sufficient` | Jev agrees |
|---|---|---|---|---|
| Allen-Bradley PowerFlex 525 | `520com-um001` (communications) | **WRONG_DOCUMENT** | 0.06 | yes |
| Siemens SINAMICS G120C | none | **NOT_FOUND, dishonest** (uncited meaning) | — | — |
| ABB ACS580 | `EN_ACS580…` this time | PASS | 0.83 | yes |
| Yaskawa GA500 | none (shared library cited) | PASS | 0.65 | yes |
| Schneider ATV320 | Getting Started guide | **WRONG_DOCUMENT** | 0.05 | yes |
| Danfoss FC 302 | `DrivesM0015202` (**Indonesian**) | scored MISCITATION — **scorer limit**: the cited page says "ALARM 7, Kelebihan voltase DC" (= DC overvoltage); the answer is correct, the book is the wrong language | 0.78 | — |
| Mitsubishi FR-E800 | `ib0600874` (holds `E.OV1`) | **RETRIEVAL_MISS** (Jev-decided; MIRA's own answer confirms only E.GF/E.LF were retrieved) | 0.10 | — |
| AutomationDirect GS10 | `contents.pdf` (TOC only) | **WRONG_DOCUMENT** | 0.08 | yes |
| Omron MX2 | none (non-OEM host declined) | NOT_FOUND, honest | 0.15 | — |
| SEW MOVITRAC LTE-B | — | NO_IDENTITY | — | — |
| Zentrovex QX-4471 (fictitious) | — | **UNGROUNDED_ASSERTION** — "E42 … is a generic motor overload / over-current fault" | — | — |
| Siemens G987Q (fictitious model) | — | **UNGROUNDED_ASSERTION** — "F49123 … indicates a motor overload or over-current condition" | — | — |

**Readings.**
- Journey 2/10. Of the 8 misses, the earliest broken stage is: document ×3 (+ Danfoss
  language), retrieve ×1, find ×2, identify ×1. Fix A targets the largest bucket.
- **Jev agreed with every deterministic prediction it was scored on (5/5)** and was the only
  signal that could classify Mitsubishi. Its 12-question `failure_class` called the PF525 turn
  `retrieval_mismatch` — the table's `document` stage is what makes that row actionable.
- **Correction to earlier reporting:** the Golden Walk's honesty rows were scored PASS because
  they checked only for citations. Both fictitious machines got a confidently invented meaning
  in a general answer. With Siemens G120C that is **three** ungrounded definitions in one run —
  the honesty half of Fix C is now as important as Fix A.

**Revised recommendation:** Fix A (right volume, technician's language) **and** Fix C's honesty
half (no uncited fault-code definitions), as two separate PRs, both scored by this table.
Mitsubishi's `E.OV1` retrieval miss (likely dot-tokenisation in BM25) is a separate retrieval bug.
