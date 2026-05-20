# MIRA Lessons from Fuuz

> Synthesis of [Episode 6 video analysis](../videos/fuuz-video-analysis.md) + [public repo deep-dive](../repos/fuuz-repo-analysis.md) + [4 architecture-pattern files](../architecture-patterns/) into concrete MIRA actions. Plain English. Decisions, not theory.
>
> Last refreshed 2026-05-20.

## TL;DR — what to do this week, what to plan for the quarter

**This week (high-leverage, low-effort):**
1. Update `companies/fuuz.md` → done.
2. Number the rules in `.claude/rules/uns-compliance.md`, `karpathy-principles.md`, etc. (UC-1, UC-2…). Add an "Anti-hallucination" lead block to each.
3. Add YAML frontmatter `version: 1.0.0` to every `.claude/skills/*/SKILL.md` and create `.claude/skills/MANIFEST.md`.

**This sprint (medium-effort, high-value):**
4. Audit `mira-mcp/server.py` write tools for human-gated promotion + audit logging.
5. Write `mira-platform-utilities` skill — discoverable index of MIRA's helpers (uns_resolver, dedup, citation_compliance, etc.) so Claude reaches for them first.
6. Beef up `mira-create-demo-plant` to ProveIt!-scale (~100 assets, ~200 work orders, ~50 manuals, ~30 proposed KG relationships).

**This quarter (architecture investments):**
7. Define a **standard event envelope** for MIRA's UNS publishing (modeled on Pattern U-3).
8. Add **publish path** to `mira-relay` (MIRA writes proposal lifecycle / grounded-answer events to the customer's UNS).
9. Build Hub's **"show me the trace"** view (Pattern P-9 / S-9) — render every step of how MIRA produced a given answer.
10. Build Hub's **Application Graph for components** (Pattern P-8) — one visual map per component template.

---

## Where Fuuz validates MIRA's direction (six places)

| # | MIRA bet | Fuuz validation |
|---|---|---|
| 1 | **UNS = nervous system, KG = queryable memory** (two distinct layers) | Pattern P-2: same architectural split. Fuuz publishes to UNS and persists to data models in parallel. |
| 2 | **AI is glue, not core** — the moat is the grounded data + the UNS gate + the platform conventions | Episode 6 `[45:30]`: "I would have 100% confidence in this application implemented at my factory. Because it's built using the standardized building blocks." |
| 3 | **Skills as captured corrections** | `fuuz-packages` has 71 numbered rules; each prevents a real past failure. Same shape as `.claude/rules/`. |
| 4 | **Grounded-by-default** | Fuuz's own variant: "Learn your domain. Be really good at your domain. It's a great enabler, but you have to pay attention, you have to test, you have to validate." Episode 6 `[17:30]`. |
| 5 | **No LangChain / no abstractions over the LLM call** (PRD §4) | Fuuz's ML algorithms are pure vanilla JS in a flow node. No framework. |
| 6 | **Two GraphQL APIs (Application vs System)** as a multi-tenant pattern | MIRA's Hub schema doesn't formally separate them yet but should as customer-extensibility grows. Pattern P-7. |

## Where Fuuz takes a different path than MIRA (and what to keep / change)

| # | Fuuz | MIRA | Verdict |
|---|---|---|---|
| 1 | Platform = the product. Customers *build* on it. | Bot = the product. Customers *answer questions* with it. | **Keep MIRA's wedge.** Don't chase the platform sale. |
| 2 | Database-per-tenant. | Single DB, multi-tenant by `tenant_id`. | **Keep MIRA's choice** — but document the trade-off and verify RLS enforcement. |
| 3 | Developer-facing AI (Claude builds apps). | Technician-facing AI (Claude answers in Slack). | **Keep MIRA's wedge.** No vendor in the cohort owns the Slack copilot motion. |
| 4 | Ships pre-built MES/WMS/APS modules. | Ships maintenance copilot only. | **Stay narrow.** `mira-saas-scope-guard` enforces this. |
| 5 | Auto-promotion path = human imports JSON via UI. | Auto-promotion path = human promotes proposal to verified. | **Same philosophy.** Both require human at the gate. |
| 6 | UNS publishing = read + write. | UNS publishing = mostly read. | **Add publish path.** See action #8 above. |
| 7 | Skills are public (Apache-license-pending). | Skills are private to the repo. | **Choose deliberately.** Either keep them MIRA-internal (defensive: don't help competitors copy our prompt engineering) or publish under MIT (offensive: thought-leadership + recruiting). Mike's call. |
| 8 | Operator builds skeleton, AI fills body. | Spec-first then implement. | **Same principle, different stage.** MIRA already does this for spec docs; encode it for skill-driven Claude work too. |

## Where MIRA is ahead (don't lose the lead)

1. **UNS confirmation gate.** No vendor in the cohort enforces "don't answer until you've located the asset." This is uniquely MIRA's. Protect it.
2. **Grounded-by-default with citation compliance.** Fuuz's skills say "evaluate the output"; MIRA's bot *enforces* that the bot can't speak without ground. Different rigor.
3. **Sparkplug-B-conscious from day one.** Fuuz talks MQTT but doesn't surface Sparkplug-B in the public skills. MIRA's `mira-relay` design treats Sparkplug explicitly.
4. **Slack-first.** Fuuz's primary surface is the Application Designer. MIRA's is the place technicians already live.
5. **Hard product scope.** `mira-saas-scope-guard` is more aggressive than anything visible at Fuuz. They're building a platform; we're refusing to be one.

## Where MIRA is behind (worth catching up)

1. **Public skill library + version manifest.** Fuuz's `SKILLS_VERSION_MANIFEST.md` is excellent. MIRA's skills are unversioned. **Action #3 above.**
2. **Application-graph view.** Fuuz renders any app as a graph. MIRA's component templates would benefit. **Action #10 above.**
3. **Developer-Mode trace.** Live trace of every query/transform/binding as a screen runs. MIRA logs but doesn't visualize. **Action #9 above.**
4. **Demo scale.** Fuuz's ProveIt! demo has 504 assets, 534 work orders. MIRA's demo plant is smaller. **Action #6 above.**
5. **Standard event envelope.** Fuuz's 10-field UNS message envelope is rigorous. MIRA's events are ad-hoc. **Action #7 above.**
6. **Connector catalog.** Fuuz has 44 named integrations (SAP, Plex, NetSuite, etc.). MIRA has Atlas + planned MaintainX via Nango. Build the catalog deliberately.

## Concrete action plan (10 items, ordered by impact / effort)

### IMMEDIATE (this week)

**1. Number the rules in MIRA skill / rules files.**
- Files: `.claude/rules/uns-compliance.md`, `karpathy-principles.md`, `python-standards.md`, `security-boundaries.md`.
- Format: prefix per file (e.g., UC-1 through UC-9 in `uns-compliance.md`).
- Add lead "Anti-hallucination" block at the top of each.
- **Owner:** MIRA committer.
- **Effort:** 1 hour per file.

**2. Add skill versioning.**
- Add `version: 1.0.0` to YAML frontmatter of each `SKILL.md`.
- Create `.claude/skills/MANIFEST.md` modeled on Fuuz's manifest.
- Status enum: `draft` / `review` / `ready` / `deployed` / `deprecated` / `baked-in`.
- **Owner:** MIRA committer.
- **Effort:** ~2 hours total.

**3. Update `companies/fuuz.md`** ✅ done (companion to this research pass).

### SOON (this sprint, 2–4 weeks)

**4. Audit `mira-mcp/server.py` write tools.**
- Check each tool that writes (KG promote, work-order create, manual ingest, proposal accept).
- Confirm: per-user auth, audit log, dry-run path, write-to-proposed-not-verified default.
- **Owner:** maintenance-diagnostician agent + MIRA committer review.
- **Effort:** 1 sprint.

**5. Write `mira-platform-utilities` skill.**
- One-stop reference of MIRA's helpers: `uns_resolver`, `citation_compliance`, `dedup`, `kg_writer`, etc.
- "Before writing X, look at Y" router pattern (analog to fuuz-platform).
- **Owner:** anyone who knows the codebase well.
- **Effort:** ~4 hours.

**6. Pad demo-plant scale.**
- Target: ~100 assets, ~200 work orders, ~50 manuals, ~30 proposed KG relationships.
- Update `mira-create-demo-plant` skill to seed at that scale.
- **Owner:** demo-team owner.
- **Effort:** ~1 day.

### QUARTERLY (architecture)

**7. Standard event envelope.**
- Define a single schema for MIRA-published UNS events: `eventId`, `eventType`, `entityId`, `entityKind`, `parentId`, `namespaceURI`, `value.before`, `value.after`, `timestamp`, `groundedness`, `confidence`, `sourceRefs[]`.
- Write a publisher helper that enforces it.
- Document in `docs/specs/`.
- **Owner:** MIRA architecture.
- **Effort:** ~2 weeks (spec + impl + tests).

**8. Add publish path to `mira-relay`.**
- Today `mira-relay` is read-side. Add write topics for: `proposal_lifecycle`, `grounded_answer`, `kg_promotion`, `citation_activity`.
- Use the envelope from #7.
- **Owner:** MIRA architecture.
- **Effort:** ~2 weeks (envelope, broker, ACL, smoke test).

**9. Build Hub's "show me the trace" view.**
- For any MIRA answer (Slack message), render the full pipeline: classifier → UNS gate → recall → citations → LLM call → groundedness score.
- Hub admin page; per-message permalink.
- **Owner:** mira-hub team.
- **Effort:** ~3–4 weeks.

**10. Build Hub's "component application graph."**
- For each component template, render a visual graph: manuals cited, KG entities, KG relationships, recent work orders, recent technician Q&A.
- **Owner:** mira-hub team.
- **Effort:** ~4–6 weeks (graph library + KG queries + permissions).

## Open follow-ups for next research pass

- [ ] **Compare Fuuz's MCP roadmap once announced** — what tools, what RBAC model? Reconcile against MIRA's `mira-mcp`.
- [ ] **Watch Tier-2 Fuuz videos** (F0oaVkVj2EQ, uxk3NkUEHsA, i0lj8quQsDM). Specifically:
  - Does Craig discuss customer outcomes (ROI, deployment timelines)?
  - Does he name competitors? How does he position vs MaintainX, MachineMetrics, Tulip?
- [ ] **Watch the Manufacturing Matrix WMS episode** — Enterprise B / putaway specifics relevant to where MIRA could integrate.
- [ ] **Verify license status** on Fuuz repos. If/when they add Apache 2.0, MIRA could reference their alarm-management.md schema directly (with attribution) rather than re-deriving.
- [ ] **Probe Fuuz pricing.** UNCONFIRMED publicly. Useful for competitive deal-shaping.

## Cross-reference

- Full skill adaptation plan → [`mira-fuuz-skill-adaptation-plan.md`](mira-fuuz-skill-adaptation-plan.md)
- Architecture decisions → [`mira-architecture-decisions.md`](mira-architecture-decisions.md)
- Wedge + positioning → [`mira-wedge-and-positioning.md`](mira-wedge-and-positioning.md)
- Patterns by domain → [`../architecture-patterns/`](../architecture-patterns/)
- Companies catalog → [`../INDEX.md`](../INDEX.md)
