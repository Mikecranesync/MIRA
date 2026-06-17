# MIRA Beta Readiness — Audit Lenses

**Updated:** 2026-06-16 (B9 — healthy run; supersedes today's A9c degraded run)
**Audited:** `origin/main @dfa51f1c` (⚠️ working tree on `feat/command-center-gateway-bar`,
freshness-guard exit 3 / 3 behind — beta-readiness == deploy truth == `origin/main`).
**Gate:** A stranger uploads their own equipment manual, asks a real troubleshooting
question, and gets a grounded answer with citations from that manual — with zero manual
fixing — and **nothing leaks, breaks, or lies**. Tracked by
`tests/beta/beta_ready_upload_retrieval_citation.py` + `docs/plans/2026-06-07-path-to-beta.md`.

RED (gate flow broken / live leak on the path) / YELLOW (works, rough edges) / GREEN (solid).
Findings carry `[severity]` and `[beta-path: yes/no]`. Unverified findings are worse than no
audit — every claim below was corroborated against `origin/main`.

---

## Six-lens scorecard (current)

| Lens | Status | Last audit | Top finding (1 line) | Next action (1 line) |
|---|---|---|---|---|
| **A · Security & auth** | 🟢 GREEN | A9 · 06-16 | 0 new unguarded routes / 0 weakened auth in 13 commits; only watch = CSP now trusts `www.dropbox.com` (nonce-gated Chooser triad) | Keep Dropbox-only in `buildCsp` — no CDN-wildcard creep |
| **B · Functional** | 🟡 YELLOW ▼ | **B9 · 06-16** | **NEW P1 [beta-path: yes]:** `/api/knowledge/search` (#2044) returns `LEFT(content,220)`+source_url across all `knowledge_entries` with no `is_private` filter → cross-tenant content leak | **Apply `patches/2026-06-16-B9-knowledge-search-is-private.patch`** |
| **C · Engine** | 🟢 GREEN | C8 · 06-15 | Engine provably frozen since C7; all 5 invariants intact (UNS gate, direct-conn reject, citation, groundedness) | None blocking; asset-agent-gate resolver gap is HMAC-gated |
| **D · Eval & test** | 🟡 YELLOW | D8 · 06-15 | Scorecard 50/57 (0 beta-critical fails); replay store inert (`.gitignore`) → `cp_citation_vendor_relevance` (#1858) the one diagnostic invariant w/o an operable CI guard | Founder records replay store; merge D8 replay-gate patch |
| **E · Promotion** | 🟢 GREEN | E8 · 06-15 | Staging real (compose + `@MiraStaging_bot`); deploy double-gated (staging-gate ∧ smoke); migration head 053 | Make `version-gate.yml` a required branch check; fix doc drift |
| **F · Blocker ledger** | 🟢 GREEN | F8 · 06-15 | North Star YES at F8; B9 surfaces one open LEAK to fold into the ledger next F-rotation | Re-rank ledger with the B9 leak tracked as a LEAK item |

---

## Lens B — Hub functional readiness (this run, B9): **YELLOW ▼ (was GREEN)**

Audited 21 `mira-hub` commits since the B8 baseline `@8c3a44c1` (clean ancestor of
`origin/main @dfa51f1c`). Window includes a new **i3x (CESMII) read-only API** (#2027/#2038),
**Command Center gateway registry Phase 2** (#2014/#2046/#2060), and a new **knowledge full-text
search** (#2044).

### NEW finding (the reason B dropped to YELLOW)

| Sev | Beta-path | Finding | File | Verdict |
|---|---|---|---|---|
| **P1** | **yes** | `GET /api/knowledge/search` selects `LEFT(content,220) AS snippet` + `source_url` + title across **all** `knowledge_entries` with **no `is_private` predicate** and no tenant predicate. `sessionOr401`-gated (any tenant) and reachable from Knowledge→Manuals (`page.tsx:131`). The table is a HYBRID corpus — per-tenant uploads land `is_private=true` (node door #1903; migration 052; `/api/documents/upload`) — so a search returns one tenant's **private manual content** to any other tenant. | `mira-hub/src/app/api/knowledge/search/route.ts:55-72,86-101` (#2044) | **REAL — #1833 leak class.** Verified: `is_private` exists (mig 001); private rows demonstrably written (#1903 + mig 052); cited sibling `/api/knowledge/route.ts` returns **counts only** so its "universal" rationale doesn't transfer to a content read. |

**Fix (surgical, verified):** add `AND is_private = false` to **both** the BM25 query and the ILIKE
fallback — keeps the universal shared-OEM-corpus search intact and does **not** add
`tenant_id = $caller` (which would reintroduce the #1761 "OEM returns 0 rows" regression). Matches
migration 052's contract and the `/api/documents` reference impl. Patch staged + `git apply --check`
**clean vs origin/main**: `patches/2026-06-16-B9-knowledge-search-is-private.patch`.

### Standing items (unchanged on deploy truth)

| Sev | Beta-path | Finding | State |
|---|---|---|---|
| P2 | no (admin-only) | `tests/canary/proposal_state_drift.sql` still **exactly 2 forward-only `@check`s** → engine terminal transitions disown `ai_suggestions` while admin `/proposals` renders pending = stale-pending lie, canary-blind | **7-cycle stall** (B3→B9). Staged `patches/2026-06-10-canary-reverse-drift-check.patch` (apply-clean), unmerged |
| P2 | no (coverage) | 3 Playwright configs (`command-center`, `onboarding-validate`, `onboarding-walkthrough`) wired into **0 workflows** | Unchanged & **sharpened**: command-center churned hardest this window (#2014/#2046/#2060 incl. new e2e route mocks + gateway-bar test) yet still runs in no CI job |

### Verified clean this window (not findings)

- **ADR-0017 honored:** `proposals/[id]/decide/route.ts` imports + calls `applyHubProposalTransition()` (L4/L97); the raw `UPDATE kg_relationships` (L138) is the documented engine projection. Not raw `SET status`.
- **i3x surface is bearer-gated, not open:** routes call `resolveI3xTenant()` → 401 on missing/invalid key; the `middleware.ts` exclusion of `/api/i3x/` is deliberate (self-auth + public `GET /info`). New read-only integration surface, post-beta scope — not a leak.
- **#1894** scoped `relationship_proposals` to the authenticated tenant; **#2031/#2043** stopped the asset Documents tab showing unrelated demo docs — both strengthen tenant isolation.

---

## KG (Lens B scope)

graphify still uninstallable in the sandbox (no CLI/module; `GEMINI/GROQ/CEREBRAS/OPENAI/ANTHROPIC`
all unset). Nightly `graph.json` rebuilt today @15:58 = **4118 nodes / 53,297 links**; B9 delta
hand-extracted to `kg/b9-findings.jsonl` (**+10 nodes / +8 edges** for the knowledge-search leak
subgraph). **Insight:** the graph holds **79 i3x nodes** but **zero** `knowledge_entries` /
`is_private` nodes — the table+column this leak mis-scopes. The hybrid-corpus invariant that three
independent routes must each honor (#1833 `/api/documents`, #1903 node-ingest, #2044 search) has **no
node in the product graph**, so every new reader re-derives or forgets the rule; #2044 forgot. The
leak-prone invariant is itself a graph blind spot — which is why it recurs.

---

## What this run changed

- Rotated Lens B on real `origin/main` (prior A9c was a degraded/sandbox-down carry).
- Found + **verified** a NEW P1 cross-tenant content leak on `/api/knowledge/search` (#2044) and
  staged an apply-clean one-predicate patch. Dropped B GREEN→YELLOW.
- Confirmed the two standing B items unchanged (canary 7-cycle stall; 3 ungated Playwright configs).
- Cleared three potential false alarms (ADR-0017, i3x auth, proposals scoping) against deploy truth.
- No code edited; writes confined to `wiki/orchestrator/`. The durable deliverable is the patch + this map.
