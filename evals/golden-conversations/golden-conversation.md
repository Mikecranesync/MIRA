# Golden Conversation (Baseline Standard §15) — mandatory release smoke

The smallest end-to-end canonical product path. Small, deterministic, understandable.
Run on a real supported device for release candidates (§10.3); the web rig may run it
per-PR. Every step records evidence; the run is invalid without it (§12).

**Fixture:** the tenant's eval notebook (env `FLM_EVAL_NOTEBOOK_ID`) with at least one
manual source attached (PowerFlex/GS10 family). One clearly-named test thread per run;
never delete anything (device etiquette).

| # | Step (§15 requirement) | Action | Must hold |
|---|---|---|---|
| 1 | Open FactoryLM | launch app / load `/` | usable composer without setup |
| 2 | Start or resume a conversation | drawer → New chat | blank conversation, zero foreign turns |
| 3 | Ask without unnecessary setup | send: "What does fault F004 mean on a GS10 drive" | no machine-selection demand |
| 4 | Evidence discovered | (sources already selected on the notebook) | answer draws on the manual corpus |
| 5 | Grounded answer | await stream end | answer text + evidence label; grounded label when sources hit |
| 6 | Citation inspectable | tap/click a citation | source title + page/quote visible; closes back to conversation |
| 7 | Conversation persists | force-close (device) / reload (web) → reopen thread | same turns, same thread id |
| 8 | Organization intact | open drawer | thread listed under its Project with first-question title; New chat still blank |

**Verdict:** PASS only if all 8 hold at the recorded SHA. Any step FAIL ⇒ Golden
Conversation FAIL ⇒ release HOLD (this is the §15 mandatory smoke).

Evidence bundle per run: `evals/results/<sha>/golden-conversation/` — one screenshot per
step + the thread id + the citation payload (title/page/quote) + timestamps.
