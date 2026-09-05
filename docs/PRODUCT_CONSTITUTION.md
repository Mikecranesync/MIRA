# FactoryLM/MIRA Product Constitution

**Status:** Canonical durable product authority

**Approved direction:** CODEX-CONFIG-001, 2026-09-05

**Scope:** Product identity, customer surfaces, shared intelligence, context, and product boundaries

This document answers what product FactoryLM/MIRA is building. It supersedes conflicting product
direction in older plans, PRDs, skills, role cards, module notes, and operational doctrine. It does
not claim that a target behavior is already implemented or deployed.

## 1. One FactoryLM product

FactoryLM is one cohesive maintenance-technician product across mobile and web. The installed app
and the web/Hub experience are two device-appropriate presentations of the same product, not
separate products and not separate MIRA implementations.

MIRA is the intelligence inside FactoryLM. It helps a technician ask a question, add a photo or
manual, understand evidence, continue an investigation, and retain the result with the work.
FactoryLM owns the product and customer relationship; MIRA supplies the shared conversational,
reasoning, evidence, and safety behavior.

The shared Notebook/conversation is the technician's conversational home on both surfaces. A
customer-facing label may evolve only if it continues to address the same durable conversations;
it must not create a parallel Chat product or store.

## 2. Mobile/web parity

Mobile and web should relate as ChatGPT mobile and web do: interaction and layout adapt to the
device, while the user's durable product remains the same.

They share:

- account, organization, tenant, identity, permissions, and entitlements;
- conversations, notebooks, turns, titles, context, history, and resumability;
- documents, attachments, citations, evidence, assets, work orders, and saved findings;
- the same server-governed MIRA intelligence, tools, safety rules, and refusal behavior; and
- canonical identifiers and persistence contracts.

A phone may use a drawer, native camera, compact composer, or buffered progress while web uses a
sidebar, file picker, wider evidence viewer, or true streaming controls. Such differences must be
honest device adaptations. They must not fork prompts, reasoning, evidence policy, tenant policy,
conversation ownership, safety behavior, or business logic. If a platform cannot expose a shared
capability yet, say so and track the gap; do not create a second brain to hide it.

## 3. One server-governed MIRA

MIRA is a shared server-owned intelligence system. Mobile, web/Hub, Slack, and other adapters do
not own independent prompts, provider choices, safety models, evidence models, retrieval truth, or
conversation policy.

The server owns authentication, tenant scope, bounded history, context admission, tool authority,
retrieval, inference routing, citations, safety/refusal behavior, persistence, and response
contracts. Clients render and collect device-appropriate input. Provider keys, direct provider
calls, and authoritative prompts never belong in a customer client.

There must be one canonical conversation seam and one durable conversation record for the customer
product. Existing implementations must be connected and consolidated around that seam; a cleaner
UI is not permission to build another chat backend, inference cascade, safety classifier, evidence
shape, retrieval stack, or conversation store.

## 4. Universal Technician

**A technician who has configured nothing must still receive useful help.** Configuration adds
specificity; it does not unlock the right to ask a question.

### L0 — general maintenance help

L0 works without a selected asset, QR code, UNS path, attached manual, prior history, or live
connection. MIRA may use general electrical, mechanical, controls, and maintenance reasoning; ask
diagnostic questions; explain concepts; and help the user supply useful context.

L0 must be visibly labelled as general reasoning and must never imply that its answer came from the
customer's machine, history, live data, or an OEM document. Normal industrial safety rules still
apply.

### Progressive context

Context enriches the same conversation rather than moving the technician through a mandatory setup
wizard:

1. **L0 — General:** no configured evidence; useful, explicitly general guidance.
2. **L1 — Identified component:** confirmed manufacturer/model or catalog identity; cite an OEM
   source when one is actually available.
3. **L2 — Assembled machine:** tenant-scoped asset relationships, documents, notes, and history.
4. **L3 — Connected machine:** admitted, read-only live observations with identity, quality, and
   freshness.

An identified component may exist before it is assigned to a machine. L2 or L3 must never become a
precondition for L0.

### Identity boundary

Confirmed, tenant-scoped asset identity is required before MIRA makes:

- claims about a particular customer's asset or its configuration;
- claims from that asset's work-order, conversation, or maintenance history;
- claims based on live or recent machine observations; or
- actions that attach or save information to a particular asset.

Identity is not required before a general maintenance question. If an asset-specific request is
ambiguous or unconfirmed, MIRA asks for clarification or clearly falls back to labelled general
guidance. It never guesses the asset or silently binds a turn to one.

## 5. Evidence is visible

One conversation may contain two clearly distinguished evidentiary states:

- **General:** model reasoning without customer/OEM evidence, labelled as such.
- **Grounded:** claims backed by admitted, tenant-authorized evidence with inspectable citations or
  provenance.

Additional evidence types—identified component, OEM documentation, workspace evidence, machine
history, and live machine evidence—refine the grounded state. They are typed inputs to one evidence
model, not separate trust systems. General reasoning may be useful; it must never masquerade as a
citation or machine fact.

## 6. Surface roles

- **FactoryLM mobile:** primary portable customer experience.
- **FactoryLM web/Hub:** the same customer product on a larger surface, including administration,
  knowledge, onboarding, and workflows suited to a browser.
- **Slack/Foreman:** FactoryLM's internal orchestration and engineering command center. It is not
  the primary customer product and does not define the customer conversation contract.
- **Other customer adapters:** retained only as consumers of the same applicable server contracts,
  permissions, evidence, and safety behavior.
- **Ignition/HMI and edge integrations:** contextual or approved deployment surfaces; never an
  alternate product brain and never authority to control equipment.

Cross-channel thread convergence is an implementation decision that must preserve identity,
tenant, history, evidence, and safety semantics. A shortcut that merely forwards text between
independent brains is not convergence.

## 7. Reuse before build

Repo Archaeologist is mandatory before implementation planning or code edits. Search beyond
`main`, including open/closed PRs, branches, history, tests, registries, and both FactoryLM/MIRA
repositories when relevant.

Prefer `REUSE`, `CONNECT`, `FINISH`, `CONSOLIDATE`, `REPAIR`, or `REVIVE` before `BUILD`.
New code is justified only after evidence shows the capability is genuinely absent. Never create a
third implementation to reconcile two existing ones.

## 8. Product boundaries

FactoryLM/MIRA:

- integrates with CMMS, SCADA, HMI, historians, documents, and edge systems; it does not replace
  those systems in this product phase;
- is read-only and advisory toward industrial equipment unless a separately designed, reviewed,
  and explicitly authorized control architecture is approved in the future;
- does not expose infrastructure, provider routing, agent orchestration, or data-model complexity
  as the normal technician workflow;
- does not require a wholesale app rewrite, new app identity, or parallel customer product; and
- does not treat a mock, feature flag, merged PR, or passing unit test as proof of deployed customer
  behavior.

## 9. Supersession

The following older directions are superseded wherever they conflict with this Constitution:

- “Slack is the customer front door” or “Slack-first product”;
- “MIRA may not troubleshoot until an asset is confirmed,” when applied to L0 general help;
- a separate mobile, web, Slack, Open WebUI, pipeline, or provider-specific MIRA brain;
- a second visible generic Chat product beside the shared FactoryLM conversation;
- Drive Commander, Auto-PM, namespace construction, model training, or infrastructure expansion as
  a universal prerequisite to the unified technician product; and
- any plan that requires rebuilding a capability before archaeology establishes the existing owner.

`NORTH_STAR.md` remains useful for enduring company strategy and commercial context.
`docs/specs/mira-technician-app-dogfood-system.md` remains an implementation-rich design source.
`docs/THEORY_OF_OPERATIONS.md` remains historical operational context. None outranks this document
on product direction. Their safety, evidence, tenant, and technical details remain valid only when
consistent with the [Engineering Guardrails](ENGINEERING_GUARDRAILS.md) and accepted contracts.
