# Fleet Standard (the provider-neutral operating model)

Every FactoryLM node and every coding agent — Claude, Codex, or a future provider — runs
under one repository-defined operating model: `docs/agent-standard/FLEET_STANDARD.md`.
This rule is the Claude adapter's pointer to it. It links; it does not restate.

## Read order for a coding task

1. `docs/agent-standard/FLEET_STANDARD.md` — canonical behavior (boot sequence §4, token rules
   §5, ownership §6, worktree rules §7, verification contract §10, parity checklist §11).
2. `docs/agent-standard/providers/claude.md` — the Claude compliance adapter.
3. `docs/agent-standard/nodes/<node>.md` — the overlay for the machine you are on
   (`charlie.md`, `bravo.md`, `alpha.md`, `travel-laptop.md`, `plc-laptop.md`, `vps.md`).
4. `docs/agent-standard/rollout.md` — only when doing standardization work itself.

## The two rules this adapter adds nothing to

- **Precedence.** When a `.claude/` file and the standard disagree, `FLEET_STANDARD.md` §2
  decides. Report the disagreement as `PROVIDER DRIFT` in your closeout; do not resolve it
  by editing the `.claude/` copy to match, and do not copy the standard's text into `.claude/`
  (§12 anti-drift: link, don't paste).
- **No unique truth here.** `.claude/` is an adapter (§8). Any architectural rule, acceptance
  criterion, deployment policy, or ownership rule that exists *only* under `.claude/` is drift
  to be moved to a provider-neutral home (`AGENTS.md`, `docs/agent-standard/`,
  `docs/architecture/`, `docs/adr/`) — say so in the closeout rather than leaving it private.

## Mechanical check

`tools/fleet-parity-check.sh` verifies, read-only, that the canonical files exist and that the
adapter entry points (`AGENTS.md`, root `CLAUDE.md`, this rule) point at them. It inspects; it
never owns or mutates. Run it in a closeout when the task touched any instruction file.

## When this applies

- Any coding task on any node (§4 boot sequence steps 3–4 name the standard explicitly).
- Any edit to `AGENTS.md`, `CLAUDE.md`, `.claude/**`, or `docs/agent-standard/**`.

## When this does NOT apply

- Nothing here is optional once you are doing a coding task. The standard landed on `main` in
  #3755 (merge `99257d85e`, 2026-09-13) after a three-round independent review; its header still
  reads "Proposed" only because `rollout.md` Phase 1 reserves "canonical" for after cross-provider
  parity is proven — that proof is the parity table in #3761.

## Cross-references

- `docs/agent-standard/FLEET_STANDARD.md` — the standard
- `docs/agent-standard/providers/claude.md` — Claude adapter · `providers/codex.md` — Codex adapter
- `docs/agent-standard/rollout.md` — phased rollout (Phase 2 is the adapter wiring this rule is part of)
- `.claude/rules/multi-session-protocol.md` — claims, isolation, review gate (consistent with §6/§7)
- `.claude/rules/subagent-worktree-isolation.md` — worktree teardown obligations (§7)
- `.claude/rules/codegraph-usage.md` — CodeGraph is the single code-navigation authority (§3)
