# MIRA — Agent Authority Resolver

**Status:** Canonical repository instruction entry point
**Scope:** Every human or autonomous worker acting in this repository

This file resolves authority. It is deliberately short; durable product truth and protected
engineering rules live in the two documents linked below.

## Read first

1. [Product Constitution](docs/PRODUCT_CONSTITUTION.md) — what FactoryLM/MIRA is and which product
   direction wins.
2. [Engineering Guardrails](docs/ENGINEERING_GUARDRAILS.md) — safety, evidence, tenant, git,
   secrets, environment, licensing, review, merge, and deployment rules.
3. Accepted ADRs and contracts relevant to the touched surface.
4. The nearest module `AGENTS.md` for local commands and constraints.

`CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/`, skills, commands, role cards, plans, PRDs,
wiki entries, and imported host/cluster instructions are subordinate to this stack. They may add
local detail but may not redefine the product or weaken the guardrails.

## Conflict resolution

- Direct human instructions control the assigned scope, but do not silently waive safety, legal,
  tenant, evidence-integrity, secret, production, destructive-action, or human-approval gates.
- The Engineering Guardrails veto less-protective instructions in any other repository file.
- The Product Constitution controls product intent, surface priority, and product boundaries.
- Accepted ADRs and contracts control their bounded implementation detail only when consistent
  with the Constitution and Guardrails.
- The current tree, tests, git history, deployed evidence, and runtime configuration establish what
  actually exists. Documentation alone is not runtime proof.
- A closer module instruction may narrow work; it may not broaden authority or override a parent
  safety, product, tenant, git, review, merge, or deployment rule.
- Proposed/draft ADRs, dated plans, handoffs, wiki notes, and historical docs are evidence, not
  standing authority. Status outranks recency; an explicit supersession outranks implication.
- If a conflict remains unresolved, stop and report it. Do not choose whichever instruction makes
  implementation easiest.

## Current product direction

FactoryLM is one cohesive technician product across mobile and web. MIRA is its shared,
server-governed intelligence and evidence system. Universal Technician L0 works without a selected
asset or attached manual; confirmed identity is required before asset-specific, historical, or
live claims. Slack/Foreman is the internal orchestration command center, not the primary customer
product. The Product Constitution is the complete authority for these decisions.

## Mandatory Repo Archaeologist gate

Before implementation planning or code edits, investigate what already exists. Authority-only
documentation changes, migrations, refactors, and presumed “missing” capabilities require the same
gate.

1. Reconcile the checkout with current `origin/main`; inspect status and recent commits.
2. Search the current tree, symbols, tests, registries, open and recently closed PRs, branches, and
   relevant history. Search both MIRA and FactoryLM when ownership crosses repositories.
3. Check active work claims and overlapping file ownership before choosing a slice.
4. Map the canonical owner, callers, consumers, contracts, data, and rollback/migration constraints.
5. Return one evidence-backed verdict:
   `REUSE`, `CONNECT`, `FINISH`, `CONSOLIDATE`, `REPAIR`, `REVIVE`, or `BUILD`.
6. `BUILD` is permitted only after the search establishes that no suitable canonical or in-flight
   implementation exists. Prefer, in order: reuse, connect, repair, finish, or consolidate.

The archaeology phase is read-only. It does not authorize implementation, deletion, merge,
deployment, spending, messaging, or infrastructure changes. Reuse the existing
[Repo Archaeologist](mira-bots/foreman/specialists/repo-archaeologist.md) role; do not create
another archaeology framework.

## Working discipline

- Start from current `origin/main` on a scoped `codex/` branch or an isolated worktree. Never write
  new work on a stale base merely because the checkout opened there.
- Preserve unrelated and foreign work. Use one writer per file, scoped staging, and no destructive
  cleanup or stash manipulation.
- Keep one logical change per PR. Use Conventional Commit/PR titles and report exact verification.
- Review is independent and read-only against an exact SHA. Any HEAD change invalidates the prior
  verdict.
- Never merge or deploy without explicit human authorization. A request to implement or open a PR
  is not merge or deployment authorization.
- Do not infer permission for runtime, provider, secret, infrastructure, database, production, or
  equipment changes from a documentation task.

## Local instruction maintenance

- Put durable product decisions only in the Product Constitution.
- Put protected engineering semantics only in the Engineering Guardrails.
- Keep module instructions local and mechanical; link upward instead of copying policy.
- Give volatile state an owner, source SHA, verification date, and expiry. Do not put volatile
  provider order, deployment state, version, test counts, branch status, or node topology here.
- Historical documents remain useful evidence but must carry a supersession note when they still
  look active and conflict with this stack.
