# Review + release decision log — MIRA Intelligence Contract

**PR:** [#3959](https://github.com/Mikecranesync/MIRA/pull/3959) · **Branch:** `feat/mira-intelligence-contract`
**R0 rollback:** `c2c8e44cb` · **base main:** `ebde0ccf5`

## Why this file exists

The overnight run was authorized to merge and deploy to **staging** *after*
independent exact-head review and required CI. Two gates could not be cleared
autonomously. This records exactly what was tried, what it produced, and what
remains for a human — so the decision is made on evidence rather than on a
summary.

---

## Gate A — independent exact-head review

### Codex (the protocol's named reviewer) — UNAVAILABLE

`scripts/adversarial-review.sh` is the committed lane and was run three times.

| attempt | result |
|---|---|
| 1 | tooling error — `timeout` is not a macOS binary; the script never ran |
| 2 | `401 Unauthorized` — isolated `CODEX_HOME` had no credentials |
| 3 | `LOST RESERVATION RACE` — attempt 2's crashed reservation owns that head |
| 4 (new head) | **`You've hit your usage limit … try again at Sep 26th, 2026 4:17 AM`** |

The script refused to emit a verdict each time: *"A tooling failure is NOT a
GREEN gate."* That is correct behaviour and was not worked around.

`.claude/rules/multi-session-protocol.md` carried a time-boxed
Claude-reviews-Claude carve-out for exactly this situation. **It expired
2026-09-13** and says plainly that it does not roll over — the expiry is
re-decided by a human. So no substitute was self-appointed.

### Gate 7 free-cascade lane — RAN, three rounds

`tools/gate7_review.py` is a committed, owner-decided independent lane
(2026-08-16: **no OpenAI**; runs on Groq → Cerebras → Together). It is
independent in the sense that matters here — different vendor, different model,
fresh context, adversarial brief — and honest about its limits: *"a PASS is
evidence, not proof,"* and it did not run the tests.

| round | scope | verdict | value |
|---|---|---|---|
| 1 | full PR diff | BLOCK | **truncated: 40,000 of 345,292 chars.** Both `[high]` findings were artifacts — it never saw the route or the tests, as its own NOT REVIEWED section admits |
| 2 | `mira-hub/src`, cap 120k | BLOCK | **78,759 / 78,759 — untruncated.** Four findings; one of them real and important |
| 3 | same + rebuttal | see `2026-09-22-gate7-final.md` | adjudication |

Round-2 reports are preserved verbatim in `2026-09-22-gate7-round1-truncated.md`
and `2026-09-22-gate7-round2-full-diff.md`; the rebuttal is
`2026-09-22-gate7-rebuttal.md`.

### The finding that justified the whole exercise

> `tools/qa/retrieval_acceptance.py:280` asserted
> `system_prompt_kind in ("grounded", "machine")`.

Under the contract a normal turn carrying retrieved chunks reports `augmented`.
**The live staging retrieval acceptance loop — the exact thing this work exists
to prove — would have failed on its first turn after the flag went on, while
nothing was actually wrong.** Cross-component, invisible to 3325 green unit
tests. Fixed, with the reasoning recorded at the call site.

Two `[high]` findings did not survive checking, refuted against primary sources:
`evidence_packet` is JSONB (migration 090) with **no CHECK constraint on `mode`
or `system_prompt_kind` in any migration**, and the "stale allowlist" claim is
contradicted by the retained flag-off constants and a passing guard.

---

## Gate B — Legacy UI Lifecycle Guard

Fails, and **cannot be cleared by an agent by design**: it requires a maintainer
to apply the `legacy-ui-exception` label.

- It is **not** one of `main`'s six required contexts (`staging-gate`,
  `Hub E2E`, `mira-web pack tests`, `CI Gate`, `hold-gate`,
  `Shared UI contract (bun 1.4.0)`), which matches the charter's own statement
  that the guard is currently advisory rather than independently merge-blocking.
- The change **cannot avoid** guarded paths: the notebook chat route lives under
  `mira-hub/src/app/api/**`. There is no restructuring that fixes this.
- The PR body now carries a complete `## Legacy UI exception` section
  (Reason / Canonical replacement impact / Rollback) so the label is a single
  maintainer action.

---

## What was NOT done, and why

| Not done | Why |
|---|---|
| Merge to `main` | Conditioned on independent exact-head review; Codex unavailable until Sep 26 and its substitute needs a human decision |
| Deploy to staging | Follows the merge |
| Enable `MIRA_PERSONA_CONTRACT=1` on staging | Follows the deploy |
| Live staging acceptance loop | Requires the deploy |
| Phone / emulator evidence | Requires staging to be serving the contract |
| Production anything | Out of scope by instruction. Flag remains `0` in `docker-compose.saas.yml` |

**No gate was bypassed and no verdict was substituted.**

---

## The decision Mike actually has to make

Codex returns **Sep 26**. Either:

**(a) Accept the Gate 7 lane as the independent review for this PR.** It is
repo-committed, owner-decided, a different vendor and model from the
implementing agent, it read the complete Hub diff untruncated, and it caught a
real cross-component defect that would otherwise have broken the staging
acceptance loop. Apply the `legacy-ui-exception` label, and the merge + staging
deploy + flag-on can proceed.

**(b) Wait for Codex on Sep 26** and run `scripts/adversarial-review.sh 3959`
against the then-current head.

Option (a) is not a bypass — it is choosing between two committed review lanes,
which is a human call under the expired carve-out, not an agent one.
