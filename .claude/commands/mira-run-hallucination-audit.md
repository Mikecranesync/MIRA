# /mira-run-hallucination-audit

Find places where MIRA might answer without grounding. Reports risk patterns, evidence-citation coverage, and concrete code-level fixes.

## What this command does

### 1. Grep for risk language

Search prompts, agents, engine code, response-generation code for patterns that often produce ungrounded output:

- Risk words in prompt templates: `assume`, `probably`, `likely`, `default`, `usually`, `typically`, `most`, `generally`, `in general`
- Hardcoded fake plant context: any string literal like `"Site A"`, `"Line 1"`, `"Pump-001"` outside of `tests/` or fixtures
- "Helpful" fallbacks: `else: return "I think..."` or similar that respond before grounding
- Format strings that pass user message directly to LLM without UNS resolve first

Run across:
- `mira-bots/shared/` (engine, guardrails, intent classifier, prompt templates)
- `mira-bots/{slack,telegram,email,gchat,reddit}/` (handlers)
- `mira-pipeline/` (pipeline-side prompt assembly)
- `mira-sidecar/` (legacy — flag for sunset, don't fix)
- `mira-mcp/` (tool responses)
- `mira-crawler/ingest/` (extraction prompts — check for invention)
- `prompts/` if present
- `agents/` if present

### 2. Verify evidence citation in response paths

For every code path that emits a final answer to a user, confirm it:
- Cites at least one source: UNS path, doc reference, work-order ID, PLC tag, KG relationship, or technician confirmation
- Goes through `mira-bots/shared/citation_compliance.py`
- Increments `evidence_utilization` in `mira-bots/shared/benchmark_db.py`

Flag any code path that emits a final answer WITHOUT those.

### 3. Verify the UNS confirmation gate

Use `/mira-trace-technician-flow` output (or run it inline). Flag any bypass path.

### 4. Check ingestion for invention

In `mira-crawler/ingest/`:
- Any extraction prompt that says "if not found, generate a reasonable value" — that's invention. Replace with `unknown` + low confidence.
- Any embedder that fills missing manufacturer/model from filename guesses without confidence marker.
- Any KG write that defaults to `verified` instead of `proposed`.

### 5. Score risk per finding

- **P0** — code path can ship an ungrounded answer to a technician's Slack.
- **P1** — code path can ship an ungrounded answer to a non-customer surface (eval, internal dashboard, draft work order).
- **P2** — code path uses risk language in a prompt but downstream guardrails likely catch it.
- **P3** — style / lint, not a functional risk.

## Output

Write or update `docs/hallucination-audit.md` with:

1. Date stamp + branch + git short SHA.
2. **Summary** — count by P0/P1/P2/P3.
3. **Findings table** — file:line, category, risk, suggested fix (1 line).
4. **UNS gate verification** — pass/fail + the file:line that enforces it (or doesn't).
5. **Evidence citation coverage** — % of response paths that cite. Aim for 100% in production paths.
6. **Suggested code changes** — concrete diffs as fenced blocks. Do NOT apply automatically. Surface to the user / PR reviewer for approval.

## Constraints

- **Read-only.** Surface findings, don't auto-edit.
- **Avoid false-positives in tests/fixtures.** Suppress matches under `tests/`, `fixtures/`, `seed_*.py`, `marketing/`.
- **Cite real file:line.** Use `grep -n`.

## Verification

- `grep -c '^P0\|^P1' docs/hallucination-audit.md` — finding counts in the report.
- `grep -i "UNS gate" docs/hallucination-audit.md` — gate verification is present.

## Cross-references

- `.claude/CLAUDE.md` — grounded troubleshooting rules
- `mira-bots/shared/citation_compliance.py`
- `mira-bots/shared/engine.py` — groundedness scoring
- `mira-bots/shared/benchmark_db.py` — evidence tracking
- `.claude/skills/knowledge-graph-proposer/SKILL.md` — proposed vs verified discipline
