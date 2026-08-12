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

## F1 — referential follow-ups (fixed in `after5`/`after6`)

Symptom: after "where's the slowdown ramp?" → P042, the follow-up "what's the max I can set that to?" answered *"not specified in the excerpts"* — even though P042's max (600 s) sits right in the p.66 chunk (`P042 [Decel Time 1] 0.00/600.00 s`).

**Root cause (found by instrumenting the route, not guessing):** the follow-up's retrieval query was **never augmented** — the debug log showed `rq="what's the max I can set that to?"` unchanged, retrieving pages `[139,139,47,126,235,100]` (none is p.66). `isReferentialFollowup` under-detected: "that" is the **object** of "set…to" (not "that"+verb), so it wasn't recognized as referential and `buildRetrievalQuery` never folded the thread's P042/decel tokens in. The earlier prompt/topK nudge failed *because the model never received the P042 chunk* — it was a **detection** bug, not an answer bug.

**Fix:** broadened `isReferentialFollowup` to catch a pronoun used as a verb object ("set that", "turn it up"), a pronoun before a target particle ("that to", "it up"), and ordinal continuations with no pronoun ("what do I set **first**?"). Now:
- "what's the max I can set that to?" → **"600.00 seconds [1]"** cited p.86.
- "where do I check that parameter?" → resolves to **b012 Control Source**, cited p.80.
- "what parameter do I set first?" → **"Set C128 [EN Addr Sel] to 1 first … C129–C140 [3][4]"** cited p.103/104.

## Hardest remaining (honest, non-systematic)

- **IP-value reasoning:** "mine says 192.168.1.20, is that okay?" → honest refusal ("the excerpts don't specify"). A great copilot would reason about the IP format from general knowledge while grounding subnet/gateway in the manual — but forcing that risks ungrounded answers, so left as-is for now.
- **Ambiguous "that parameter"** in the won't-run thread (command-word vs start-source, both discussed) resolves ~half the time — LLM variance at temp 0.3, not a systematic miss.
- **Shared root cause → next PR (retrieval ranking in a large corpus):** two remaining misses have the *same* cause — the **procedure / corrective chunk is out-ranked by param-list noise** in the full manual:
  - "how do I clear a fault?" → the "Manually Clearing Faults" procedure (p.160) + "Stop command clears active fault" (p.87) exist and are retrievable, but param-index chunks that merely list "Fault Clear 551" out-rank the procedure into the top-k, so the model abstains.
  - "where's the Profinet setting?" → the adapter table (p.185, proving PROFINET is adapter-only) isn't ranked into the top-k for a specific-protocol query, so there's no excerpt to correct the premise from. A grounded premise-check directive was tried and **reverted** (zero regressions, but no measured benefit without the corrective chunk in context).
  - Fix direction: **section/procedure-aware ranking** (boost chunks whose section is a procedure/how-to, or heading-aware retrieval) so how-to and corrective sections beat param-index noise. That's the next PR.
