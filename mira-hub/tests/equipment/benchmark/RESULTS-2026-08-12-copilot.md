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

## SESSION CLOSE — final tally (battery `final3`, live dev app, full PF525 manual)

**53 turns = 30 single-turn + 23 multi-turn (5 conversations).** Deterministic auto-signals flag 6; **3 of those are the heuristic mis-flagging CORRECT refusals** (warranty + P999-adversarial + a variance-uncited broad answer), leaving **3 genuinely-weak turns**, all multi-turn (keypad-navigation, decel-too-high effect, return-to-topic).

- **Single-turn: 30/30 acceptable** — no fabrications, no wrong answers; every grounded answer cited or correctly abstained.
- **Multi-turn: ~21/23 turns good; 2 genuine failures** (topic-switch "what's the maximum?" lexical collision → P044; return-to-topic "go back to that decel setting").
- **Both mission "known failures" FIXED for the right reason** (ranking, verified by trace): fault-clear (p.160 #1), profinet (premise corrected, p.185).
- **Paraphrases generalize** (4/4 fault-reset, comm variants). **Adversarial safe** (no fabrication on P999/EtherCAT). **Zero regression** on the prior wins (multi-turn, completeness, F1, exact/fault/vocab, abstention).

**Two late fixes (measured):**
- **"taking too long to stop" → decel time (P042)** — the mission's own example conversation led with P045 [Stop Mode] then cascaded to abstentions; a vocabulary bridge now leads with P042 (default 10 s, max 600 s), all cited.
- **Removed the broad-intent index penalty** — measured (4 runs): it demoted the protection evidence (fault tables read as index-like), making "what protections?" flip-flop abstain/answer (1/3 abstained). Removed → 3/3 answer with citations. A broad-only temperature experiment didn't help and was reverted.

**Variance (measured, not guessed):** "what protections?" retrieval is deterministic; the residual variance is generation-only (facet count 2–4), no longer abstain-vs-answer. Documented as generation variance, not a retrieval defect.

## Procedure / section-aware ranking (the two "known failures", fixed for the right reason)

`section_path` is NULL on v2 chunks, so ranking uses the chunk's CONTENT signature. Added an env-gated **retrieval trace** (`NOTEBOOK_RETRIEVAL_DEBUG=1` → per-candidate page/base-rank/rerank-score/features + winning pages) to make retrieval observable, then:

- **`classifyIntent`** — lexical intent (fault / procedure / comm / spec / param_lookup / broad).
- **Intent-gated content features in `rerankChunks`** — a procedure/fault question **boosts prose+imperative signal and penalizes param-index density** (a cross-reference index can't beat an actual how-to on lexical overlap); a comm question boosts comm-material; **param_lookup/spec keep exact-token dominance with no index penalty** (the param row IS the answer).
- **Comm fan-out on comm-intent** (not just broad) + **named protocol as an exact token** — so a specific "where's the PROFINET setting?" retrieves the adapter table (p.185) that proves it's adapter-only.
- **Evidence-gated premise-check** re-added — now justified by the trace: for profinet the evidence reached context but generation abstained, so the directive flips a **generation** failure, not a retrieval one. Guarded so hydraulic/warranty (no supporting excerpt) still abstain.

| question | before | after (trace-verified) |
|---|---|---|
| how do I clear a fault? | abstained (param-index out-ranked p.160) | **Stop / A551 [Fault Clear] / DI "Clear Fault"**, cited p.160/164 — p.160 rose to rank #1 |
| where's the Profinet setting? | abstained (p.185 never retrieved) | **"no built-in PROFINET; only via optional adapter (25-COMM-PNET2P)"**, cited p.185 — premise corrected |

**Paraphrases generalize** (not benchmark-overfit): all 4 fault-reset paraphrases ("reset a fault", "clear this trip", "get it running again after a fault", "reset procedure") now give the A551/Stop/DI procedure cited p.160/164; comm paraphrases ("where do I configure Profinet?", "where are the Ethernet settings?", "how do I configure the network?") answer correctly with premise-correction. **Zero regressions** on exact-fact / fault-meaning / broad / multi-turn / F1 / abstention (full battery `after8-ranking` + `expanded`).

**Adversarial (false premises) — safe:** "P999 controls Profinet, right?" → refused (no P999, PROFINET via adapter); "manual says EtherCAT, enable it" → refused (not documented); no fabrication. (Minor: "that parameter's maximum" for A551 answered "2" — grounded highest enum, but accepts the "maximum" framing rather than correcting "it's an action, not a range".)

## Newly-surfaced hard cases (multi-turn topic tracking — next frontier, documented not rushed)

The **topic-switch** conversation exposed two genuinely hard cases (NEW tests, not regressions):
- **T2 "what's the maximum?"** after establishing P042 → resolved to **P044 Maximum Freq** (lexical collision on "maximum") instead of P042's max — a **conversation-resolution failure (D)**.
- **T5 "go back to that decel setting, what's the default?"** after an intervening Ethernet topic → abstained on P042's default (10 s) — **retrieval failure (A)**: the follow-up augmentation carried the *recent* (Ethernet) topic's tokens, not the returned-to decel topic.

These need lightweight topic-state tracking (which topic a "go back to X" / bare "what's the maximum?" refers to). Deliberately **not** attempted here — that's the conversation-state work the mission warns against over-engineering. Classified and queued.

## Hardest remaining (honest, non-systematic)

- **IP-value reasoning:** "mine says 192.168.1.20, is that okay?" → honest refusal ("the excerpts don't specify"). A great copilot would reason about the IP format from general knowledge while grounding subnet/gateway in the manual — but forcing that risks ungrounded answers, so left as-is for now.
- **Ambiguous "that parameter"** in the won't-run thread (command-word vs start-source, both discussed) resolves ~half the time — LLM variance at temp 0.3, not a systematic miss.
- **Shared root cause → next PR (retrieval ranking in a large corpus):** two remaining misses have the *same* cause — the **procedure / corrective chunk is out-ranked by param-list noise** in the full manual:
  - "how do I clear a fault?" → the "Manually Clearing Faults" procedure (p.160) + "Stop command clears active fault" (p.87) exist and are retrievable, but param-index chunks that merely list "Fault Clear 551" out-rank the procedure into the top-k, so the model abstains.
  - "where's the Profinet setting?" → the adapter table (p.185, proving PROFINET is adapter-only) isn't ranked into the top-k for a specific-protocol query, so there's no excerpt to correct the premise from. A grounded premise-check directive was tried and **reverted** (zero regressions, but no measured benefit without the corrective chunk in context).
  - Fix direction: **section/procedure-aware ranking** (boost chunks whose section is a procedure/how-to, or heading-aware retrieval) so how-to and corrective sections beat param-index noise. That's the next PR.

---

# Round: topic-state tracking (defects D + A) — 2026-08-12 (late)

The two queued topic-switch defects, fixed with deliberately lightweight topic tracking in
`notebook-query.ts` + one route wiring change. Trace-driven (NOTEBOOK_RETRIEVAL_DEBUG=1) — each
sub-cause was measured before the next fix was attempted:

- **`topicPool`** — a referential follow-up that NAMES its topic ("go back to that decel
  setting") augments retrieval only from the thread turns that share that topic, anywhere in the
  window — the intervening topic's tokens no longer pollute the query (defect A). A follow-up
  with a pronoun-as-pronoun signal ("where do I find IT on the keypad?") keeps recent-turn
  augmentation — the named noun ("keypad") is the question's surface, not the referent.
- **`buildTopicHint`** — deterministic, transcript-tokens-only note riding IN the user turn next
  to the question. An end-of-system-prompt hint measurably failed (T2 still answered P044); the
  user-turn note fixed referent resolution but exposed the next layer (below). The note names the
  attribute-ellipsis class explicitly ("what's the maximum?" asks for that attribute OF the topic).
- **Spec-intent value boost in `rerankChunks`** — after resolution was fixed, the model abstained
  because the VALUE-bearing chunk (Range 0.00–600.00 / Default 10.00) sat at rank #8 below
  param name-list pages (all exact-token ties). `specScore` (decimal-value + range/default
  density) breaks the tie for spec intent; the p.86/p.66 value chunks now rank #1/#2 (trace).

| turn | before (final3) | after (topicfix2, live) |
|---|---|---|
| topic-switch T2 "what's the maximum?" | **P044 [Maximum Freq]** (lexical collision) | **P042 max = 600.00 s**, cited p.86 + p.66 |
| topic-switch T5 "go back to that decel setting…" | abstained, no cites (Ethernet-token pollution) | **P042 default = 10.00 s**, cited p.66 |
| wont-run T4 "where do I check that parameter?" | "no specific parameter listed" | **b012 [Control Source] + P046 [Start Source 1]**, cited p.80/p.88 |

**Zero regressions** across all 5 multi-turn conversations (comm-drilldown, wont-run,
decel-shorthand, stop-too-long, topic-switch — runs/battery-topicfix2.md); singles are
structurally unaffected (empty history → no note, unchanged rewrite). Known residual (pre-existing,
failed identically in final3): topic-switch T3/T4 claims EtherNet/IP is adapter-only — the
embedded-vs-dual-port-adapter distinction still loses to the Appendix-H framing.

---

# Round: stabilization phase — EtherNet/IP architecture + keypad navigation + adversarial battery + citation integrity (2026-08-13)

Trace-driven (NOTEBOOK_RETRIEVAL_DEBUG=1); every fix identified its failing layer before code
changed, and each landed red-first.

## EtherNet/IP embedded-vs-adapter confusion (topic-switch T3/T4) — FIXED, two layers

- **T3 (retrieval ranking):** context was [3,202,205,146,249,103] — the RS-485/DSI-Modbus appendix
  dominated on generic comm density (cm=1.0 for ANY comm material); none of the embedded-proving
  chunks (p.17/35/106/147) reached context. Fix: **protocol-family affinity** — a comm question
  naming ONE protocol family scores chunks on THAT family's terms (`queryProtocolFamily` +
  `familyScore`). Ethernet question → embedded-EtherNet/IP chunks; Modbus appendix demoted.
- **T4 (query pollution):** rewritten query carried `P042 Decel` across the topic switch (the
  bare-referential slice(-4) reached into pre-switch turns), and the "adapter required" claim
  cited pages that didn't prove it. Fix: **bare/pronoun referential pool = most recent topic
  segment** (from the latest topic-bearing user turn onward).
- After: T3 "embedded EtherNet/IP adapter (built-in) and optionally 25-COMM-E2P dual-port"
  cited p.249/147/250 (p.147 = F683 [Com Sts-Emb Enet]); T4 "No — built-in; dual-port optional"
  — the exact WANT.

## Keypad navigation — classified **BUG — evidence exists; retrieval/generation fixed**

The loaded UM contains the full procedure (p.62 Control and Navigation Keys, p.63 Viewing and
Editing Parameters). It never reached context for "where do I find it on the keypad?" — four
stacked causes, each fixed generally:
1. History-carried P042 poisoned every AND variant and dominated rerank → **message-native OR
   pass** (`opts.rawQuery` in retrieveNodeChunks): augmentation may only ADD candidates.
2. Exact-ID dominance is wrong when the ID is thread context, not the subject → **procedure-intent
   exact damping** (0.5 vs 3.0) + proc signal 2.5.
3. `synTerms` kept punctuation ("keypad?") so the message's own keyword could never match chunk
   text — **token-hygiene fix** (real bug, general).
4. "keypad" shares no vocabulary with "Viewing and Editing Parameters" → **navigation-phrasing
   synonym row** (trigger `on/from/via the keypad` — a bare "the keypad works but not from the
   PLC" is a control-source question and must NOT be flooded; first broad trigger regressed
   wont-run T2 and was narrowed).
After: "Press Esc → group list → P group → Enter → scroll to P042 → Enter" cited p.63/62;
generalizes (stop-too-long T5, adv-5topic T9, adv-abstain T3 all pass).

## Adversarial battery (new, committed): 3 conversations stressing topic memory

`adv-5topic-interleave` (5 topics, ordinal return after 6 turns, attribute ellipsis, keypad),
`adv-similar-names` (Maximum Freq / Minimum Freq / max decel collisions), `adv-abstain-return`
(required abstention mid-thread + return). New defects found and fixed:
- **Ordinal return** ("go back to that first setting we talked about") resolved to the LATEST
  topic → ordinal-return rule picks the EARLIEST topic segment (requires return-signal + ordinal;
  "what do I set first?" step questions unaffected). Also raised the history window (client 12
  turns, sanitize cap 12) — at 6, a 5-topic conversation's opening topic fell out entirely.
- **Trailing deictic false positive**: "how do I set up Ethernet on THIS?" — "this" = the drive;
  decel tokens polluted it into an abstention → a message that NAMES a topic defines its own
  subject (named-topic check now precedes pronoun recency).
- **Param-ID request misclassified as spec**: "what's the maximum frequency parameter?" — spec's
  value-density boost flooded context with A-group tables and the model abstained 2/3 →
  `PARAM_ID_REQUEST` precedes SPEC in classifyIntent. After: P044 3/3.
  (A generation-side abbreviation-equivalence prompt line was tried first and REVERTED — no
  measured benefit on its target case.)

## Citation-integrity gate (new, committed)

`cite-check.mjs` + `cite-oracle.json`: for each oracled turn, required answer markers AND at
least one CITED page whose chunk text matches a support regex (right number + wrong page = FAIL),
plus zero-citation abstention contracts. 9/9 pass on the adversarial battery. It caught a real
class in earlier runs (P042 "defaults to 0.00" — min misread as default — now watched).

## Oracle scorer fix

`absent-cable-length`: the answer's grounded deferral ("specified in the … Wiring and Grounding
publication", which UM p.10/p.34 genuinely make) wasn't recognized by the acknowledges regex —
widened to accept grounded pointing; a fabricated numeric length still fails.

## Known limitations (honest)

- Single-run LLM variance at temp 0.3 persists on definition sub-claims (one run said P044
  "defaults to 0 Hz"); the cite-check oracle pins the critical values.
- comm-drilldown T1 broad opener drifts run-to-run in emphasis (embedded vs adapter first);
  citations stay grounded. Multi-evidence completeness is the next product phase.
