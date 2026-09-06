# FactoryLM Unified UI Cutover

**New product presentation work goes into the shared FactoryLM shell.** The
public, Hub, and mobile presentation trees are a **feature-frozen legacy**
rollback path, not a rewrite target. This is a presentation freeze, not a
shutdown — backend capabilities (auth, billing, Equipment Notebook
persistence, typed SSE, evidence, safety, identity, provider routing,
authorization) stay owned by `mira-web`/`mira-hub`/`mira-mobile` and are
reused as adapter inputs, never rebuilt.

Full doctrine, gates, ownership lanes, and the work-claim contract:
**`docs/architecture/convergence/UNIFIED_UI_CUTOVER.md`** (charter, APPROVED).
Governance implementation plan:
`docs/superpowers/plans/2026-09-06-factorylm-unified-ui-cutover-governance.md`.
Mission coordination: [Mikecranesync/MIRA#3626](https://github.com/Mikecranesync/MIRA/issues/3626).

## Where new UI work goes

- **Canonical shared UI:** `packages/factorylm-theme/**`,
  `packages/factorylm-interaction/**`, `packages/factorylm-ui/**`,
  `apps/factorylm-ui-lab/**`. One writer at a time — see the charter's
  ownership lanes (§5.2) before editing.
- **Bounded platform adapters** live OUTSIDE the guarded legacy trees, under
  `mira-web/src/factorylm-ui/**`, `mira-hub/src/factorylm-ui/**`, or
  `mira-mobile/src/factorylm-ui/**`. Mounting an adapter in an existing
  guarded route is an audited exception; a new sibling legacy route or
  component is not.
- Capability record: `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`
  → `unified_ui_shell`. Do not create a second capability registry.

## The guarded legacy paths (frozen — see `REGISTRY.yaml` for the live list)

| Surface | Guarded paths |
|---|---|
| Public | `mira-web/src/views/**`, `mira-web/public/**` (classified — see below) |
| Hub | `mira-hub/src/app/(hub)/**`, `mira-hub/src/components/layout/**`, `mira-hub/src/components/equipment/**` |
| Mobile | `mira-mobile/src/App.tsx`, `mira-mobile/src/nav.ts`, `mira-mobile/src/screens/**` |

These entries are machine-readable in `docs/architecture/convergence/REGISTRY.yaml`
(`mira-web-legacy-ui`, `mira-hub-legacy-ui`, `mira-mobile-legacy-ui`) with
`status: LEGACY`, `change_policy: exception_only`, `deletion_safe: false`.
Enforced by `tools/ui_surface_lifecycle_guard.py` via the
`Legacy UI Lifecycle Guard` required check on `main`
(`.github/workflows/ui-lifecycle-guard.yml`). Addition, modification,
deletion, rename-in, and rename-out of a guarded path fail CI by default.

**`mira-web/public/**` is classified, not blanket-guarded** (code-owned in
the guard, not the registry — same reasoning as `CONTROL_PATTERNS` below):
passive asset suffixes (`.png .jpg .jpeg .webp .gif .avif .ico .woff .woff2
.ttf .otf .pdf .map .json .txt`) are unguarded; exactly `mira-web/public/sw.js`
and `mira-web/public/posthog-init.js` are exempt infrastructure; everything
else (html/css/js/mjs/svg, unknown suffixes, extensionless names) is guarded.
A new static file dropped in `mira-web/public/` is a new presentation surface,
not an inert asset, by default.

## The exception policy

A maintainer applies the `legacy-ui-exception` label ONLY for a security/
severity-0/1 repair, rollback-path correctness, parity work that cannot yet
live in an adapter, the controlled adapter mount/cutover itself, or a repair
of the lifecycle guard's own trusted control plane. The PR body must contain
a substantive `## Legacy UI exception` section with `Reason:`,
`Canonical replacement impact:`, and `Rollback:` — see the charter §3 for the
exact format and what the guard rejects (blank values, `N/A`, placeholders,
fenced code blocks, HTML comments).

## Do not

- ❌ Add a feature to a guarded legacy presentation path without the audited
  exception.
- ❌ Create a second chat store, stream parser, safety system, evidence
  system, provider router, asset identity system, or capability registry —
  reuse the seams in charter §2.3.
- ❌ Claim `unified_ui_shell` is connected, staging-enabled, or
  production-enabled before the Golden Conversation gate (charter §8, Gate 3)
  passes on a real adapter.
- ❌ Edit `packages/factorylm-*` or `apps/factorylm-ui-lab` in parallel with
  another active writer — check `[WORK-CLAIM]` records on issue #3626 first
  (`.claude/rules/multi-session-protocol.md`).

## Cross-references

- `docs/architecture/convergence/UNIFIED_UI_CUTOVER.md` — the charter (full doctrine)
- `docs/architecture/convergence/REGISTRY.yaml` — machine-readable guarded paths
- `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml` — `unified_ui_shell` record
- `.claude/rules/multi-session-protocol.md` — claim contract, isolation, adversarial gate
- `.claude/rules/subagent-worktree-isolation.md` — worktree isolation for dispatched writers
- `tools/ui_surface_lifecycle_guard.py` + `.github/workflows/ui-lifecycle-guard.yml` — the enforcement
