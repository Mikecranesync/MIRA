# Commodity Before Custom (mobile/web infrastructure)

MIRA owns industrial intelligence — evidence grounding, citations, provenance, technician
workflows. MIRA does **not** own the mechanics of pinch-to-zoom, lightboxes, file opening,
PDF viewing, modal focus handling, or hardware-BACK routing. Standard software infrastructure
stays standard.

Source PRD: `docs/prd/2026-08-26-commodity-first-mobile-prd.md`. Audit + approved primitives:
`docs/architecture/mobile-commodity-convergence.md`. Trigger incident: #3427/#3429, where a
custom pointer-event gesture engine required a multi-session debugging arc to make a Close
button work — commodity behavior every mature viewer already ships.

## Hard rule

Before implementing ANY commodity UI/infrastructure behavior (gestures, viewers, pickers,
modals, BACK handling, file opening, upload progress, accessibility primitives), answer in
order:

1. Is this a standard OS/platform behavior?
2. Does Capacitor already expose it?
3. Does a mature maintained library solve it?
4. Does MIRA already have an approved abstraction (check the audit doc's table)?
5. Only then: why would custom code be superior?

If 1–4 identify an adequate solution, use it. Preference order:
**Platform → Approved mature library → Existing MIRA abstraction → Custom.**

## Custom-code escalation

Writing ~50+ lines of custom interaction/infrastructure logic for a commodity behavior is a
STOP sign, not a line-count gate. The PR or design note must state: alternatives evaluated,
why rejected, maintenance impact, accessibility impact, platform compatibility, test burden,
expected longevity. An agent that finds itself hand-rolling pointer bookkeeping, slop
thresholds, or a modal stack must surface the escalation instead of silently shipping it.

## Agent-specific failure mode this rule exists to stop

Agents receive narrow prompts ("the close button doesn't respond", "add pinch-to-zoom") and
naturally repair the implementation in front of them. A local fix to architecture that should
be replaced is a rule violation *unless* the PR names the architecture question and defers it
explicitly (as #3429 did via this PRD). Ask first: **"Should MIRA own this implementation at
all?"**

## Library selection discipline

A dependency is evaluated for: active maintenance, React 18 compatibility, Capacitor/WebView
(Android) behavior, iOS viability, accessibility, touch support, bundle impact, license
(Apache-2.0/MIT ONLY — PRD §4 root CLAUDE.md), TypeScript support, testability, API
stability, adoption, dependency-chain risk. Smaller-custom is not automatically better than a
maintained dependency; popular is not automatically acceptable.

## What stays MIRA-owned (never delegate to a library)

Evidence meaning and relationships: nameplate→evidence linkage, OCR derivation provenance,
citation→canonical-original resolution, source trust state, refusal behavior, UNS/asset
context. Domain logic wraps commodity primitives — never the reverse.

## When this applies

- Any change under `mira-mobile/`, any new front-end interaction surface in `mira-hub`/
  `mira-web`, any PR adding gesture/pointer/modal/viewer/file-opening code.

## When this does NOT apply

- MIRA domain behavior (§ above), server-side logic, one-line fixes to existing approved
  abstractions, and the explicitly justified custom items listed in the audit doc's table
  (e.g. the authenticated SSE client, the WebView resume guard) — those carry their
  justification in place.

## Cross-references

- `docs/prd/2026-08-26-commodity-first-mobile-prd.md` — the governing PRD (principle,
  contracts, acceptance tests)
- `docs/architecture/mobile-commodity-convergence.md` — the audit table = the live registry
  of approved primitives and their classifications
- `.claude/rules/karpathy-principles.md` — simplicity-first (this rule is its
  infrastructure-boundary corollary)
- `.claude/rules/ui-style.md` — visual system (orthogonal: tokens govern look; this governs
  who owns mechanics)
