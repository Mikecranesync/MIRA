# Autonomous Run Plan — Technician Beta Recovery, Workstream B

**Date:** 2026-08-29
**Branch:** `codex/technician-beta-recovery-b`
**Base:** `origin/main` at `4a695bf311241ec4e2b9d0a269a3630ff7477bcd`
**Operator:** Claude Code, supervised by Codex
**Approved PRD:** `docs/prd/2026-08-29-technician-beta-recovery-prd.md`

## Objective

Deliver **Workstream B only** (PRD §8 / delivery-sequence PR 2): make the staging beta gate exercise the same approved-source behavior production depends on, prove it fails when the Workstream A `verified=false` regression is reintroduced, and add a production-targeted probe that is inert unless Mike explicitly supplies every QA input and dispatches it.

## Required sequence

1. **Preflight and trace the current contract**
   - Read the PRD, repository/module instructions, Workstream A handoff, current beta workflow, provisioning script, upload/readiness/confirmation/chat APIs, and relevant tests before editing.
   - Confirm this clean worktree/branch, hooks, unset production overrides, current `origin/main`, and open-PR file ownership.
   - Preserve open PR #3477's ownership boundary and account for the mechanical `.github/workflows/beta-gate.yml` overlap with Dependabot PR #2251.
   - Record focused failing-before evidence for every new assertion before implementation. Do not weaken an existing gate to make the lane green.

2. **Build one reusable production-equivalent probe**
   - Drive only public Hub application APIs for tenant registration/authentication, node/notebook creation, upload, readiness, source confirmation, grounded chat, and run-owned cleanup.
   - Generate a previously unseen run-unique document and sentinel fact at runtime; do not rely on the shared GS10 corpus or a fixed answer fixture.
   - Before upload, ask for the sentinel in grounded mode and require provider-free `insufficient_evidence`.
   - Wait on the actual upload/index readiness contract; do not use a fixed sleep as proof of readiness.
   - Confirm the uploaded source through the real product contract before asking again.
   - After confirmation, require `answered`, the exact run-owned document identity, correct passage/page identity, non-null provider/model usage, and zero other-tenant citations.
   - Ask a second unsupported grounded question and require provider-free `insufficient_evidence`.
   - Emit redacted machine-readable evidence and timings. Never log credentials, cookies, raw provider payloads, or secrets.

3. **Make staging CI prove the production flag and regression**
   - Start the Hub with `MIRA_ENFORCE_APPROVED_RETRIEVAL=true` explicitly.
   - Print/assert the effective non-secret gate state before exercising the probe.
   - Provision fresh tenant credentials and run-owned records on every run; clean up only those records even after failure.
   - Add a deterministic regression fixture/test that fails if the Workstream A admission fix is locally reverted so confirmed tenant-private chunks with `verified=false` become unreachable under the gate.
   - Upload redacted Hub logs, probe artifacts, and timing evidence on failure.

4. **Add the safe post-deploy entry point**
   - Provide a manually dispatched, production-targeted workflow or reusable invocation of the same probe.
   - Default to dry-run/no-op unless every required QA-tenant input is explicitly present.
   - Use only public application APIs. No raw production SQL, database owner connection, production credential discovery, automatic dispatch, or production mutation from this session.
   - State in workflow output/docs that Mike owns dispatch authorization and production credentials.

5. **Close historical-repair scope honestly**
   - Carry forward Workstream A evidence that no backfill is required: confirmed tenant-private sources remain `knowledge_entries.verified=false` and are admitted through server-derived notebook authority.
   - If useful, add only a tenant-scoped, read-only preflight/detection path. Do not add a migration or mutation merely to satisfy the old “backfill” label.

6. **Verify and hand off**
   - Run focused Python/TypeScript unit tests, beta harness tests, workflow/YAML checks, relevant Hub route/retrieval regressions, type checks, lint/security checks, and any disposable local integration test needed for the regression proof.
   - Review the final diff for tenant widening, provider calls on refusal paths, secrets, production endpoints/SQL, out-of-scope files, and unsafe cleanup.
   - Replace `HANDOFF.md` with Workstream B root-cause/design, changed files, red/green evidence, dry-run semantics, remaining human gate, collision notes, and exact verification commands.
   - Commit in coherent conventional commits, push, and open a merge-ready PR. Do not merge or deploy it.

## Explicitly out of scope

- Workstreams C, D, and E (technician chat contract, mobile Camera/share UX, retrieval-quality program)
- Any production probe dispatch, production deploy, merge, release, production credential/Doppler access, raw production SQL, or direct VPS/hardware action
- Any data backfill/migration unless new local/staging evidence disproves Workstream A's no-rewrite result and the session stops for a new decision
- `mira-hub/src/lib/equipment-notebooks.ts`, its domain tests, mobile files, or other files substantively owned by open PR #3477
- Authentication redesign, global verification of private chunks, new trust classes, cross-tenant widening, or hidden fallback behavior
- Refactors or UI changes not required to make the beta proof production-equivalent

## Hard stops

- The real confirmation/readiness/product contract cannot be exercised without editing PR #3477-owned implementation or changing a product/security decision not settled in the PRD.
- The probe would need raw production database access, production secrets in repository/workflow output, unbounded cleanup, or provider use on an insufficient-evidence path.
- The staging gate cannot distinguish the run-owned sentinel/document from shared-corpus or another-tenant evidence.
- Repository/hooks state cannot be made safe, or unrelated failures prevent credible red/green evidence after focused isolation.

## Success criteria

- Staging explicitly proves `MIRA_ENFORCE_APPROVED_RETRIEVAL=true` is effective.
- A fresh, run-unique source refuses before upload, becomes answerable only after real readiness plus confirmation, cites the exact document/passage/page, records provider/model use, and cannot cite another tenant.
- Unsupported grounded questions refuse without a provider call.
- The same beta lane fails under a deliberate local reintroduction of the Workstream A `verified=false` defect and passes with the merged fix.
- Cleanup is run-owned and evidence/log artifacts are redacted.
- The production-targeted entry point is dry-run/no-op by default and uses public APIs only; Mike remains the human dispatch/credential gate.
- No historical rewrite, trust widening, secret, production mutation, or out-of-scope feature is introduced.
- `HANDOFF.md`, conventional commits, pushed branch, and a merge-ready unmerged PR exist.

## Operator notes

- Keep Claude's shell cwd at the worktree root; use subshells such as `(cd mira-hub && ...)` so repository hooks resolve correctly.
- Keep `MIRA_ALLOW_PROD` and `MIRA_SKIP_STOP_GATE` unset.
- `brain_search` / `brain_capture` are not callable from Codex in this environment; the repository `wiki/hot.md`, PRD, merged Workstream A handoff, and git/GitHub state are the available continuity sources.
- Do not reinterpret “next phase” as authority to merge, deploy, or start Workstreams C–E.
