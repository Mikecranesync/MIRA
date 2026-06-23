# Platform Alignment — UI (Audit Area 6)

**Phase 4.5 audit, read-only. 2026-06-23.**
**Question:** where should answer cards / evidence / confidence / contradictions / citations / technician checks actually appear?

**Verdict:** **almost every spine output has an existing host.** The Hub IA is two-armed: the *training* arm (`/namespace`, `/contextualization/*`, `/knowledge/suggestions`, `/knowledge/map`) hosts the **UNS draft**; the *answering* arm (`AssetChat` + **`WhyMiraThinksThis.tsx`**) hosts the **answer card**. The single most important fact: **the answer-card backing table `decision_traces` already stores the "hard" spine fields — they're deliberately parked, not missing.**

## Placement map

### (a) UNS draft / contextual factory model → **DIRECT (already exists, across 3 coordinated surfaces)**
- Per-signal proposed UNS + confidence + accept/reject → **`/contextualization/[id]`** (the canonical UNS-draft UI — does the spine's job for signals today).
- Batch scorecard → `/contextualization/review/[batchId]`.
- Relationships → `/knowledge/suggestions` (Verify/Reject) + `/knowledge/map` (graph confirm/reject).
- Approved tree → `/namespace`.
- **One PARTIAL gap:** the `/namespace` per-node **Proposals tab is a stub** (counts only, `namespace/page.tsx` L880–887). Wire it to the existing `/knowledge/suggestions` queue — **do not build a new page.**

### (b) Ranked cause hypotheses → **PARTIAL (generated in prose, never rendered as a structured list)**
`quickstart/ask` already "lists 2–3 alternative causes ranked by probability" in prose; `/api/mira/ask` emits a `trend_proposal`. **Host:** a "Ranked causes" `Section` inside `WhyMiraThinksThis.tsx`, alongside its existing Manual/Tags/KG sections.

### (c) Plain-language answer card → **PARTIAL — `WhyMiraThinksThis.tsx` is the answer card; ~half the fields are stored-but-unrendered**

| Spine field | Host | Verdict |
|---|---|---|
| Most likely cause + confidence | `ConfidencePill` + `recommendation` | DIRECT (pill) / PARTIAL (recommendation text not shown) |
| Evidence FOR | existing `Manual` / `Live tags` / `KG` `Section`s | DIRECT |
| **Evidence AGAINST / contradictions** | new `Section`; data = the **already-stored `context_ignored`** field | PARTIAL (data exists, unrendered) |
| Manual/procedure citations | `Manual evidence` section (doc+page+url) | DIRECT |
| Similar history | new `Section`; data via CMMS / `AssetIntelligencePanel` | PARTIAL→MISSING (no trace field yet) |
| **Technician checks** | new `Section`; data = the **already-stored `next_check`** field | PARTIAL (data exists, unrendered) |
| **"What needs human review"** | map from `outcome`/`needs_review` feedback + `decision_path` | PARTIAL |

`WhyMiraThinksThis.tsx` L21–22 explicitly note `decision_path`, `context_ignored`, `next_check` are **stored but deliberately NOT rendered (deferred PRD §11)** — i.e. evidence-against, technician-checks, and what-was-ignored are already in the data model.

**Coverage gap:** `NodeChat` (the `/namespace` Ask MIRA), `/quickstart`, and `/demo/conveyor` render **citation chips only, no Why-panel** (NodeChat has no `traceId`). To give those the full card, emit a `traceId` from those routes so the shared card component can mount.

### (d) Live HMI / signals → **DIRECT** — `/command-center` (freshness dots, opens live HMI) + `/demo/conveyor/[tag]` (embedded live signals). A deployment surface, not where cards are authored (`train-before-deploy.md`).

## Duplication risks (would tempt a new page)

1. **Answer card → do NOT build a "Diagnosis" page.** It belongs inside `WhyMiraThinksThis.tsx` (already attached to every `AssetChat` answer). A standalone page would orphan chat context + duplicate the `decision-trace` fetch.
2. **Ranked causes → a `Section`, not a "Hypotheses" page.**
3. **UNS draft → do NOT add a 4th/5th review surface.** There are already four (`/contextualization/[id]`, `/contextualization/review/[batchId]`, `/knowledge/suggestions`, `/knowledge/map`) — the risk is fragmentation, not absence. Consolidate into `/contextualization/[id]` → `/knowledge/suggestions`.
4. **"What needs human review" → link into the existing `/settings/review-queue` + `/knowledge/suggestions`, not a 3rd inbox.**
5. `/alerts` is mock + Labs-gated — a future host, not a current renderer.

## Token-compliance note

Any answer-card extension must use `--fl-*` tokens (`--fl-ok`/`--fl-warn`/`--fl-fault`/`--fl-off` map to the high/med/low/none bands already in `ConfidencePill`). The contextualization review pages currently hardcode hex/Tailwind colors — a pre-existing `.claude/rules/ui-style.md` violation to avoid copying.

## Conclusion

The spine's UI outputs are **mostly a rendering task on `WhyMiraThinksThis.tsx`**, not new pages — and three of the hardest fields (evidence-against, technician-checks, human-review) are **already persisted in `decision_traces`** and parked. The UNS draft already has a richer home (`/contextualization/[id]`) than the spine built. The highest-leverage UI move: un-defer the parked `WhyMiraThinksThis` fields + add ranked-causes + recommendation text, and emit `traceId` from `NodeChat`/quickstart so every Ask-MIRA surface inherits the full card.
