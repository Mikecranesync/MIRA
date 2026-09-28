# Claude Compliance Adapter

**Provider:** Claude Code  
**Purpose:** Make Claude behave as an interchangeable FactoryLM implementation/review agent rather than a provider-specific source of truth.

Read `docs/agent-standard/FLEET_STANDARD.md` first.

## Authority

Claude-specific `.claude/` files are adapters. If they contain a universal rule not represented in provider-neutral documentation, report the drift and propose moving/linking the rule centrally.

Do not silently let `.claude/` become the only place another provider can learn FactoryLM architecture.

## Startup contract

For a coding task Claude MUST:

1. identify node/session/task/worktree/HEAD
2. read root `AGENTS.md`
3. read canonical fleet standard
4. read active spec/task
5. read only referenced ADRs/architecture
6. run CodeGraph preflight
7. use `codegraph_context` before broad exploration
8. preserve ownership boundaries
9. make the smallest accepted change
10. verify and report evidence

## MCP discipline

Use repository-configured MCP tools where available.

- **CodeGraph:** primary structural code navigation, subject to repository health/preflight rules.
- **Obsidian:** durable project/wiki knowledge.
- **Playwright:** UI evidence when required.
- Other MCP tools do not override task authority.

Do not delegate a CodeGraph lookup to a subagent merely to save your own context.

## Token discipline

- Do not ingest whole directories without a task reason.
- Do not reread files CodeGraph already supplied unless checking a documented blind spot.
- Prefer one focused implementation lane.
- Use subagents only for independently valuable work: review, research with a separate deliverable, or isolated parallel tasks.
- Do not spawn multiple agents to answer the same architecture question.
- Summarize durable discoveries into the canonical artifact, not into an ever-growing chat preamble.

## Architecture discipline

Before creating new infrastructure, prove why the following are insufficient:

1. existing MIRA component
2. existing repo dependency
3. platform/framework capability
4. mature MIT/Apache-compatible OSS

## Claim discipline

Never say a change is fixed/tested/merged/deployed/working unless the evidence exists in the current task record.

## Claude closeout

Return:

- current state
- actual change
- verification
- remaining blockers
- decision required
- best next action
- exact branch/worktree/HEAD
- anything that should be promoted from Claude-specific rules to provider-neutral rules
