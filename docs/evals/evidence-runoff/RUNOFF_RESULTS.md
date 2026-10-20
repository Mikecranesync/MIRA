# Evidence-verification runoff — results (2026-10-20)

Plan: `RUNOFF_PLAN.md` (frozen at `5172a08`). Harness: `tools/evidence-runoff/` (commands in its README).
Per-answer outputs: `tools/evidence-runoff/results/per_item.jsonl` (no manual text); aggregate
`results/results.json`; parser track `results/docling_report.json`. Spend: **$0** (no paid API call; NLI and
Docling local on CHARLIE M4/16 GB, embeddings via local Ollama).

## 1. Headline

| Validator (held-out real answers + held-out adversarial) | Wrong answers caught | Correct answers wrongly flagged | Wrong answers marked supported | Latency p50 / p95 per answer |
|---|---|---|---|---|
| V0 shipped answer gate (control) | **0 / 19** | 0 / 163 | 19 | — |
| **V1 typed verifier, frozen (`ee6f8e0`)** | **12 / 19** | **17 / 163 (10.4 %)** | 6 | 0.06 ms / 1.3 ms |
| V1b = V1 + join wrapped lines (**post-hoc**, see §5) | 12 / 19 | 12 / 163 (7.4 %) | 6 | 0.06 ms / 1.3 ms |
| V2 embedding provenance (nomic, τ=0.62 dev-tuned) | 3 / 19 | 9 / 163 | 16 | 0.12 s / 0.39 s |
| V3 NLI `nli-deberta-v3-base` (τ dev-tuned → 0.00) | 0 / 19 | 0 / 163 | 19 | 0.37 s / 3.0 s (M4 GPU) |
| V3 NLI `nli-deberta-v3-small` | 0 / 19 | 0 / 163 | 19 | 0.19 s / 1.5 s |
| V3 NLI `nli-MiniLM2-L6-H768` | 0 / 19 | 3 / 163 | 19 | 0.08 s / 0.40 s |
| Best combination (V1b → NLI fallback, any model) | 12 / 19 | 12 / 163 | 7 | V1 + NLI |

Dev split: V1 caught 7/8 dev wrong answers with 0/5 false flags.

**Decision in one line:** the typed verifier is the only candidate that catches wrong answers at all, and it
catches every TQ-06 failure; NLI and embedding provenance cannot tell the right table value from its
lookalike. V1 is **not** ready as a refusal gate (7–10 % false flags, all from table text, and 6 of 19
lookalikes still pass) — it is ready as a **shadow-mode signal**. Details and rollout: `ARCHITECTURE_DECISION.md`.

## 2. TQ-06 (PRD §6 acceptance): every approach on the real answers

| Answer (real staging turn unless marked) | Gold label | V0 | V1 / V1b | NLI (all three) | Embedding |
|---|---|---|---|---|---|
| "S:3/10" cited p.234 (10-18) | wrong (fabricated) | served | **unsupported** (absent) | supported | — |
| ".ER (bit 11) … no specific DLEN bit" (10-20 02:34) | hedged | served | **unsupported** | supported | — |
| ".ER bit, bit 12 when .DLEN ≠ .RLEN" p.238 (02:36) | **correct** | served | **supported** (bound to `.DLEN`, p.238) | supported | — |
| ".ER (bit 11) … if DLEN does not match" (05:45) | wrong (lookalike) | served | **unsupported** | supported | — |
| ".ER bit, bit 12 …" p.238/240 (05:46:12) | **correct** | served | **supported** | supported | — |
| "excerpts do not say" ×2 | abstain | withheld | no opinion | no opinion | — |
| Real-36 Lane A: "S:7/15" cited p.234 | wrong (lookalike row) | served | **unsupported** (unbound: p.234 never mentions `.DLEN`) | supported | — |
| Adversarial: correct answer with "bit 12" → "bit 11" | wrong | — | **unsupported** | supported | — |

NLI `nli-deberta-v3-base` minimum sentence entailment: the **correct** bit-12 answer scores **0.00**, the
adversarial bit-11 swap scores **0.00**. No threshold separates them.

## 3. Hypotheses

| | Result |
|---|---|
| **H1** typed verification eliminates wrong bit/parameter/code answers | **Partly supported.** Every bit/address/code lookalike in the set is caught (TQ-06 7/7). Quantity lookalikes are caught only when the question names a mnemonic or code to bind to; 6 of 19 held-out wrong answers still pass (§5). Not "eliminates". |
| **H2** structural table parsing beats flat text | **Supported on the cases tested, with a licence blocker.** Docling kept the Micro810 model columns (flat text dropped a header and *misled the gold labeller and me* — §6), the Micro820 "Volt-Amperes" unit header, the E3 summary row and the M12 pin table. `pdftotext -layout` kept most rows too; the production `unpdf` text is the flat kind. TableFormer weights' licence is unresolved. |
| **H3** NLI/provenance beats exact rules without excessive false abstention | **Rejected** for these models on technical manual text. At any τ that catches half the wrong answers, NLI flags 50–70 % of correct ones (held-out curve below). Embedding provenance (the Guardrails `provenance_embeddings` mechanism) is no better. |
| **H4** a combination beats the best single candidate | **Rejected.** V1b→NLI equals V1b on catch and adds 1 wrong-answer pass; V1∨NLI adds false flags. |

NLI held-out curve (descriptive, NOT used for selection — selection was dev-only):

| τ | 0.05 | 0.25 | 0.45 | 0.65 |
|---|---|---|---|---|
| `deberta-v3-base` caught / false flags | 9/19 · 77/161 | 12/19 · 111/161 | 12/19 · 127/161 | 12/19 · 132/161 |
| `MiniLM2-L6-H768` | 5/19 · 47/161 | 12/19 · 107/161 | 16/19 · 135/161 | 19/19 · 157/161 |

## 4. Data actually used (what is and isn't here)

- 653 frozen real answers (12 public-50 walks across lexical / hybrid / rerank fp32 / rerank int8; real-36 Lane A;
  Schneider-8 hybrid; 9 PLC-5 TQ-05/06 turns) + 21 adversarial items (value swaps and page swaps built
  mechanically from real correct answers, `build_adversarial.py`). Corpus sha256 `c7bad35b…` (manifest).
- **Repeated trials:** 5 identical-configuration trials exist only for public-50 at `eaa4de988`. 8 of 48 graded
  questions change label across those 5 trials (generation variance, e.g. smc50-q4 abstains 4/5).
  No new trials were generated (paid answer model — PRD §8).
- **Safety:** 37 answers were the energized-work safety stop; no validator ever replaces or scores a safety
  stop (they are labelled `safety_stop` and excluded). No safety regression is possible from a validator that
  runs after the safety gate and only adds a signal.
- **Not done (needs Mike):** staging stranger walk of a finalist, any new answer generation, Real-36 end-to-end
  re-walk.

## 5. Grader audit and every known failure

**Grader audit (hand, 40 stratified labels + all 30 "wrong" labels):** the first deterministic labels were
wrong far more often than right in the "wrong" bucket. Fixes, all recorded in `data/gold-audit.json`:
safety stops get their own label; declines are checked before facts; a PDF replacement glyph (`P06�15`) and
curly apostrophes normalised; short numbers match as whole words; prose questions (paraphrase defeats string
matching) are scored separately and kept out of the headline; extra supporting pages added only after reading
them (6 accepted, 2 rejected — automatic widening by value presence was tried and rejected because it is the
lookalike trap itself). 3 gold entries marked doubtful and excluded.

**V1 frozen-version false flags (17), root causes:**
- 12 × Micro820 p.19 relay table: "1800 VA" — the extracted text has `1800` and `180` under a separate
  `Volt-Amperes` header, so the quantity never appears with its unit. Table structure (H2) problem.
- 5 × GS10 p.3: `10\nminutes` — PDF line wrap; the reused `supporting-quote` extractor requires value and unit
  on one line. **V1b** joins wrapped lines and removes these 5. V1b was written AFTER held-out results were
  seen, so its numbers are post-hoc and need a fresh held-out set before they count.

**Wrong answers V1/V1b still pass (6 + 1 no-opinion):** the question's subject is a phrase, not a mnemonic or
code, so there is nothing to bind to and presence on the page is accepted:
"0 s" for E3 phase-loss delay (0 s is the inhibit default), "60 m" for TM172 CAN length (another baud rate),
"(80 hex)" boot-up COB-ID (two items; "80 hex" also not extracted as a hex claim), "0.5 A @ 55 °C" for the
Micro810 follow-up "?And the max current?" (no subject at all), `tH1o` not extracted (code shape
letter-digit-letter). Page-swap with no typed claim (E3 trip class "5…30") → no opinion.

## 6. Findings outside the validators

1. **The walk scorecard's WRONG_PAGE is inflated.** Of 155 WRONG_PAGE rows across the 12 walks, 30 are correct
   typed answers citing a second page that also states the fact (E3 p.89 trip summary, PF40 p.12/p.92, ACS355
   p.49), 12 are safety stops pointing at the lockout page, 21 are abstentions. The release gate "zero wrong-page
   citations" (PRD §6) is unmeetable as currently scored. `score.ts` should accept any page that states the
   fact (hand-listed per question, as here).
2. **A real-36 gold label is wrong** (`real-36.json` tq-04/tq-06, on draft #4534): flattened text dropped the
   first model column of the Micro810 table, so "20.4…26.4V DC for 2080-LC10-12QWB" looked like a column
   mix-up. Docling's table shows it is correct. Both the gold-drafting agent and my own first audit got this
   wrong from flat text.
3. **Cited pages are not persisted per turn** — not in `equipment_notebook_turns`, `decision_traces`, or the
   Langfuse trace (only counts). Citations cannot be audited after the fact; 3 PLC-5 TQ-05 turns had to be
   excluded for this reason.
4. **Docling does not fix the PLC-5 +29 font cipher** (p.238 stays garbled); MIRA's own decoder (#4515) does.
5. **Docling cost:** 1–25 s per page on M4 (first page includes model load), 2.2 GB RSS; TableFormer weights'
   licence is listed as both `cdla-permissive-2.0` and `apache-2.0` with no per-file attribution.

## 7. Reproduce

`tools/evidence-runoff/README.md`. Inputs are gitignored under `.planning/` (manual text); the manifest
records every input sha256. All runs are deterministic except NLI on GPU (float noise < 1e-4 observed).
