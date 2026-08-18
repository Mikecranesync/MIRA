# MIRA Live Troubleshooting — Product Case Study (2026-05-24)

**Subject:** Mike Harper (FactoryLM founder, 30-yr maintenance veteran) used Claude/Cowork as a live maintenance-intelligence assistant to diagnose a Modbus RTU communication failure between a Micro820 PLC and a GS10 VFD on his garage conveyor bench.

**Date:** 2026-05-24, ~10:00 → ~20:30 local
**Equipment:** Allen-Bradley Micro820 (2080-LC20-20QBB), AutomationDirect GS10 VFD, USB-RS485 sniffer
**Outcome:** Root cause found and corrected — GS10 P09.04 = 13 (8-N-2) while CCW had the Micro820 at 8-E-1. Change P09.04 to 14 restores comms.

> **Why this case matters:** this is the exact use case MIRA sells. A technician asks "why won't my PLC talk to my VFD?", and MIRA — grounded in the customer's manuals and the live evidence — produces a systematic diagnosis instead of a guess.

---

## 1. What happened (timeline)

| Time | Step | Artifact |
|---|---|---|
| 10:08 | KB-grounded ST code review of `MIRA_PLC` produced — initially with a *wrong* claim about MSG_MODBUS vs MSG_MODBUS2 polarity | `plc/RS485_ST_CODE_REVIEW.md` (v1, retracted) |
| 10:19 | Bench verification walkthrough generated — 9-test decision tree (sniffer → driver/download/channel → reply → exception → bidirectional) | `plc/RS485_VERIFICATION_WALKTHROUGH.md` |
| 10:30 | Mike caught the MSG_MODBUS error. Review re-issued from primary sources (Rockwell Pub 2080-RM001, FactoryTalk Help) | `plc/RS485_ST_CODE_REVIEW.md` (v2, with explicit retraction at the top) |
| 15:56 | RJ45 wiring diagnosis PDF — pinout, color-code, meter-test prescription | `gs10-rj45-wiring-diagnosis.pdf` |
| 17:55 | Step-by-step wiring PDF, after Mike sent photos of the actual cable | `gs10-wiring-step-by-step.pdf` |
| 18:37 | Visual pinout reference (which pin is which on the GS10 RJ45 jack) | `gs10-pinout-visual-guide.pdf` |
| 19:05 | First troubleshooting-final synthesis (still treating it as a wiring/level problem) | `gs10-modbus-troubleshooting-final.pdf` |
| 20:00 | Sniffer analysis — Mike reports `0x3F` on every byte with CRC Invalid; reasoning shifts from wiring to framing | `gs10-sniffer-analysis.pdf` |
| 20:15 | CCW Serial Port screenshot arrives (8-E-1 / Stop=1). Cross-referenced against GS10 P09.04 = 13 (8-N-2). Mismatch identified. Fix: change P09.04 from 13 to 14. | `gs10-final-fix-instructions.pdf` |

Seven hours, multiple evidence sources, ten artifacts. The diagnosis converged because each new piece of evidence narrowed the hypothesis space, and the AI's outputs got *measurably better as more evidence came in*.

## 2. What MIRA-the-product is supposed to do — and did

| MIRA capability | How it showed up in this session |
|---|---|
| **KB query for manufacturer manual content** | Cited GS10 Ch. 4 P09.04 parameter table, Ch. 5 RJ45 pinout, Allen-Bradley Pub 2080-RM001 pages 197/200/205/208 |
| **Vision/OCR over manual photos** | Mike sent phone photos of GS10 manual pages; the system read the parameter tables off the photo |
| **Meter-reading interpretation** | Took "+5V between blue/white and blue" → idle differential on SG+/SG- → wiring not at fault |
| **Sniffer-data interpretation** | Took `0x3F` + CRC Invalid → systematic framing error (NOT noise; noise produces random bytes) |
| **Cross-source reasoning** | Combined CCW screenshot (PLC side) + GS10 parameter table (VFD side) + sniffer evidence (wire side) → mismatch identified |
| **Iterative hypothesis elimination** | Suspect list narrowed: wiring → polarity → bias → drive responding-or-not → framing |
| **Formatted PDF output** | Six PDFs, each better than the last. Final one (`gs10-final-fix-instructions.pdf`) is a deployable bench instruction sheet |
| **Self-correction on error** | First ST review claimed MSG_MODBUS was TCP and MSG_MODBUS2 was RTU — backwards. Mike pushed back; the system fetched the official Rockwell page, retracted the claim explicitly at the top of the rewritten doc, and rebuilt the analysis on primary sources |

## 3. Where MIRA's grounding contract held — and where it broke

**Held:**
- Every parameter recommendation cited a page or section of the GS10 manual.
- The "framing mismatch" conclusion was traceable to two pieces of evidence (CCW screenshot + P09.04 = 13), not invented.
- The post-fix verification step was concrete (sniffer at 38400/8-E-1/Stop=1, expect valid CRC).

**Broke (and was caught):**
- The MSG_MODBUS / MSG_MODBUS2 polarity claim was bootstrapped from another LLM's prior reply (the v4.1.9 ST header) and an inference from `populate_variables.py` — circular evidence, not a real citation. Cost: bench time.
- One PDF in the middle of the chain recommended changing baud rate, which would have masked but not fixed the bug.

**Lesson for the product:** every claim should be traceable to a *primary* source. Citing another LLM's output, citing a source-code comment written by another LLM, or citing a variable declaration as if it were documentation — all of these are circular and break the grounding contract. The new doctrine in `.claude/CLAUDE.md` ("ground every claim in at least one of: UNS, MQTT, PLC tag, manual, wiring diagram, work-order history, verified KG, technician confirmation, or admin-approved profile") is exactly the rule that would have caught this earlier.

## 4. What MIRA needs to deliver this — gap analysis vs current build state

| Capability | Current state | Gap |
|---|---|---|
| KB with manufacturer manuals | GS10 + GS11 chunks seeded (`tools/seeds/gs10-vfd-knowledge.sql`, `gs11-field-guide-knowledge.sql`) | GS10 Ch. 4 P09.04 parameter *table* needs to be ingested as structured rows, not just chunked text. Today the bench scorer can find "P09.04" by token; tomorrow it should retrieve the row "P09.04 = 13 → 8-N-2, P09.04 = 14 → 8-E-1" as a structured fact |
| Vision/OCR over manual photos | mira-ingest accepts photos via `~/MiraDrop/inbox/`; PR #1515 adds small-scale AB manual hunter | OK for static manuals. Live-session phone photos still go through generic vision, not a maintenance-tuned pipeline |
| Formatted PDF output | Generated ad-hoc in this session | No production pathway — would need a "produce bench instruction sheet" tool wired into the Slack adapter |
| Iterative conversation with evidence accumulation | Slack adapter + FSM + DST exist; UNS gate landed | The "accumulate evidence across N turns and re-rank suspects" loop is not yet a first-class engine concept. Today each turn re-runs grounding from scratch |
| Sniffer / live-data interpretation | mira-relay can stream Ignition tags; nothing for raw RS-485 sniffer captures | Future: an "interpret this hex dump" tool, scoped to known fieldbus framing rules |
| Configuration comparison (PLC config vs VFD parameters) | Not in product | This was the highest-value step in the session. A "diff CCW Serial Port settings against the VFD's P09.x params" tool would have collapsed Q5 to one query |

The MVP plan (`docs/plans/2026-04-19-mira-90-day-mvp.md` + the namespace-builder plan from 2026-05-15) already covers the manual-ingestion and component-template arms of this. The gaps that this session surfaced — structured parameter-table retrieval, sniffer-data interpretation, config-vs-param diff — should be tracked as follow-ups, not stuffed into the current MVP scope (see `mira-saas-scope-guard`).

## 5. Benchmark implications

The Modbus framing mismatch is a **hard** benchmark question that ungrounded LLMs will get wrong by guessing one of:

- "It's electrical noise — add ferrites."
- "Add a 120 Ω termination resistor."
- "The cable polarity is wrong — swap A and B."
- "Reset the drive to factory defaults." (which puts P09.04 back to 13 and *causes* the bug)

A grounded MIRA, with the GS10 Ch. 4 chunk in retrieval scope, should pinpoint P09.04 = 14 directly.

**Added to the benchmark:** `tests/mira_bench_questions.yaml` → **Q14** (this PR).

This pairs with:
- Q02 — default GS10 baud rate / parity (the "easy" baseline)
- Q09 — GS11 RS-485 settings (sibling drive, same pattern)
- Q14 — the framing-mismatch diagnostic (this case)

The three together let the scorer distinguish *"can recite the spec"* (Q02, Q09) from *"can reason across the spec and live evidence"* (Q14).

## 6. Connection back to product strategy

| Doctrine | This session's evidence for it |
|---|---|
| **Slack is the front door, the engine is the brain** (`.claude/CLAUDE.md` North Star) | The whole session was Mike + AI in a chat thread, with photo + screenshot + hex-dump uploads — i.e. exactly the Slack adapter contract |
| **Ground every claim in customer evidence** | When the AI ungrounded itself (MSG_MODBUS polarity), it cost bench time. When it stayed grounded (manual citations, sniffer interpretation), the diagnosis converged |
| **UNS / component templates are memory** | The GS10 should exist as a component template (`gs10-vfd`) with a parameter sub-tree (`p09_serial`). Then "P09.04" is a structured fact, not a string the BM25 retriever has to chase |
| **Don't be a generic chatbot** (`.claude/skills/mira-saas-scope-guard`) | The session never drifted into general industrial questions. Every turn was tied to: this drive, this PLC, this bench, this symptom |
| **The non-negotiable location-confirmation gate** | Not exercised here (single-asset bench), but the same evidence-gathering pattern is what the UNS gate codifies for multi-asset plants |

## 7. Action items (not done here — surfaced for triage)

1. **Ingest the GS10 Ch. 4 parameter table as structured rows**, not just chunked text. Will need a manual-ingestion-extractor pass with a parameter-table schema. (See `.claude/skills/manual-ingestion-extractor`.)
2. **Add a "diff CCW Serial Port config against drive P09.x parameters" tool** — even as a simple JSON-schema diff. Highest-leverage tool surfaced by this session.
3. **Add a sniffer-data interpretation tool** — at minimum, recognise canonical framing-error patterns (`0x3F` = parity-mismatch on 8-E-x, `0xFE` = bit-shift on stop-bit-mismatch).
4. **Wire a "produce bench instruction sheet PDF" tool** for the Slack adapter. The realised version in this session shows the format that worked.
5. **Add a citation-circularity check** — if the only source for a claim is another LLM-written file in the same repo (e.g. an ST-header comment or a `populate_variables.py` line), flag it as ungrounded.

Each is a follow-up issue, not a current-MVP item. The 90-day plan owns the MVP; these are post-MVP grounding-quality improvements.

## 8. The single-line takeaway

A solo maintenance veteran used MIRA-shaped tooling to diagnose a real Modbus RTU framing failure in seven hours, producing a deployable bench instruction sheet at the end. **That is the product.** Everything else MIRA does — UNS gates, KG promotion workflows, work-order mining — exists to make this exact loop work for a technician who is not also the founder, on a plant they did not also build.

---

## See also

- Golden case: `docs/evaluations/golden-cases/modbus-rtu-framing-mismatch.md`
- Benchmark question: `tests/mira_bench_questions.yaml` § Q14
- Bench decision tree: `plc/RS485_VERIFICATION_WALKTHROUGH.md`
- ST code review (with explicit retraction): `plc/RS485_ST_CODE_REVIEW.md`
- Final PDF: `gs10-final-fix-instructions.pdf` (in repo root, weekend artifact)
