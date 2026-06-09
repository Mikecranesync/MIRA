# Train Before Deploy

MIRA's product direction. Two surfaces, two jobs — do not blur them.

- **FactoryLM Command Center** (`mira-hub`, `app.factorylm.com`) is the **onboarding + training**
  system: build the namespace, upload documentation, train and **validate** asset-specific MIRA
  agents, and **approve** them.
- **Ignition / HMI "Ask MIRA"** (`mira-pipeline/ignition_chat.py`, Perspective panels, QR
  deep-links) is a **deployment surface for approved asset agents** — not the primary onboarding
  system. It consumes approved intelligence; it does not create it.

The customer **trains in the Command Center, then deploys to the HMI.** A surface that lets a plant
go live on the floor *before* the namespace is built and the answers are validated is backwards.

## Hard rule — no HMI deployment without a validated asset agent

**No HMI / direct-connection deployment until the asset agent has grounded docs, validation
questions, and approved cited answers.** Concretely, per `docs/specs/asset-agent-validation-spec.md`:

- The asset's `kg_entities` row is `verified`.
- It has citable `knowledge_entries` chunks grounded to its UNS subtree (closing the
  upload→retrieval gap is the precondition — see the beta gate below).
- It has passed validation questions with cited, grounded (≥4/5) answers a human marked **good**.
- An admin/technician recorded an explicit **approval** (`asset_agent_status.state='approved'`,
  with `approved_by`).

Until `asset_agent_status` + the gate ship, this rule is **doctrine**: don't build a "go live on the
HMI" affordance that skips validation. When the gate ships, `ignition_chat.py` enforces it behind
`ENFORCE_ASSET_AGENT_GATE`.

## Read-only first (beta scope)

MIRA is **read-only troubleshooting intelligence first; no control writes in beta.** This is not a
new rule — it restates `NORTH_STAR.md` ("Read-only for OT by default"), the TOO Non-Goals ("Write
to PLCs. Period."), and `.claude/rules/fieldbus-readonly.md`. "Deploy to the HMI" means the agent is
allowed to *answer*, never to *act*.

## Relationship to the beta gate

This rule and the **beta gate** (`.claude/CLAUDE.md` § "Primary product focus: Beta readiness",
`NORTH_STAR.md` § "Path to Beta Testers", `tests/beta/beta_ready_upload_retrieval_citation.py`) are
the same arrow at two scopes:

- **Beta gate** = the *minimum*: a stranger uploads *one* manual and gets *one* cited answer with no
  manual fix. It proves the upload→retrieval path works at all.
- **Train before deploy** = the *general case*: a per-asset `draft → … → approved → deployed`
  lifecycle, validated answers, and an HMI gate that only answers for approved assets.

Closing the upload→retrieval gap (PR #1592) unblocks both. Don't build deployment-surface features
that route around it.

## When this applies

- Any change to `mira-pipeline/ignition_chat.py` or a direct-connection surface in
  `.claude/rules/direct-connection-uns-certified.md`.
- Any "go live / deploy / activate on the HMI" affordance in `mira-hub`.
- Any feature that would let an asset answer on a deployment surface before it's validated.

## When this does NOT apply

- Educational/general questions on any surface (no asset, no gate).
- The Command Center training/validation surfaces themselves — that's where the work happens.

## Cross-references

- `docs/specs/asset-agent-validation-spec.md` — the lifecycle + deployment gate (DRAFT)
- `docs/THEORY_OF_OPERATIONS.md` — Invariants 4/6/7
- `.claude/rules/direct-connection-uns-certified.md` — the surfaces the gate applies to
- `.claude/rules/uns-confirmation-gate.md` — the chat-gate (orthogonal: UNS *where*, this rule *ready*)
- `docs/plans/2026-06-07-path-to-beta.md` — the beta gate (the minimum case)
