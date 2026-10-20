# Evidence-verification runoff — results (2026-10-20)

Plan: `RUNOFF_PLAN.md` (frozen at `5172a08`). Harness: `tools/evidence-runoff/` (commands in its README).
Per-answer outputs with Langfuse trace IDs (653/653 real answers): `tools/evidence-runoff/results/per_item.jsonl`
(no manual text); aggregates `results/results.json`; parser track `results/docling_report.json`.
Spend: **$0** — no paid API call. NLI and Docling ran locally on CHARLIE (Apple M4, 16 GB), embeddings on local
Ollama.

## 1. Headline (held-out only; dev shown separately)

Bad answers are split by kind, because the kinds test different things. "Incidental" = the validator also
flags the *unswapped correct original*, so the catch says nothing about the swap.

| Validator | Real wrong answers (2) | Value swaps = lookalike test (9) | Page swaps (8) | Correct answers wrongly flagged (163) | p50 / p95 per answer |
|---|---|---|---|---|---|
| V0 shipped answer gate (control) | 0 | 0 | 0 | 0 | — |
| **V1 typed verifier, frozen (`ee6f8e0`)** | 1 | **1 genuine** + 3 incidental | **6 genuine** + 1 incidental | 17 (10.4 %) | 0.06 ms / 1.3 ms |
| V1b = V1 + join wrapped lines (**post-hoc**) | 1 | 1 + 3 incidental | 6 + 1 incidental | 12 (7.4 %) | 0.06 ms / 1.3 ms |
| V3 NLI `deberta-v3-base`, claim sentences only (τ 0.06, dev) | 1 | 1 genuine (tq-31) + 1 incidental | 6 | 39 (24 %) | 0.37 s / 2.9 s (M4 GPU) |
| V3 NLI `MiniLM2-L6-H768`, claim sentences only (τ 0.20, dev) | 0 | 2 genuine (tq-31 ×2) + 1 | 8 | 40 (25 %) | 0.08 s / 0.41 s |
| V3 NLI, all-sentence minimum (as first run) | 0 | 0 | 0 | 0–6 | (τ tuned to ≈0 → effectively off) |
| V2 embedding provenance (nomic, τ 0.62) | 0 | 0 | 3 | 9 | 0.11 s / 0.34 s |
| V1b → NLI-claim fallback (best combination) | 1 | 1 + 3 incidental | 8 | 14–18 | V1 + NLI on the answers V1 has no opinion on |

**Dev** (the TQ-06 / PLC-5 items the binding rule was tuned on): V1 catches 7 of 8 dev wrong answers with 0 of 5
false flags — every TQ-06 failure. This is a **dev** result, not held-out evidence.

**What the numbers say, plainly:**
- The typed verifier reliably catches **wrong-page citations** (6/8 genuine held-out page swaps) and the
  **bit / PLC-address lookalikes it was built on** (TQ-06, dev).
- **No candidate reliably catches a held-out lookalike value.** The best genuine held-out lookalike catch is
  2 of 9, by claim-sentence NLI, at a 25 % false-flag rate.
- V1's 3 Micro820 "catches" are artifacts of its Micro820 false flags (§5), not detection.

## 2. TQ-06 (PRD §6): every approach on the real staging answers (dev)

Trace IDs are Langfuse (US project, `deployment.environment.name=staging`).

| Answer | Trace | Gold | V0 | V1 / V1b | NLI base, claim sentence (entailment) |
|---|---|---|---|---|---|
| "S:3/10" cited p.234 (10-18) | `d9288682…` | wrong (fabricated) | served | **unsupported** (absent) | 0.00 → unsupported |
| ".ER (bit 11) … no specific DLEN bit" (02:34) | `36a27118…` | hedged | served | **unsupported** | low → unsupported |
| ".ER bit, bit 12 when .DLEN ≠ .RLEN" p.238 (02:36) | `4decaf9e…` | **correct** | served | **supported** (bound to `.DLEN`, p.238) | **0.98** → supported |
| ".ER (bit 11) … if DLEN does not match" (05:45) | `4f1dbebc…` | wrong (lookalike) | served | **unsupported** | **0.013** → unsupported |
| ".ER bit, bit 12 …" p.238/240 (05:46) | `34943e05…` | **correct** | served | **supported** | **0.43** → supported |
| "excerpts do not say" ×2 | `d24cf41b…`, `f164982f…` | abstain | withheld | no opinion | — |
| Real-36 Lane A "S:7/15" p.234 | in per_item | wrong (lookalike row) | served | **unsupported** (p.234 never mentions `.DLEN`) | unsupported |
| Adversarial "bit 12"→"bit 11" | — | wrong | — | **unsupported** | 0.042 → unsupported |

The first runoff reported NLI as unable to separate bit 11 from bit 12 ("0.00 vs 0.00"). That was **wrong**:
the answer-level score took the minimum over *all* sentences, and an unrelated second sentence scored 0.00
for both. On the claim sentence itself NLI separates them (0.98/0.43 vs 0.013/0.042; values after the Codex F2
fix below). Corrected here.

## 3. Hypotheses

| | Result |
|---|---|
| **H1** typed verification eliminates wrong bit/parameter/code answers | **Not shown on held-out.** Catches wrong-page citations (held-out) and bit/address lookalikes (dev, TQ-06). On held-out quantity and phrase-subject lookalikes it caught 1 of 9 (a unit mismatch). |
| **H2** structural table parsing beats flat text | **Supported on the pages tested; licence blocker.** Docling kept the Micro810 model columns, the Micro820 "Volt-Amperes" header, the E3 summary row and the M12 pin table; plain text lost each. `pdftotext -layout` kept most rows too. TableFormer's weight licence is unresolved. |
| **H3** NLI/provenance beats exact rules without excessive false abstention | **Rejected as a gate, configuration-dependent.** Claim-sentence NLI catches lookalikes V1 cannot bind (tq-31 boot-up COB-ID) but flags 23–25 % of correct answers. All-sentence-minimum NLI is useless. Embedding provenance (the Guardrails mechanism) is weakest. Only the three MNLI/SNLI models were eligible; no larger or domain-tuned NLI model was tried. |
| **H4** a combination beats the best single candidate | **Marginal.** V1b → NLI-claim fallback: +1 page-swap catch for +2–3 false flags. V1 ∨ NLI multiplies false flags. |

## 4. Baseline reproduction (PRD §6)

No walk was re-run (paid answer model). The baseline is the 12 existing public-50 walks:

| Walk set | Config / SHA | Walk card CORRECT (right page cited) | WRONG_PAGE |
|---|---|---|---|
| w1–w5 | lexical, `eaa4de988` | 29, 29, 28, 28, 29 (mean 28.6) | 14, 13, 14, 12, 13 |
| p1 | hybrid, `a249da17b` | 28 | 17 |
| rr1-1..3 | lexical + fp32 rerank, `2aae7250d` | 32, 32, 31 | 12, 10, 11 |
| int8-1..3 | lexical + int8 rerank, `82d457a8b` | 31, 31, 29 | 14, 13, 12 |

This reproduces the briefing's 28.6/50. The briefing's 31 / 36 / 39 / 46 are **zero-token replay numbers**
("answer text visible in the six chunks"), not answer correctness, so they are not comparable to these.

## 5. Deviations from the frozen plan (and why)

1. **12 walks, not 13** (the plan miscounted).
2. **Adversarial set scored on held-out.** The plan put it in dev; held-out real answers contained only 2 wrong
   answers, too few to measure catch. Items built from held-out questions were scored, never tuned on.
3. **Typed-only headline.** Hand audit showed string matching cannot grade paraphrased prose; prose questions
   are labelled `prose_*` and excluded from catch/false-flag.
4. **Dev false-flag cap of 10 %** for threshold tuning, decided before tuning. Dev has only 5 correct typed
   answers, so the cap means "no dev false flag"; that is why all-sentence NLI tuned to ≈0.
5. **V1b is post-hoc** (written after held-out verdicts were seen). Its numbers need a fresh held-out set.
6. **Gold edits after verdicts were seen** (all in `data/gold-audit.json`): e3plus-q2 dropped a parameter-number
   key; gs10-ch6-q2 accepts the 5-minute value p.3 states; tq-34 split into two facts; tq-04/06 corrected
   (§7.2); 6 extra supporting pages hand-accepted, 2 rejected; 3 questions marked doubtful and excluded.
7. **NLI rescored**, plus the claim-sentence variant (§2). The first rescore stripped ANY trailing number as a
   presumed citation digit and so deleted real values ("bit 12 [1]." → "bit."); Codex review #4550 r1 (F2) caught
   it, and r2 showed the first fix (strip only numbers made of the answer's citation numbers) still deleted a
   value that equals a citation number ("bit 11 [1]"). Final fix: the corpus now holds the RAW streamed answer
   (bracketed `[n]` markers, recovered from the recorded SSE and un-mojibaked) and only bracketed markers are
   removed — a bare number is never treated as a citation (`test_sentences.py`, red against the r1 logic). This
   changed no answer label and no V1/V1b verdict. All NLI numbers in this document are from the final run.

**Independence disclosure:** the gold audit, the hand labels and the verifier were all done by the same agent
(Claude, this session). The PRD asks for independent label audit; that has **not** happened. The gold drafts
came from two separate subagents with every quote machine-checked against the page, but the corrections were
mine. Treat the labels as reviewed-once, not independently audited.

## 6. Every known verifier failure

**False flags (V1 17 → V1b 12), all extraction artifacts:**
- 12 × Micro820 p.19 relay table: the text has `1800` and `180` under a separate `Volt-Amperes` header, so
  "1800 VA" never appears with its unit. Table-structure (H2) problem.
- 5 × GS10 p.3: `10\nminutes` line wrap; the reused `supporting-quote` extractor requires value and unit on one
  line. V1b fixes these.

**Misses:** when the question's subject is a phrase, not a mnemonic or code ("phase loss", "boot-up message",
"at 500 kBd", "?And the max current?"), there is nothing to bind to, so presence on the page is accepted:
"0 s" (E3 phase-loss delay; 0 s is the inhibit default), "60 m" (TM172 CAN length at another baud rate),
"(80 hex)" boot-up COB-ID ×2 (also not extracted as a hex claim), Micro810 "0.5 A @ 55 °C". `tH1o` is not
extracted (letter-digit-letter code). A page swap with no typed claim gets no opinion.

**Production caveat:** the runoff checked answers against the full text of the cited page. In production the
model sees only `MODEL_VISIBLE_CHARS = 1200` of each chunk, so a value beyond that prefix will read as absent.
Shadow-mode false-flag rates should be expected to be higher than 7.4 %, not compared against it.

## 7. Findings outside the validators

1. **The walk scorecard's WRONG_PAGE is inflated.** Of 155 WRONG_PAGE rows across the 12 walks, 30 are correct
   typed answers citing a second page that also states the fact (E3 p.89 trip summary, PF40 p.12 / p.92,
   ACS355 p.49), 12 are safety stops pointing at the lockout page, and 21 are abstentions. "Zero wrong-page
   citations" (PRD §6) is not meetable as currently scored. `score.ts` should accept a hand-listed set of
   pages that state each fact.
2. **My own derived gold misread a flattened table.** For tq-04/06 (Micro810 supply voltage) the
   gold-drafting agent and my first audit both treated "20.4…26.4V DC for 2080-LC10-12QWB" as a column mix-up.
   Docling's table shows it is correct: plain text had dropped the first model column. `real-36.json` itself is
   fine (expected page 57 and a locating anchor, both correct). Flattened tables mislead graders, not only the
   answer model.
3. **Cited pages are not persisted per turn** — not in `equipment_notebook_turns`, `decision_traces`, or the
   Langfuse trace (counts only). Citations cannot be audited after the fact; 3 PLC-5 TQ-05 turns were excluded
   for this reason. (The walk harness has them only because it records the SSE stream.)
4. **Docling does not fix the PLC-5 +29 font cipher**; MIRA's own decoder (#4515) does.
5. **Docling cost:** 1–25 s per page on M4 (the first page includes model load), 2.2 GB RSS. TableFormer weights
   are listed as both `cdla-permissive-2.0` and `apache-2.0`, with no per-file attribution.
6. **Generation variance:** 8 of 48 graded questions change label across the 5 identical lexical walks.

## 8. Reproduce

`tools/evidence-runoff/README.md`. Inputs are gitignored under `.planning/` (manual text); `data/manifest.json`
records every input sha256. Everything is deterministic except NLI on the GPU (float noise < 1e-4 observed).
