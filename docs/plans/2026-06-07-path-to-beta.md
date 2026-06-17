# MIRA — Path to Beta Testers

**Status:** ACTIVE — opened 2026-06-07 · **Owner:** Mike Harper
**Supersedes nothing.** This is a near-term execution phase that sits *under* the master
plan (`docs/plans/2026-06-01-mira-master-architecture-plan.md`) — it sequences the master
plan's Phase 2 (upload→retrieval) work into a beta-tester launch.

---

## The one gate

> **🚦 BETA GATE — No beta until a stranger can upload their own equipment manual and get a
> cited answer without Mike manually fixing anything.**

"Stranger" and "their own manual" matter: the demo working on a hand-seeded asset does **not**
clear the gate. The gate is met when an unseen manual, uploaded by someone other than Mike,
becomes citable in a real troubleshooting answer with **zero manual intervention**.

Enforced by `tests/beta/beta_ready_upload_retrieval_citation.py` (currently `xfail(strict)` —
flips the suite red the day the gap closes, which is the signal that the gate is met).

---

## The blocker (why we're not in beta today)

The upload→retrieval gap (full trace: `docs/research/2026-06-07-upload-retrieval-gap-and-beta-path.md`):

- Hub / web uploads write chunks to the **Open WebUI knowledge base**.
- All chat retrieval (`neon_recall.recall_knowledge`, the RAG worker) reads only the
  **`knowledge_entries`** table.
- Uploaded manuals therefore never become citable in any chat surface.

**Fix in flight:** PR #1592 (`feat/hub-folder-brain`) — "folder = brain": writes uploads into
`knowledge_entries` keyed to a UNS node, subtree-grounded chat. **DRAFT** as of 2026-06-07.
This plan assesses #1592 as the right fix; the minimal close path is in the research doc.

> **UPDATE 2026-06-16 — the upload→retrieval gap is CLOSED at the code level (Hub NodeChat path).**
> #1592 merged 2026-06-07, followed by #1807 (natural-question BM25), #1861 (GRANT INSERT),
> #1863 (#1806 Inbox node), #1907/#1910 (upload-500 fixes), #1889 (E2E green on prod). I ran the
> **real** chain end-to-end on dev — `ingestPdfToNode` (real fixture PDF) → `retrieveNodeChunks`
> under `factorylm_app` RLS → cited chunk — and it passes:
> `mira-hub/scripts/verify-upload-retrieval-citation.ts` (PR #2076). So the data-layer half (upload
> writes node-scoped `knowledge_entries`; retrieval returns a citable chunk) is **done**.
> **Remaining to flip the `xfail`:** the *HTTP* beta gate (`tests/beta/`) is still xfail **by env**
> — it needs a live Hub surface + a minted `next-auth` session cookie + a node id (`BETA_GATE_*`),
> which nobody has provisioned and run. That's an integration/ops step, not a code gap. (Note: this
> closes the gap on the **Hub NodeChat** surface — the **bot/chat** path `neon_recall` is a separate
> retrieval model and does not yet read folder=brain node uploads; tracked separately, not a
> beta-gate blocker.)

---

## 4-week plan

### Week 1 — Make it real (the gate)
- [ ] Close upload→retrieval (land PR #1592 or its minimal subset — uploads write `knowledge_entries`).
- [ ] Confirm the `/knowledge/map` NaN-coord graph fix (#1742, merged `63c9b8e1`) is **deployed to prod**.
- [ ] Seed the demo tenant — **reuse `tools/seeds/`** (`factorylm-garage-conveyor.sql`,
      `gs10-vfd-knowledge.sql`, `demo-conveyor-001.sql`, `run_demo_seed.py`); fill only gaps.
- [ ] Record a 3-min video: a *fresh* manual upload → ask → cited answer (no pre-seeded asset, no fix).
- [ ] `tests/beta/` release-gate test goes green on prod-shaped data.

### Week 2 — Open the channel
- [ ] LinkedIn reactivation (per `STRATEGY.md`).
- [ ] 20 personal DMs to maintenance / reliability contacts.

### Week 3 — Land design partners
- [ ] 5–10 design partners onboarded, **90-day free access**.
- [ ] Each partner: own tenant, own manuals ingested, beta-gate flow verified per tenant.

### Week 4 — Go to the floor
- [ ] 3–5 local plant visits from HubSpot leads.
- [ ] Run the $500 Assessment offer live (`NORTH_STAR.md` § Three Offers).

---

## Workstream status (2026-06-07 session)

| Lane | What | Status |
|---|---|---|
| 1 | North Star / memory alignment | ✅ this doc + CLAUDE.md/NORTH_STAR.md/.claude/CLAUDE.md/hot.md + memory |
| 2 | Upload→retrieval gap trace + failing test | ✅ research doc + `tests/beta/test_upload_retrieval_citation.py` (xfail) |
| 3 | Beta demo tenant seed + empty state | ⚠️ existing seeds inventoried + gap-fill; empty-state copy |
| 4 | Graph stability (#1742) | ✅ merged; regression test added (`mira-hub/.../GraphCanvas.test.ts`) |
| 5 | Ignition Ask MIRA readiness | ⚠️ readiness check + `docs/runbooks/activate-ignition-ask-mira.md` |
| 6 | Beta release-gate harness | ✅ `tests/beta/beta_ready_upload_retrieval_citation.py` |

(See the session HANDOFF.md for the authoritative per-lane status and what's still blocked.)

---

## Readiness ladder

- **Internal demo:** ✅ achievable today on a pre-seeded tenant (garage conveyor).
- **Design partner:** ❌ blocked on the upload→retrieval gap (PR #1592) — a partner's *own*
  manuals must be citable.
- **Public beta:** ❌ blocked on the gate test going green on prod + per-tenant isolation proof.
