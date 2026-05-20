# Screens & Workflows Patterns

> UI surface and workflow patterns extracted from Fuuz's `fuuz-screens` skill, ProveIt! 2026 application screenshots referenced in Episode 6, and the proveit2026 README. Where applicable, MIRA's Slack-first surface is contrasted.

---

## S-1 — Layout consistency baked into the rules

**What:** Every CRUD screen in ProveIt! uses the same primary layout: **filters on the left**, **table in the center**, **three-dots menu column on the right** for row actions. Not a heuristic — a rule encoded in the `fuuz-screens` skill.

**Why:** AI-generated UIs without an enforced template drift. Each iteration becomes a "complete redo" instead of an edit. Pinning the layout enables real iteration.

**Examples from ProveIt!:**
- Alarms dashboard, OEE dashboard, Assets table, Work Centers table, Production Logs — all the same shape.
- Operator HMI panels are the **exception** — they have their own template (current work-order + product + target + counts + digital work instructions).

**MIRA applicability (Slack surface):** Same principle, different artifact. Every MIRA Slack reply follows:
1. Suspected UNS context first (Site → Asset → Component → Fault).
2. Confirmation question ("Is this the right asset?").
3. After confirmation: ≤3 cited evidence sources, then numbered steps.
4. Sign-off: "If wrong, correct me and I'll re-ground."

These already exist in `.claude/skills/slack-technician-ux-writer/`. Action: number and lead-with-them at every reply template.

---

## S-2 — MainFormContainer as the standard primitive

**What:** A Fuuz screen wraps its content in a `MainFormContainer` that handles standard chrome (header, save/cancel actions, dirty-state tracking, validation pipeline). Inner components fill the body.

**Why:** Most CRUD screens have the same shell. Encapsulating the shell into one primitive cuts ~30% of every screen's JSON.

**MIRA applicability:** When MIRA Hub gains its admin surface (component-template editor, proposal review queue), every page should sit inside an equivalent shell that handles auth + tenant scope + breadcrumb + save/discard. Don't reinvent per page.

---

## S-3 — Action pipeline (declarative chain of effects)

**What:** A Fuuz button doesn't call a function — it triggers an **action pipeline**, a declarative ordered list of action types:

1. `validate` — run form validation.
2. `query` — fetch data needed for the next step.
3. `transform` — JSONata to shape it.
4. `mutate` — write back.
5. `snackbar` — confirm to the user.
6. `navigate` — push to a new screen.
7. `closeDialog` — dismiss a modal.
8. (etc., ~10 action types total)

Each step's output feeds the next via `$state.context.*`. The whole pipeline is JSON.

**Why:** Predictable, debuggable, AI-writable. Claude can generate an action pipeline because the shape is constrained.

**MIRA applicability:**
- When MIRA Hub ships forms (e.g., promote-proposal, edit-component-template), use the same declarative-action shape. Easier to test than imperative handlers.
- For MIRA's Slack reply path, the engine already has a *de facto* pipeline (classify → ground → retrieve → cite → format). Making that explicit (a list of named stages with input/output schemas) would let us test each stage in isolation.

---

## S-4 — Page-load flow hydrates screen context

**What:** When a screen mounts, Fuuz invokes a **page-load flow** (configured via `pageLoadDataFlowIds` / `screenDataFlowIds`). The flow runs server-side, returns a structured result, and writes it into `screen.context`. Components then subscribe to context keys.

**Why:** Single round-trip on mount instead of N component fetches. Predictable load order. Easy to cache.

**Example (Episode 6 `[49:30]`):** the OEE dashboard's page-load flow returned the work-center's full context — current state, mode, shift, hourly OEE, MTTR, MTBF, baseline values, throughput, scrap, top downtime reasons — and the screen rendered subsets of that from `screen.context.*`.

**MIRA applicability:** Same pattern works for any MIRA dashboard. For the Slack surface (no persistent state), the analogue is the **engine's recall step** — gather all evidence in one pass, then write the reply from that snapshot. The "mini UNS" concept (Pattern S-5) is the screen-level extension of this idea.

---

## S-5 — "Mini UNS" inside the screen

**What:** `screen.context` is keyed by domain object — `screen.context.workcenter.current_state`, `screen.context.alarms.acknowledged_count`, etc. Components don't fetch; they subscribe to a key. When the page-load flow (or an inline script) updates the key, every subscribed component re-renders.

**Why:** Same pub/sub semantics as the backend UNS, scoped to one screen. Components stay loosely coupled. Live updates work without refresh.

**MIRA applicability:** When MIRA Hub ships live dashboards:
- One page-load flow hydrates `hub.context.component.{id}.state` with KG snapshot + open proposals + recent citations.
- Subcomponents (proposal list, citation graph, work-order summary) subscribe to keys.
- Live updates (new proposal arrives) push to the keyed store; subscribers refresh.
- Backend: same NeonDB notifications already power the engine; surface them through Hub's React layer.

**Caveat:** Re-render storms on 50+ subscribers. Fuuz's screen renderer is craft.js; MIRA's would be React. Use React's `useMemo` / context-splitting carefully.

---

## S-6 — Inline page-load script ("caveman approach")

**What:** Alternative to a flow. A small JSON-defined script runs on screen mount, executes inline GraphQL queries + JSONata, writes results to `screen.context`. Craig: "caveman approach which I did here." `[24:00]`–`[25:30]`

**Why:** For one-off dashboards that don't justify a full backend flow.

**MIRA applicability:** Skip. MIRA's reply path doesn't have screen mounting. But the principle — *one-off, inline-able orchestration is fine for simple cases; promote to a named flow when it grows* — applies to any MIRA prompt template.

---

## S-7 — Table query with auto-load + JSON transform

**What:** A Fuuz `Table` element can run its own GraphQL query (not relying on `screen.context`), with `autoLoad: true` + a JSON transform for filters/aggregation. Simpler than wiring through the context layer for "table is the screen."

**Why:** Sometimes a screen *is* a table. The full mini-UNS plumbing is overkill.

**MIRA applicability:** When MIRA Hub ships "all proposals," "all manuals for asset X," etc. — these are tables-as-screens. Don't over-engineer; the table fetches its own data.

---

## S-8 — HMI control panels as a screen subtype

**What:** Six dedicated **HMI Control Panels** in Enterprise C — bioreactor, filtration skid, buffer prep, chromatography, robotics, production control. Not the same template as the CRUD screens. Designed for operators (large hit targets, single-purpose, current-state-forward).

**Why:** A maintenance manager's dashboard and a line operator's HMI are different jobs. Templates shouldn't be the same.

**MIRA applicability:**
- MIRA's primary surface (Slack) IS the technician HMI. The slack-technician-ux-writer skill is the equivalent of an HMI template.
- When MIRA-web grows beyond admin/marketing into a technician-facing surface (mobile-first, tablet-on-the-line), it needs its own HMI subtype. Don't shove it into the admin shell.

---

## S-9 — Developer Mode = live debug surface

**What:** Pop a screen into Developer Mode → side console shows every query, transform, binding, action firing. Breakpoints supported on flow nodes.

**Why:** AI-generated screens are correct-looking and subtly wrong. Live trace catches bugs static review misses.

**MIRA applicability:** Direct future investment for Hub. For every MIRA Slack reply, the admin should be able to ask "show me the trace" and see:
- Classifier output (intent, confidence).
- UNS resolution result (vendor, model, fault code, candidate sites).
- KG retrieval (which entities matched, which relationships proposed/verified).
- Manual citations selected (chunk IDs, page numbers, similarity scores).
- LLM call (provider used, prompt token count, response token count, finish reason).
- Groundedness score (1–5) + episode flag.

Today this data is logged. Hub should render it.

---

## S-10 — Application import via copy-paste, not auto-deploy

**What:** Today's Fuuz workflow: download screen JSON → import via App Designer (File → Import) → save → test → deploy. The deploy step is intentional and human-gated.

**Why:** Keeps a checkpoint. No risk of Claude writing directly to production.

**MIRA applicability:**
- MIRA's `prod-guard.sh` already enforces "no direct prod writes from a code session." Same philosophy.
- For Hub admin actions, every "write to verified" should remain a human-gated promote. AI proposes; human verifies.

---

## S-11 — Operator vs admin: hide-don't-delete

**What:** Craig demoed turning off OEE display for an operator screen by **hiding** the components, not removing them. The same screen instance serves both audiences with role-based visibility. `[52:30]`–`[53:30]`

**Why:** Maintenance + flexibility — one screen, two audiences.

**MIRA applicability:** When MIRA Hub ships per-role views (admin / supervisor / technician), use role-based component visibility on the same page rather than parallel pages. Simpler to evolve.

---

## S-12 — Demo data scale matters

**What:** ProveIt! demo data: 4 sites, 10 areas, 19 lines, 40 cells, **504 assets, 1,000+ data points**, 43 workcenters, 21 products, **534 work orders**. WMS demo: **1,000 inventory records, 120 lots, 64 storage units**, 16 products, 2 AGVs.

**Why:** Demos with 3 assets and 10 work orders feel like toys. Demos with 500+ assets feel like a real plant. Buyers calibrate on scale.

**MIRA applicability:** MIRA's `mira-create-demo-plant` skill should aim for similar scale. Today the demo plant ([recent issues / chats]) has a smaller footprint. Action: pad the demo plant to ~100 assets + 200 work orders + 50 manuals + 30 proposed KG relationships. Less "toy"; more "trust signal."

---

## Workflow patterns (the "build an app with Claude" loop)

### W-1 — Frame skeleton, delegate body

The developer builds the **node sequence** of a flow (or layout sketch of a screen) by hand. Claude fills the JavaScript / JSONata / JSON inside each node.

### W-2 — Iterate in chat, paste into platform

Claude lives in the chat (Claude Code locally, Claude Desktop alternatively). The platform lives in the browser (App Designer). Bridge = copy-paste of JSON artifacts.

### W-3 — Test in Developer Mode after every paste

Don't trust the paste. Acknowledge a button, refresh a query, watch the trace. Catch Rube-Goldberg solutions.

### W-4 — Iterate 80–85% in chat, 15% in the platform's screen designer

"Ideally you'll get an 80–85% complete screen out of AI and then you might spend another hour really just kind of fine-tuning it in Fuse, getting it exactly how you want it." Craig `[31:30]`.

### W-5 — Skill updates are the residue of corrections

Every time Craig finds Claude doing something dumb, the rule goes into the skill. Long-tail learning compounds across the team.

---

## Cross-reference

- For backend architecture → [`fuuz-patterns.md`](fuuz-patterns.md)
- For data-model rules → [`data-modeling-patterns.md`](data-modeling-patterns.md)
- For UNS / MQTT → [`uns-mqtt-patterns.md`](uns-mqtt-patterns.md)
- For agent / skills patterns → [`industrial-ai-agent-patterns.md`](industrial-ai-agent-patterns.md)
- For MIRA-specific lessons → [`../mira-lessons/mira-lessons-from-fuuz.md`](../mira-lessons/mira-lessons-from-fuuz.md)
