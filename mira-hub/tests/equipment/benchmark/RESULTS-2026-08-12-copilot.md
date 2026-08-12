# Maintenance-copilot battery — 2026-08-12

Telethon-style run of the **whole** Equipment Notebook against real technician
language, judged for factual / grounded / complete / helpful, then iterated.

- **App:** `feat/notebook-completeness-recall` (stacked on multi-turn #3201), dev hub `next dev` on :3131, dev Neon.
- **Notebook:** `39f36b8a` "Conveyor 4" — 4 sources incl. the **full** `pf525_user_manual.pdf` (+ Modbus map, anomaly catalog). The full manual is what makes broad/completeness questions meaningful (it proves multiple comm/speed/protection facets).
- **Corpus:** `tech-conversations.json` — 19 single-turn (exact / obscure / procedure / broad / troubleshooting / ambiguous-vocab / wrong-assumption / boundary / off-scope) + 3 multi-turn scripts (comm drill-down, won't-run, decel shorthand).
- **Runner:** `tech-battery.mjs` (threads history; captures Q/A/citations/status/latency; writes `runs/battery-*.md`). Verdicts are a technician's judgement against the source; auto-flags catch obvious defects (grounded-but-uncited, refusal-with-cites).

## Iteration log (measure each change)

| run | change | broad-comm | broad-speed | broad-protections | auto-flags |
|---|---|---|---|---|---|
| baseline (`after-fullmanual`) | multi-turn only (#3201) | **1 facet** (adapter table only; missed embedded EtherNet/IP + Modbus) | truncated, uncited | ok-ish | 5 |
| `after2` | + broad detection → facet fan-out + page diversity + enumerate-all directive | **3 facets, all cited** ✓ | truncated | **regressed to 1 line** | 2 |
| `after3` | + `reasoning_effort:low` on Groq + broad `max_tokens` 1400 | 3 facets ✓ | **9 sources, cited** ✓ | **7 protections, cited** ✓ | 3 (all F1) |
| `after4` | + referential-followup topK bump + continuity directive | ✓ | ✓ | ✓ | 3 (F1 unchanged) → **reverted** |
| **final** | after3 + F1 attempt reverted (didn't help) | ✓ | ✓ | ✓ | 3 (F1) |

## What WORKS now (judged great)

- **Multi-turn memory (#3201):** "let's use Ethernet" → pivots to the embedded-Ethernet params (C128 EN Addr Sel, C129–132 IP); "and the speed-up one?" → resolves to **P041 Accel Time 1** by contrast with the prior decel turn; "keypad works but not from PLC" → carries the won't-run objective to control-source. Conversational reference resolution is real.
- **Completeness (the headline fix):**
  - *"what communication options does this drive have?"* → **built-in EtherNet/IP + optional Ethernet adapter + RS-485 DSI Modbus (fn codes 03/06/16)**, each cited. (Was: only the optional-adapter table.)
  - *"what are all the ways I can command the speed?"* → **9 sources** (Speed Ref 1/2/3, Preset Freq, Jog, Spd+Strt, Step Logic, PID, Sleep-Wake), cited, ending with "want setup steps for any of them?".
  - *"what protections does this drive have?"* → **7 protection classes** (overload, IR-drop, load-loss, bus over/under, current over/under, freq over/under, min/max limits), cited.
- **Exact facts / faults / vocab / troubleshooting / off-scope:** P042, accel max 600 s, run terminal 02, F004 UnderVoltage, F005 OverVoltage, carrier 2–16 kHz (A440), "slowdown ramp"→P042, "motor amps"→P034 NP FLA, "runs but no turn" diagnostic sequence, hydraulic/off-scope correctly refused. All grounded + cited.

## Fixes shipped in this PR

1. **`classifyBroad`** — detects broad/enumeration intent (comm / speed / protection families + generic enumeration phrasing); returns generic facet vocabulary to fan retrieval across (never PF525-specific answers).
2. **Facet fan-out + `diversifyByPage`** in `retrieveNodeChunks` — a broad question runs an extra OR pass per facet term and keeps a bigger, page-diverse slice so scattered facets (embedded vs optional on different pages) all reach the answer.
3. **Broad answer-shape directive** — enumerate every option the excerpts prove (embedded AND optional), each cited, then offer the next step. Never lists an unproven option.
4. **gpt-oss budget fix** — `reasoning_effort:low` on Groq + `max_tokens` 1400 for broad answers: the hidden reasoning was eating the 800-token completion budget and truncating broad lists.

## Hardest remaining failure (honest)

**F1 — referential follow-ups that ask a named parameter's *spec* over-abstain.**
E.g. after "where's the slowdown ramp?" → P042, the follow-up "what's the max I can set that to?" answers *"not specified in the excerpts"* — even though P042's max (600 s) is in the manual (the single-turn accel-max returns it fine). Root cause **verified**: the follow-up retrieves the parameter's *definition* chunk but not its *range/spec* chunk (different page; tables split the param number from the range), so the model correctly refuses rather than hallucinate. A prompt nudge + topK bump did **not** move it (tried in `after4`, reverted) — confirming it's a **retrieval** problem (definition-vs-spec chunk, table-aware retrieval), the next PR's target. Not masked, not weakened.

Lesser: wrong-assumption ("where's the Profinet setting?") flatly abstains instead of correcting with the adapter table it can retrieve ("no embedded PROFINET; only via adapter"); "how do I clear a fault?" misses A551 on the full-manual corpus.
