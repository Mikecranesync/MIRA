# Industrial AI Agent Patterns

> How AI-native industrial vendors compose LLM agents, skills, MCP tools, and guardrails. Primary source: Fuuz (deep-dive 2026-05-20). Secondary sources: HighByte (MCP services in development), ThredCloud (KG + AI), MaintainX (CoPilot). Each pattern is cited; MIRA applicability called out.

---

## A-1 — Skills as captured corrections, not specs

**What:** Every "no, do it this way" from a domain expert becomes a numbered rule in a SKILL.md. Skill content is *retrospective* — assembled from real interactions, not designed up-front. Fuuz's `fuuz-packages` skill has 71 golden rules; each one prevents a specific past failure.

**Why it works:**
- Rules are testable (the failure they prevent is concrete).
- Domain expertise compounds — every new correction adds permanent value.
- The skill files are *organizational memory*, not a manual.

**Examples (from Fuuz):**
- "NEVER hallucinate screens, dataFlows, dataMappings — always leave these as empty arrays" → preventing past hallucinated artifacts.
- "FK field naming: always prefix, never suffix" → preventing past naming inconsistency.
- "Modules and module groups must come from the developer — NEVER invent module IDs" → preventing past wrong-module assignments.

**MIRA applicability:** MIRA's `.claude/rules/uns-compliance.md`, `karpathy-principles.md`, `python-standards.md` already follow this shape. Action items:
1. **Number the rules** (UC-1 through UC-N for uns-compliance, etc.).
2. **Lead with anti-hallucination rules** — they're the highest-value.
3. **Each rule includes the failure it prevents** — not just the rule.
4. **Audit monthly** — kill rules Claude follows naturally (CLAUDE.md already says this).

**Source:** Episode 6 `[14:30]`. `fuuz-skills/fuuz-packages/SKILL.md` — 71 golden rules.

---

## A-2 — Skills direct the assistant to ask, not guess

**What:** Some rules don't tell Claude *what to do*; they tell Claude *what to ask the developer first*. Sample (paraphrased from `fuuz-packages`):

- Rule 16: "Modules and module groups must come from the developer — either (a) ask the developer for the exact IDs of existing modules they want to use, or (b) ask the developer to define new module groups."
- Rule 18: "Ask the developer about lookup/enum seed values."
- Rule 22: "Ask the developer which enum models need `color` and `default` fields."
- Rule 23: "Ask the developer about `deletionReferenceBehavior` preferences."

**Why it works:** Encodes the Karpathy "stop and ask when confused" principle mechanically. The assistant doesn't have to *decide* whether to ask — the skill says when to ask.

**MIRA applicability:** Direct. MIRA's skills currently lean implicit. We should add explicit "ask first" rules for:
- Component-template fields that affect downstream KG promotion (`promotion_state`, `confidence`, `evidence_source`).
- Manual-chunk metadata that affects citation correctness (`page_number`, `section_id`, `image_id`).
- UNS path components when the customer's hierarchy is unclear ("ask: is this asset linked to a cell or directly to a line?").

**Source:** `fuuz-skills/fuuz-packages/SKILL.md` rules 16, 18, 22, 23, 30.

---

## A-3 — Anti-hallucination rules are explicit and first-class

**What:** Skills lead with rules that **prevent** the LLM from inventing artifacts. From Fuuz's package skill:

- "NEVER hallucinate screens, dataFlows, dataMappings, documentDesigns, or savedTransforms — always leave these as empty arrays `[]`."
- "Do NOT include `externalId`, `integrationData`, or `customData` fields unless explicitly requested."
- "Modules and module groups must come from the developer — NEVER invent module IDs."

**Why it works:** The LLM's strongest failure mode is plausible-but-wrong invention. Pre-empt it.

**MIRA applicability:** **Critical.** MIRA's grounded-by-default contract is the same principle one layer up — *don't invent customer plant data, fault codes, work orders, manual references*. Action item: every MIRA skill should have an "Anti-hallucination" section at the top, with explicit rules:

- `component-profile-builder`: "Never invent manufacturer/model strings — only use what the manual / PLC tag map / technician confirmation provides."
- `knowledge-graph-proposer`: "Status `proposed` is the default. Never write `verified` unless human-approved."
- `plc-tag-mapper`: "Never invent tag → component mappings — require either nameplate, manual, or technician confirmation."

(Many of these already exist in MIRA's skill files, but they're scattered — pulling them into a leading "Anti-hallucination" block per skill would tighten the pattern.)

**Source:** `fuuz-skills/fuuz-packages/SKILL.md` rules 11, 15, 16. MIRA root `CLAUDE.md` — "Don't invent plant data."

---

## A-4 — Frame the structure, delegate the heavy lifting

**What:** The human builds the *skeleton* (which nodes are in the flow, in what order). The LLM fills the *body* (write the JavaScript / JSONata / GraphQL inside each node).

**Why it works:**
- LLMs are good at writing code given a precise spec; they're worse at deciding architecture from a vague goal.
- Keeps the human in the loop on cross-cutting decisions.
- Failure modes are local — if a node's JS is wrong, the rest of the flow still makes sense.

**Example (Episode 6, `[26:30]`–`[27:30]`):**
> Craig builds: `dataChanges` node → `setContext` → `query for data point` → `mutexLock` → `query baseline` → `query last 2000 raw` → `[Claude's JS]` → `upsert baseline` → `mutexUnlock`.
> Then asks Claude to write the JS (ISO 22400 work-center state-change generator). Claude writes ~80 lines of valid Fuuz-flavored ES5; Craig pastes into the JS node.

**MIRA applicability:** Direct. When asking Claude to extend MIRA, MIRA's CLAUDE.md spec-first convention already encodes this — *write the plan first, fill in the implementation second*. Specifically for MIRA's bot work:

- For an engine.py change, write the flow as a checklist of state transitions first; then delegate per-state logic.
- For a new ingest pipeline, write the node sequence first (manual → chunker → dedup → KG-proposer); then delegate each function.

**Source:** Episode 6 `[26:30]`.

---

## A-5 — Copy-paste workflow keeps human in the loop; autonomous MCP gated on RBAC

**What:** Today's Fuuz workflow is: Claude generates artifact JSON → human downloads → human imports through UI → human tests in Developer Mode → human deploys. Tomorrow's planned workflow: Fuuz MCP tools with **security and governance** let Claude perform some operations directly.

**Why it works (today):** Copy-paste gives the human a checkpoint at every artifact. No risk of Claude writing to production directly.

**Why MCP is gated:** Craig: "What I am really not sure of yet is just letting Claude make these changes directly for me in Fuse. We will get there. Likely through the MCP tools. We're in the process of building out some extensive library of pre-built MCP tools which will have you know **security and governance on them which is a big issue with MCP in general right now**." `[33:00]`–`[33:30]`.

**MIRA applicability:**
- **Today:** MIRA uses MCP heavily (`mira-mcp` server exposes CMMS tools, KG read, UNS lookup). Read paths are mostly safe.
- **Concern:** Any MCP tool that *writes* (creates a work order, promotes a KG relationship, updates a component template) needs explicit auth + audit + dry-run path before it's exposed.
- **Action item:** Audit `mira-mcp/server.py` for write tools; ensure each one is gated on per-user role + writes to a `proposed` table (not directly to verified).

**Source:** Episode 6 `[33:00]`.

---

## A-6 — Test in a live runtime with full trace, not unit tests alone

**What:** Fuuz's Developer Mode renders a screen + shows every query, transform, binding, action firing live as the user clicks. Breakpoints on flow nodes. The trace IS the test.

**Why:** AI-generated code is correct-looking and subtly wrong. Static review misses behavioral bugs. Live trace catches them in seconds.

**MIRA applicability:** **Direct future investment.** Today MIRA's tests are:
- Offline: `tests/eval/` regimes, deepeval suite (76 offline tests, 39 golden cases).
- Live: `smoke_test.sh` after VPS deploys + ad-hoc Slack tests against `@FactoryLM_Diagnose`.

We don't have the equivalent of Developer Mode — a "show me every step of how MIRA decided this answer" view. Building it for the Hub admin surface is high-leverage. (Tracks with Pattern P-9 from `fuuz-patterns.md`.)

**Source:** Episode 6 `[19:30]`–`[20:30]`.

---

## A-7 — Rube-Goldberg detection rule

**What:** Skills include rules like "Use the platform's existing JSONata binding before writing JavaScript." This counters the LLM's tendency to write 10-line solutions when a 1-call platform binding exists.

**Why:** The LLM doesn't know all 294 of Fuuz's custom JSONata bindings. Rules redirect it: "if you're about to write a date calculation, look at `$moment()` first."

**MIRA applicability:**
- Every MIRA helper, decorator, or shared utility should be **discoverable by the LLM** through a skill or a CLAUDE.md pointer.
- Examples: `mira-bots/shared/uns_resolver.py` (vendor-resolution helpers), `mira-crawler/ingest/dedup.py` (dedup helpers). Both should appear in a "before writing X, check Y" rule.
- Action item: write a `mira-platform-utilities` skill (analogous to Fuuz's `fuuz-platform` skill) — a one-stop reference of the existing helpers Claude should reach for first.

**Source:** Episode 6 `[28:00]`–`[28:30]`. `fuuz-platform/references/jsonata-bindings-complete.md` (~538 lines).

---

## A-8 — Use the LLM to summarize the platform's own artifacts

**What:** Export a `.fuuz` package → feed it to Claude → ask for end-user docs, work instructions, troubleshooting guide. Fuuz reports ~80–85% accuracy without manual intervention.

**Why:** The export format is self-describing enough. The LLM doesn't need to crawl source code; it crawls the artifact.

**MIRA applicability:**
- **Component templates should export to LLM-readable form.** Today they're JSON with KG entity refs + manual citations + work-order summary; the question is whether a downstream LLM can faithfully describe one in plain English from that export.
- **Action item:** write a test that exports a component template and asks Claude (using the Hub's API key) to write a 200-word plain-English description of it. Grade for completeness + accuracy. If <80%, refactor the export format.

**Source:** Episode 6 `[57:00]`.

---

## A-9 — Skill semver + manifest

**What:** Fuuz tracks skills like platform code:

- `SKILLS_VERSION_MANIFEST.md` — central tracker.
- Status enum: `draft` / `review` / `ready` / `deployed` / `deprecated` / `baked-in`.
- Semver per skill (`fuuz-packages` is at 2.1.1).
- "Deployed to" column tracks which Claude project each skill is loaded into.

**Why:** Treats agent behavior as a versioned product. Lets the team coordinate updates, retire skills cleanly, audit which version is in production.

**MIRA applicability:**
- MIRA's `.claude/skills/` directory has 20+ skills but no versioning. Action items:
  1. Add YAML frontmatter `version: 1.0.0` to each `SKILL.md`.
  2. Create `.claude/skills/MANIFEST.md` with the same shape.
  3. Bump versions on substantive edits; bake-in or retire stale skills.

**Source:** `fuuz-skills/SKILLS_VERSION_MANIFEST.md`. Episode 6 `[15:00]`.

---

## A-10 — Consistency rules baked into the skills

**What:** Every Fuuz screen built with the skills has filters on the left, the table in the center, and a three-dots menu column on the right. This isn't a heuristic — it's a rule in the screens skill.

**Why:** AI-generated UIs drift if you don't pin them. Each iteration produces a "complete redo" instead of a true revision. Pinning layout via rule lets Claude *iterate* on a stable foundation.

**MIRA applicability:**
- MIRA's UI surface today = Slack messages. Same principle, different artifact:
  - Lead with suspected UNS context (Site → Asset → Component → Fault).
  - Confirm before troubleshooting.
  - ≤3 cited evidence sources.
  - Action-oriented steps after context is confirmed.
- These rules **already exist** in MIRA's `.claude/skills/slack-technician-ux-writer/SKILL.md`. Action item: numbered, surface them at the top of every reply template.

**Source:** Episode 6 `[48:00]`–`[48:30]`. `fuuz-skills/fuuz-screens` skill: "Consistency."

---

## A-11 — Cross-skill index (router pattern)

**What:** `fuuz-platform/references/cross-skill-index.md` is a router — a small file that maps "the user asked about X → invoke skill Y first, then Z." Helps the LLM choose the right skill from a 7-skill catalog.

**Why:** With many skills, the LLM can pick the wrong one or load too many. An explicit index routes by intent.

**MIRA applicability:**
- MIRA has 20+ skills (component-profile-builder, plc-tag-mapper, knowledge-graph-proposer, slack-technician-ux-writer, uns-location-gate-designer, etc.). Same routing problem applies.
- **Action item:** `.claude/skills/INDEX.md` with a "when the user asks X, use skill Y" table. The current skill descriptions partially cover this, but a single routing index is cleaner.

**Source:** `fuuz-skills/fuuz-platform/references/cross-skill-index.md`.

---

## A-12 — ES5-restricted runtime as a deliberate constraint

**What:** Fuuz's flow JavaScript engine doesn't support `let`, arrow fns, template literals, destructuring, spread, `async/await`, `.toFixed()`. The skill spells this out explicitly with `WRONG / CORRECT` pairs.

**Why (UNCONFIRMED but inferable):** V8 isolate / quickjs-style sandbox; predictable cold-start; small memory footprint per node.

**MIRA applicability:**
- MIRA's worker pool is Python 3.12 (not restricted). Probably not a directly translatable pattern.
- But the principle — **document runtime constraints with WRONG / CORRECT pairs** — applies to any sandboxed AI surface MIRA ships. If MIRA exposes a "custom inference pipeline" knob for customers, the docs should look like the fuuz-ml-telemetry skill's restrictions table.

**Source:** `fuuz-skills/fuuz-ml-telemetry/SKILL.md` — "JavaScript Runtime Limitations (CRITICAL)."

---

## Cross-vendor signal (where Fuuz is not alone)

| Pattern | Fuuz | HighByte | ThredCloud | MaintainX | MIRA today |
|---|---|---|---|---|---|
| Public Claude Code skills | ✅ 7 skills, ~43k lines | UNCONFIRMED | UNCONFIRMED | UNCONFIRMED | ✅ 20+ skills (private) |
| MCP services on roadmap | ✅ catalog in build | ✅ in dev | UNCONFIRMED | UNCONFIRMED | ✅ `mira-mcp` shipping |
| LLM as glue, not core | ✅ explicit | UNCONFIRMED | UNCONFIRMED | CoPilot (more central) | ✅ explicit (engine + KG) |
| UNS confirmation gate | ❌ no equivalent | ❌ | UNCONFIRMED | ❌ | ✅ (uniquely MIRA) |
| Grounded-by-default | ❌ (operator's job) | ❌ | UNCONFIRMED | Partial (in CoPilot) | ✅ (uniquely MIRA) |

The "Grounded-by-default + UNS confirmation gate" pair is where **MIRA is alone in the cohort** as of 2026-05-20. Other vendors push grounding into the operator's responsibility; MIRA's bot enforces it.

---

## Cross-reference

- For Fuuz architecture in detail → [`fuuz-patterns.md`](fuuz-patterns.md)
- For data-model rules → [`data-modeling-patterns.md`](data-modeling-patterns.md)
- For UNS / MQTT shape → [`uns-mqtt-patterns.md`](uns-mqtt-patterns.md)
- For UI / workflow → [`screens-workflows-patterns.md`](screens-workflows-patterns.md)
- For MIRA action plan → [`../mira-lessons/mira-fuuz-skill-adaptation-plan.md`](../mira-lessons/mira-fuuz-skill-adaptation-plan.md)
