## 2026-09-22 — MIRA Intelligence Contract (PR #3959)

**State:** implementation done, **blocked on two human gates**. Head
`4216391f4`. R0 `c2c8e44cb`. Full handoff in `HANDOFF.md` on the branch.

**What changed.** One persona definition (`mira-hub/src/lib/mira-contract.ts`)
behind `MIRA_PERSONA_CONTRACT`, default OFF, plus the routing fix behind the
same flag: normal authenticated chat is now **augmented** with or without
attached documents, and strict cite-or-refuse requires an explicit
`mode:"source_only"`. Persona no longer depends on whether retrieval got lucky.

**Why it mattered.** Selecting a manual used to silently opt a technician into
document-only answers (`NotebookScreen.tsx:341` + `chunks.length===0 && !general`),
so a notebook holding a Siemens manual could not answer a hydraulics question at
all. Server-authoritative fix ⇒ **no new APK needed**.

**Two gates, both human:**
1. `legacy-ui-exception` label on #3959 — maintainer-only by design; the PR body
   already carries the full exception section.
2. Independent review lane — **Codex is out of usage until Sep 26 04:17**, and the
   Claude-reviews-Claude carve-out expired 2026-09-13 and does not roll over.
   `tools/gate7_review.py` ran instead (3 rounds + adjudication, all in
   `docs/proofs/`). Mike chooses: accept Gate 7, or wait for Codex.

**The find that justified the review lane:**
`tools/qa/retrieval_acceptance.py` pinned `system_prompt_kind` to
`("grounded","machine")`. Under the contract a normal turn carrying chunks reports
`augmented` — **the live staging acceptance loop would have failed on its first
turn after the flag went on, while nothing was wrong.** Fixed in `65738d699`.

**Traps recorded for next time:**
- `vitest` does not typecheck. 3325 green tests sat on a build that could not
  compile; `npm run build` caught it, and the failure surfaced as Hub E2E + beta
  gate going red, which looks exactly like a logic regression.
- `matchSafetyStop("…E-12 fault while the machine is energized")` is **null** —
  that phrase is caught by the *output-side* semantic judge, not the input gate.
  Don't "fix" the route to match a test that assumed otherwise.
- `MIRA_PERSONA_CONTRACT` was in **neither** compose file. A Doppler `stg` value
  would have been set, reported set, and never reached the container (#3328).

**Spend:** $0.083 of a $1.00 bound, 232 paid calls, hand-graded. Raw-model
baseline fabricated 9/9 unsupported specifics; the contract now 0/9.
