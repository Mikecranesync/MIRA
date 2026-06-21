# Observability + Preformatted Industrial Agents

**Status:** Agent template registry **shipped** (this PR). Langfuse cloud bridge +
Hub UI **deferred** (see § Deferred). Companion to
[`observability-and-evaluation.md`](observability-and-evaluation.md) — that doc owns
the `AnswerTrace` / five-pillar / eval-harness layer; this doc owns the **preformatted
agent** layer that rides on top of it.

Source blueprint: *Langfuse + Preformatted Industrial Agents Blueprint* (Cognite Atlas
AI as the public reference pattern). We build the **smaller, sharper wedge**:
contextualization-first, human-approval-first, read-only-tools-first, observability/eval
built into every agent from day one.

---

## What a "preformatted agent" is here (and is not)

MIRA has **exactly one answer engine** — `Supervisor.process()` (`mira-bots/shared/engine.py`).
A preformatted industrial agent is **not** a second execution engine. It is a **contract +
label** over the one engine:

- fixed **scope** (one industrial job),
- a **read-only tool allowlist** (and an explicit blocklist),
- the **context it requires approved** before it should answer,
- the **output fields** it must produce,
- a **risk level**, and
- an **eval pack**.

This is honest about today's reality: the engine is read-only, and these manifests
*label and govern* that reality — they do not add a tool-dispatch sandbox. When MIRA later
grows real per-agent tool execution, the same manifests become the allowlist that dispatch
enforces. Today they drive **routing + trace labelling + an observational contract check**.

---

## Where it lives

```
mira-bots/shared/observe/
├── agent_registry.py          # AgentManifest + loader + read-only invariant + route_agent
├── agent_manifests/           # one JSON manifest per preformatted agent
│   ├── maintenance_troubleshooter.json   (default; risk=medium)
│   ├── root_cause_analysis.json          (causal questions; risk=medium)
│   └── manual_qa.json                    (doc lookup; risk=low)
├── agent_checks.py            # run_agent_contract() — observational output-contract check
├── from_engine.py             # build_answer_trace() now routes + labels + contract-checks
└── trace.py                   # AnswerTrace gains agent_id/version/risk/allowed_tools

simlab/observe/evalpacks/
├── conveyor_demo.yaml         # maintenance_troubleshooter / manual_qa eval pack (existing)
└── rca_starter.yaml           # the 5 blueprint RCA starter cases (new)
```

Dependency-light by contract: nothing under `shared/observe/` imports `simlab` or the
engine, so adapters can label traces without a dependency cycle.

> **Namespace note:** the unrelated `mira-bots/shared/agents/` package is the *autonomous
> ops-agent orchestrator* (detect→act→verify→escalate, e.g. `infra_guardian`). It is **not**
> the industrial agent registry. The industrial registry lives under `observe/` because that
> is where it is consumed (trace fields + contract check).

---

## The manifest

```json
{
  "id": "maintenance_troubleshooter",
  "name": "Maintenance Troubleshooter",
  "version": "0.1.0",
  "scope": "Explain likely equipment state and suggest read-only checks.",
  "risk_level": "medium",
  "allowed_tools": ["context_graph.query", "documents.search", "tags.read_current", "events.search", "traces.create"],
  "blocked_tools": ["plc.write", "tag.write", "machine.reset", "work_order.submit_without_review"],
  "required_context": ["approved_asset", "approved_signals", "approved_documents"],
  "required_outputs": ["answer", "citations", "confidence", "human_review_notice"],
  "eval_pack": "conveyor_demo",
  "route_signals": ["default"]
}
```

### Read-only by construction (real, load-time enforcement)

`AgentManifest.from_dict()` **rejects** any manifest whose `allowed_tools` contains a
write/control verb (`write`, `set_`, `reset`, `submit`, `close`, `command`, `control`,
`bypass`, `override`, `delete`, `force`, …). A write-capable industrial agent **cannot be
loaded**. This is the enforcement point — there is no runtime tool dispatch to police, so the
gate is at load time, where it is real. Aligns with `NORTH_STAR.md` ("read-only for OT"),
`docs/THEORY_OF_OPERATIONS.md` Non-Goals, `.claude/rules/fieldbus-readonly.md`, and
`.claude/rules/train-before-deploy.md` ("read-only in beta").

---

## Routing

`route_agent(question, uns_context)` matches the question against each manifest's
`route_signals` (longest match wins) and falls back to `maintenance_troubleshooter`:

| Question shape | Routed agent |
|---|---|
| "why did the line go down / what caused the downtime / repeat failure" | `root_cause_analysis` |
| "what does the manual say / rated / datasheet / wiring diagram" | `manual_qa` |
| anything else (status, "is it running", generic troubleshooting) | `maintenance_troubleshooter` (default) |

Routing is pure, cheap, and **fail-open**: a registry error labels the trace `agent_id=None`
and the reply is untouched. RCA is a **dedicated** agent (its own scope, tools, output
contract, and `rca_starter` eval pack), per the blueprint — not a mode of the troubleshooter.

---

## What lands on every trace

`build_answer_trace()` (the Phase-1 production seam called from `_schedule_decision_trace`)
now also routes the question and stamps the `AnswerTrace`:

```
agent_id            "root_cause_analysis"
agent_version       "0.1.0"
agent_risk_level    "medium"
agent_allowed_tools ["context_graph.query", ...]
```

**Labelling is unconditional** (every adapter that routes through `process()` — Telegram,
Slack, mira-pipeline, Ignition — gets it). The **contract check** runs only when checks are
enabled (a registry is supplied, i.e. `MIRA_TRACE_CHECKS=1`), consistent with the existing
governance/incident gating. No `engine.py` change was needed — the seam already existed.

### The observational output-contract check

`run_agent_contract(trace, manifest)` returns `Warning`s for **verifiable** required outputs
that are absent — and is **honest** about the rest:

- `citations` missing → `agent_output_missing_citations` (warn)
- `confidence` band missing → `agent_output_missing_confidence` (info)
- `human_review_notice` missing on a medium/safety_review agent → `agent_output_missing_human_review` (warn)
- outputs that can't be verified from free text (`timeline`, `ranked_hypotheses`,
  `missing_context`, …) → recorded as `agent_output_declared_unverified` (info), **never
  asserted satisfied**.

Warnings only — they live in the trace, never alter or block the reply (read-only doctrine).
They are appended without mutating the core governance step's status (a separate pillar).

---

## Eval packs

Each agent declares an `eval_pack`. `rca_starter.yaml` ships the blueprint's five RCA starter
cases (blocked-photoeye cause, VFD-not-enabled, insufficient-evidence, repeat-fault, and
upstream/downstream ambiguity), grounded in `conveyor_jam_01`. Run:

```bash
python -m simlab.observe.run_eval rca_starter      # 5/5 PASS (mock)
python -m simlab.observe.run_eval conveyor_demo    # existing pack
```

CI default is mock mode. **Live** RCA grounding (historian + event + work-order context) is
pending the SimLab RCA scenario seed — noted in the pack header.

---

## Deferred (named plainly, not redefined)

The blueprint's Definition of Done says *"every MIRA answer creates a Langfuse trace"* and
asks for Hub UI pages. **Neither is delivered here, by design:**

1. **Langfuse cloud bridge — deferred.** Per
   [`docs/research/2026-06-21-langfuse-integration-audit.md`](research/2026-06-21-langfuse-integration-audit.md),
   the current Langfuse wiring is a partial RAG-latency tracer that **(a)** ships
   **unsanitized** customer queries + KB excerpts to US cloud on the `mira-pipeline` path,
   **(b)** is a **silent no-op on the prod Telegram bot** (v4 SDK vs v2 code), and **(c)** is
   **region-misconfigured** in dev/staging. Bridging `AnswerTrace` → Langfuse only pays off
   after those are fixed. **What ships instead is a local `AnswerTrace` JSONL** — that is a
   local trace, **not** a Langfuse trace. Do not read DoD #1 as met.
2. **Hub UI (Agent Library / Runs / Trace Detail / Evaluations / Feedback) — deferred.** This
   is a separate Next.js surface (auth gate + Screenshot Rule) — Phase 7 of
   `docs/plans/2026-06-20-observability-production-readiness.md`. The CLI viewer
   (`python -m simlab.observe.viewer`) and `run_eval` reports satisfy the developer-facing
   need today.

### Suggested next phases (not built here)

- **Bridge `AnswerTrace` → Langfuse** (~30 lines) *after* the audit's §5 fixes, so
  asset/UNS/citations/confidence/governance become first-class scores there.
- **Hub `Agents` section** reading `all_manifests()` (Library) + latest `decision_traces`
  (Runs/Trace Detail) + eval reports (Evaluations), tenant-scoped per
  `.claude/rules/knowledge-entries-tenant-scoping.md`.
- **Feedback → eval loop:** promote thumbs-down corrections into new eval cases (blueprint
  Phase 4).

---

## Cross-references

- [`observability-and-evaluation.md`](observability-and-evaluation.md) — AnswerTrace / 5 pillars / eval harness
- [`plans/2026-06-20-observability-production-readiness.md`](plans/2026-06-20-observability-production-readiness.md) — phased plan (this is the agent-template layer on top of phases 0–3)
- [`research/2026-06-21-langfuse-integration-audit.md`](research/2026-06-21-langfuse-integration-audit.md) — why the Langfuse bridge is deferred
- `.claude/rules/train-before-deploy.md` — Command Center trains/validates; HMI deploys approved agents only
- `.claude/rules/fieldbus-readonly.md` / `NORTH_STAR.md` — read-only-for-OT doctrine the registry enforces
