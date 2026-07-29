# CodeGraph as a development-memory system — architecture assessment (2026-07-14)

Investigation companion to the freshness/pollution fixes in the same PR. Based on two read-only
audits (invocation-site inventory + memory-architecture analysis). Evidence is file:line-anchored.

## TL;DR

CodeGraph is a **per-session, read-only code-lookup accelerator that is heavily mandated but has no
write-back path**. It is *not* — and by construction *cannot be* — durable shared memory: the index
is gitignored and regenerable, so nothing an agent "learns" via CodeGraph survives the session. The
system already compensates with separate durable layers (CLAUDE.md, `wiki/`, ADRs, `.planning/STATE.md`,
auto-memory), but there is **no convention that turns a CodeGraph investigation into a durable note**,
so agents re-do the same archaeology across sessions. The right fix is *not* to make the index durable
— it's to make write-back cheap and expected.

## Where CodeGraph is invoked (31 surfaces, 10 categories)

| Surface | Role | Evidence |
|---|---|---|
| **MCP config** | RUNS | `.mcp.json` — `codegraph` stdio server (`npx @colbymchenry/codegraph serve --mcp`) loads `codegraph_*` every session |
| **Rules** (MANDATE) | 2 files | `.claude/rules/codegraph-usage.md` (the doctrine), `graphify-excluded.md` (CodeGraph is the *only* code-nav graph) |
| **CLAUDE.md** (MANDATE) | 2 files | root `CLAUDE.md` + `.claude/CLAUDE.md` "Code exploration: CodeGraph first" — preflight before non-doc work; `codegraph_impact` before editing shared modules |
| **Hooks** (RUN) | 3 | `.githooks/post-merge`, `.githooks/post-checkout` (sync→canary→marker), `tools/launchd/com.factorylm.codegraph-reindex.plist` (daily 04:17 `index --force`) |
| **Tooling** (RUN/MANDATE) | 4 | `codegraph-preflight.sh` (per-task gate), `codegraph-canary.sh` (corruption self-heal), `codegraph-force-reindex.sh`, `codegraph-benchmark.sh` |
| **Skills** | 1 line | `ship-pr/SKILL.md` — "codegraph_impact summary if a shared module" in PR review |
| **Docs/plans** (MANDATE/DOC) | ~18 | many plans require `codegraph_impact` before engine edits; `wiki/references/codegraph.md` is the reference |
| **Commands / Agents / Workflows** | **0** | no slash-command, agent definition, or CI workflow invokes it |

**Read of that table:** CodeGraph is a *policy-enforced read gate* (rules + CLAUDE.md + preflight), an
*operational self-healing index* (hooks + canary + daily reindex), but has **zero write surface** and
**zero CI presence**. It is consumed, never fed.

## 1. Lookup vs. retained context

Positioned purely as **per-query lookup**, not durable memory. `.claude/rules/codegraph-usage.md:1`
calls it "the SQLite semantic index"; `.claude/CLAUDE.md` says "Use it BEFORE grep/Read for any
symbol-shaped question." Rule 7 even says "Do NOT re-read files CodeGraph already returned" — agents
*consume* output; nothing feeds discoveries back. **No write-back instruction exists anywhere.**

## 2. Overlap with the other memory layers

| Layer | Relationship to CodeGraph |
|---|---|
| `CLAUDE.md` / `.claude/CLAUDE.md` | **Complementary + authoritative.** CodeGraph = "how the code is NOW" (derived); CLAUDE.md = "rules you MUST follow" (policy). Different altitudes; the repo-archaeology PR just made `catalog/` the inventory map, explicitly deferring code-nav to CodeGraph. |
| `CONTEXT-MAP.md` / `docs/` | **Complementary, human-maintained index** of module contexts; CodeGraph traverses code, docs traverse intent. |
| `wiki/` (ops wiki) | **Orthogonal.** `wiki/SCHEMA.md` session protocol captures *operational* state (deploys, in-flight, blockers) — never code-structure findings. |
| `.planning/STATE.md` | **Session-scope checkpoint**, not a code-findings sink. |
| auto-memory (`~/.claude/.../memory/`) | **External + orthogonal**; no integration path to/from CodeGraph. |
| git history | **Audit trail** ("who changed what"), not architectural memory ("what the shape is"). |
| Graphify | **Explicitly excluded** from code-nav (`graphify-excluded.md`) to avoid two competing graph brains. |

Net: CodeGraph is **siloed for code navigation**; the durable layers are all elsewhere and none of
them receive its output.

## 3. Do investigation findings get written back? **No.**

163 lines of usage rules, zero "persist your findings" convention. When a session traces a blast
radius or a surprising edge, the insight lands in a PR description or a GitHub issue — never in
`CONTEXT-MAP.md`, a module `CLAUDE.md`, or `wiki/`. So the next session repeats the archaeology.
(`session-discipline.md:86-99` checkpoints *task progress* to `STATE.md`, not *code discoveries*.)

## 4. Where agents (correctly) bypass CodeGraph

Documented blind spots → grep fallback (`.claude/rules/codegraph-usage.md`): class instantiation
(#774), `impact <Class>` = containment not dependents, import-alias calls, same-name aggregation, and
now **nested-worktree pollution** (#5, added this PR). These are *designed* fallbacks, not evidence of
thrash. The real re-archaeology cost is #3 (no write-back), not the blind spots.

## 5. Freshness/trust coupling — why the index can't be "memory"

Trust is **earned per task**, not standing: preflight (STALE/BROKEN) + canary + benchmark. The index
is gitignored + regenerable (`index --force`), the incremental watcher has silently corrupted before
(June 2026: `resolve_uns_path` → 0 callers), and there's no way to version a known-good snapshot. **A
regenerable, per-machine, freshness-gated index is definitionally not durable memory.** (This PR
hardened two of those trust signals — freshness no longer false-STALEs on build output; the reindex
now updates the marker — but that makes it a *more reliable lookup tool*, not memory.)

## Recommendations — a reliable shared-memory layer WITHOUT treating a generated index as truth

The index stays a **read-only, preflight-gated lookup accelerator**. Durability comes from cheap,
expected write-back into the human-readable layers:

1. **Add a write-back convention to the CodeGraph rule.** One rule line: *"When a CodeGraph
   investigation yields a durable structural fact (a blast radius, a hidden coupling, a surprising
   caller), record it where the next session will read it — the module `CLAUDE.md`, `wiki/references/`,
   or an ADR — not just the PR."* This is the single highest-leverage change; the whole gap is the
   missing norm.
2. **A "manual checks / CodeGraph findings" block in the PR template** (the `ship-pr` skill already
   half-does this) — makes the write-back visible to reviewers and greppable later.
3. **Treat `catalog/` (this repo's new archaeology catalog) as the durable structural map**;
   CodeGraph answers live/symbol-level questions, `catalog/` holds the validated
   module/service/relationship inventory with evidence + a validator. That division — *generated index
   for live lookup, versioned catalog for durable structure* — is the clean answer to "shared memory
   without trusting a generated index."
4. **Keep the index honest, don't make it authoritative.** The fixes in this PR (freshness excludes
   generated paths; reindex writes the marker; `.audit-worktrees/` gitignored so it isn't indexed;
   benchmark flags nested-worktree pollution) raise trust in *lookups* — they do not, and should not,
   promote the index to a source of truth.
5. **Do NOT wire CodeGraph into CI as a gate.** It's per-machine and regenerable; a CI gate on a
   generated index would be flaky. Keep CI on the *versioned* artifacts (tests, catalog validator).

## Evidence

Audit inputs preserved in the PR thread; key anchors: `.mcp.json`, `.claude/rules/codegraph-usage.md`,
`.githooks/post-{merge,checkout}`, `tools/codegraph-*.sh`, `wiki/references/codegraph.md`,
`wiki/SCHEMA.md`. Pollution proof: `callers check_citation_compliance` → 11, of which 10 are
`.audit-worktrees/*` duplicates (see `2026-07-14-codegraph-benchmark.md`).
