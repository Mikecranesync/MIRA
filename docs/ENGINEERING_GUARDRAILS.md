# FactoryLM/MIRA Engineering Guardrails

**Status:** Canonical protected engineering authority

**Approved direction:** CODEX-CONFIG-001, 2026-09-05

**Scope:** Safety, evidence, tenants, git/worktrees, secrets/environments, licensing, review, merge,
and deployment

These rules consolidate the strongest existing protections. They take precedence over conflicting
instructions in module files, `.claude/rules/`, skills, commands, role cards, Paperclip profiles,
plans, runbooks, or historical documents. A local instruction may be more restrictive; it may not
weaken this file.

Changing these rules requires an explicit, scoped, human-reviewed guardrail change. A feature,
documentation, cleanup, incident, “autonomous,” or “finish” request does not implicitly waive them.

## 1. Industrial safety and equipment boundary

- MIRA is advisory and read-only toward customer or production equipment. It must not start, stop,
  reset, jog, acknowledge, force, bypass, tune, or write to a PLC, robot, VFD, safety controller,
  or other machine-control surface.
- A phone, browser, cloud service, or general chat path must never connect directly to a fieldbus.
  Live evidence travels through the approved read-only edge/publisher and server admission path.
- Never recommend defeating guards, interlocks, lockout/tagout, protective devices, or qualified-
  personnel requirements. Arc flash, unexpected motion, stored energy, fire, shock, pressure,
  chemical, and equivalent hazards receive stop-first treatment.
- Telemetry cannot prove a machine safe. State uncertainty, required verification, and appropriate
  escalation. Do not turn a likely diagnosis into an instruction to act unsafely.
- Asset-specific or live claims require confirmed tenant-scoped identity. Live observations also
  require admitted source identity, timestamp/freshness, quality, ordering/replay protection, and
  an honest stale/unavailable state.
- Simulator, bench, or expressly approved local test operations must be proven non-production and
  remain within their written authorization. A legacy write example is never authorization for
  customer-equipment writes.
- Future control capability requires a separate architecture, threat/safety review, explicit human
  approval, and fail-safe proof. No current document grants that authority.

## 2. Evidence, provenance, and answer integrity

- Every answer exposes its evidence basis. General reasoning is labelled general; grounded claims
  cite or identify admitted evidence. Never fabricate a citation or imply customer/OEM/live support
  that was not used.
- Preserve one typed evidence shape across server and clients. Renderers may differ; meaning,
  source identity, timestamps, refusal state, and safety markers may not.
- A model output, extraction, proposed entity, relationship, diagnosis, or summary is a candidate,
  not verified truth. Promotion requires the applicable deterministic checks and human or approved
  system authority.
- Derived/materialized evidence must resolve deterministically to one canonical original and retain
  provenance, transformation identity/version, content hash where applicable, and tenant/source
  scope. Reprocessing is idempotent.
- Retrieval and citations fail closed when provenance, authorization, identity, or source content
  cannot be established. “No evidence” is a valid result and must not be hidden by model prose.
- Maintain one canonical ingest contract and persistence path. A transport or adapter must not add
  a rival normalizer, allowlist, evidence store, or batch path.
- Safety notices and evidence identity survive persistence and cross-device rendering. Do not strip
  them from history to make a UI simpler.

## 3. Tenant, identity, and authorization

- The server—not a client-provided label—derives the authenticated user, tenant, roles,
  capabilities, Notebook/document scope, and asset scope. Treat all client identifiers as requests
  to validate, never as authority.
- Default deny. Cross-tenant, missing-tenant, ambiguous-capability, and inconsistent-source states
  fail closed without leaking existence, metadata, snippets, timing-sensitive detail, or content.
- Hybrid `knowledge_entries` reads preserve the established visibility law:
  `(is_private = false OR tenant_id = $caller)`. Owner/admin database access does not waive this
  application predicate.
- Tenant-private writes set the caller's canonical tenant identifier and `is_private = true`.
  Never substitute a remembered slug, display name, legacy test tenant, or hard-coded UUID for the
  current authoritative identity.
- Notebook, document, conversation, asset, work-order, citation, and live-evidence lookups must
  enforce the same tenant boundary at every join and tool call. Narrow source scope; never widen it
  to make retrieval succeed.
- Authorization changes require positive and negative tests, including a second tenant and an
  unauthenticated/underprivileged caller.

## 4. Repo Archaeologist and change selection

- Complete the root `AGENTS.md` Repo Archaeologist gate before implementation planning or code
  edits. Search current code plus branches, PRs, history, tests, registries, and cross-repository
  ownership where relevant.
- State the existing capability, canonical owner, competing implementations, reusable tests, and
  one verdict before selecting work. `BUILD` is the last resort.
- Establish a known-good rollback point before architecture-affecting implementation. Replacement,
  migration, deletion, and production activation are separate milestones.
- Do not use stale docs to prove absence or implementation status. Do not use a code snapshot to
  override approved product intent.

## 5. Git, branches, worktrees, and concurrent work

- Fetch/reconcile `origin/main`, inspect recent commits and open PRs, and check active claims before
  branching or editing. Start from current main unless the human explicitly authorizes a stacked
  dependency.
- Use a scoped branch. Writers dispatched in parallel use isolated worktrees; read-only reviewers
  do not edit the implementation worktree. One writer owns a file at a time.
- Inspect `git status` before staging or any operation that could affect local work. Preserve all
  unrelated changes, untracked files, stashes, worktrees, and commits.
- Stage exact paths. Never use `git add -A` or `git add .` over a shared or dirty checkout.
- Never discard work with `git reset --hard`, `git checkout -- .`, `git restore .`, `git clean`,
  stash drop/clear, force push, or history rewrite without explicit human authorization and an
  exact, verified target. Prefer recoverable operations.
- Use Conventional Commit and PR titles. The repository version is derived from git tags; there is
  no monorepo `/VERSION` file and PRs do not hand-write the frozen `docs/CHANGELOG.md`. A component
  version/tag change is a separate reviewed release action, never a direct push to `main`.
- Keep one logical change per PR. Report exact changed files, base/head SHAs, verification,
  unresolved findings, collision state, and rollback. Do not claim another session's work.
- Opening a PR does not authorize merging it. Never push directly to `main` or merge without
  explicit human approval.

## 6. Independent exact-SHA review

- Required review is independent, read-only, evidence-backed, and bound to the exact commit SHA.
  Reviewer opinion never outranks tests, contracts, runtime evidence, or source.
- Any change to HEAD invalidates the prior verdict. Review the new exact SHA.
- A missing, malformed, interrupted, timed-out, or unavailable reviewer is not GREEN. Report
  PARTIAL or BLOCKED with the exact dependency.
- Use at most three autonomous review/remediation rounds, then escalate unresolved findings to a
  human.
- Compare required PR checks with current `main`. A pre-existing unrelated failure may be reported,
  but merging through any new red check requires human decision. This file never authorizes merge.

## 7. Secrets and environments

- Secrets live in Doppler and never in committed `.env` files, source, prompts, logs, screenshots,
  fixtures, or documentation.
- Use environment-specific configuration: `factorylm/dev` for development, `factorylm/stg` for
  staging, and `factorylm/prd` for production. Never copy or export production values into a dev or
  test shell.
- Do not reveal secret values while checking their presence. Use names and redacted metadata only.
- Development, staging, and production identities, databases, bots, endpoints, and storage remain
  separated. A feature branch must not point at production resources.
- Provider keys and authoritative prompts remain server-side. Do not add a direct model/provider
  call to mobile or web. Do not duplicate or change the canonical provider cascade, paid-service
  authorization, or exception policy without an explicit scoped mission and current-source audit.
- Cloud services and inference providers are allowlisted, not open-ended. This document neither
  adds nor removes a provider: verify the current allowlist from accepted security decisions and
  runtime configuration before acting. The governed Together paid-training exception authorizes
  only its documented spend/workstream and cannot be used as authority for unrelated new usage.

## 8. Database, infrastructure, and deployment

- Promote dev → staging → production. Engine, retrieval/RAG, classifier, evidence, tenant, and
  inference changes must pass their relevant deterministic tests and the staging gate before
  production consideration.
- Never run raw SQL or ad-hoc schema changes against production. Migrations move dev → staging →
  production through the approved dry-run/apply workflow and include rollback/forward-repair
  evidence.
- Never restart, rebuild, or run Compose directly against production/VPS services from a coding
  session. Use the approved deployment workflow and verify the deployed SHA and health afterward.
- Never point a feature branch at a production bot, customer adapter, tenant, or equipment source.
- Production deployment, migration apply, feature enablement, customer messaging, data deletion,
  paid spend, physical-device publication, and equipment interaction require explicit human
  authorization for that action. Approval to write code, commit, or open a PR is insufficient.
- Never weaken CI, tests, safety gates, tenant gates, or hooks to make a change pass. Hotfixes retain
  an auditable PR and follow-up path.

## 9. Licensing and dependency boundaries

- Code and dependencies incorporated into MIRA must be Apache-2.0 or MIT. This document grants no
  license exception. Do not copy copyleft code into MIRA.
- An existing, separately deployed copyleft service may remain only as an explicitly documented
  integration boundary with its license obligations preserved; its presence does not permit source
  copying or linking that changes MIRA's licensing posture.
- Do not introduce LangChain, TensorFlow, n8n, or a framework that hides/abstracts the canonical
  LLM/provider call. Reuse the existing server inference seam.
- New dependencies require archaeology, license verification, maintenance/security review, and a
  demonstrated need. Prefer platform capability, mature compatible libraries, and existing MIRA
  abstractions before custom code.
- Service containers use pinned image versions, a healthcheck, and `restart: unless-stopped` unless
  an accepted architecture decision states a stricter requirement.

## 10. Legacy-instruction handling

Historical instructions remain useful as evidence, but they cannot authorize unsafe action. In
particular, any older instruction that says to use production secrets for development, run direct
production Compose/SQL, push or merge `main`, stage the whole tree, discard a stash/worktree, bump
`/VERSION`, hand-edit the monorepo changelog, or skip exact-SHA review is superseded by this file.

Product-direction conflicts—including Slack-first customer framing and asset confirmation before
all general help—are resolved by the [Product Constitution](PRODUCT_CONSTITUTION.md).
