# HubV3 — UI/UX Label Parity Audit (Phase 7)

**Status:** DONE (Hub side) · **Date:** 2026-06-20 · **Branch:** `feat/hubv3-p7-label-parity` → `feat/plc-mapper-gui`
**Spec:** `2026-06-20-hubv3-contextualization-intake-prd.md` §5 Phase 7 + §7. **Goal:** one mental model and one set of labels across the Hub and the offline Contextualizer — "offline is the offline experience of the Hub ingest path, not a different product."

## Canonical vocabulary (PRD §5 P7 / §7)

> Projects/Workspaces · Assets/Machines · Sources · Evidence · Extracted Signals · Fault Catalog · Parameters · UNS Map · Scorecard · Review Queue · Import/Export History

## Key finding

**The offline Contextualizer GUI is already fully canonical.** Its view registry
(`mira-contextualizer/mira_contextualizer/gui/index.html`) reads, verbatim:

```
Dashboard · Sources · Extracted Signals · Fault Catalog · Parameters · UNS Map · Scorecard · Review Queue · Export History
```
…with identity fields `Machine name / Asset type / Manufacturer / … / Proposed UNS path / Hub asset id`.

⇒ Phase 7 is **entirely a Hub-side conform-to-spec task.** The offline app needed
no changes (and was out of scope to edit — owned by the P5/offline track).
The drift was all in the Hub's pre-existing contextualization pages, which used
PLC-tag-centric language instead of the shared "signal" vocabulary.

## Parity table (Hub)

| Surface | Canonical term | Hub — before | Hub — after | Status |
|---|---|---|---|---|
| `contextualization/page.tsx` h1 | Projects/Workspaces | **"PLC Tag Import"** | "Contextualization Projects" | ✅ fixed |
| `contextualization/page.tsx` subtitle | Sources → Signals → promote | "Upload PLC exports… promote approved signals" | "Import equipment **sources**, review proposed UNS paths for extracted **signals**, promote approved signals" | ✅ fixed |
| `contextualization/page.tsx` project-card counts | Sources · Extracted Signals | "N **files** · N **tags** · N accepted" | "N **sources** · N **signals** · N accepted" | ✅ fixed (CHARLIE — found via screenshot, after #2137 merged) |
| `contextualization/page.tsx` empty-state | Sources | "start importing **PLC tags**" | "start importing **equipment sources**" | ✅ fixed (CHARLIE) |
| `[id]/page.tsx` h1 | Extracted Signals | **"Tag Review"** | "Extracted Signals" | ✅ fixed |
| `[id]/page.tsx` subtitle / tooltips / toasts / empty-state | Extracted Signals | "tags" throughout | "signal(s)" throughout | ✅ fixed |
| `[id]/page.tsx` table column | (row-level) | "Tag" | "Tag" (kept) | ✅ intentional — offline keeps `tag` at row level; "Extracted Signals" is the section, a row's PLC **tag** name is accurate |
| `review/` (Review Queue + batch detail) | Review Queue, Sources, Evidence, Extracted Signals, Fault Catalog, Parameters, UNS Map, Scorecard | — | all canonical | ✅ already correct (shipped Phase 4) |
| sidebar | Review Queue | (no link) | "Import Review" → `/contextualization/review` | ✅ added (PR #2136) |

## Deliberate non-changes / residual gaps

1. **Row-level "Tag" stays.** The offline app keeps `tag` at row level (find box "Find tag / role / UNS", per-row tag). Section heading is canonical "Extracted Signals"; the individual PLC **tag** name is the correct domain term for a row. Renaming rows to "signal" would *diverge* from offline, not converge.
2. **"Projects" (Hub) ↔ "Machine Profiles" (offline).** The PRD pairs "Projects/Workspaces" as acceptable synonyms; a Hub *project* (workspace) can contain one or more machine profiles. Left as-is — both are canonical-list members, not drift. Revisit only if a designer wants one string everywhere.
3. **Theme mismatch (follow-up, not label scope).** `[id]/page.tsx` is light-themed (`text-gray-900` / `bg-gray-50`) while `page.tsx` and the `review/` screens are dark. This is a visual-consistency gap, not a *label* gap; left for a focused theme pass to keep this diff label-only (surgical).

## Gate (PRD §5 P7)

- **Label parity audit** — this document, zero mismatches. ✅
- **Screenshot rule** — ✅ **DONE (CHARLIE, 2026-06-20, PR #2140).** Captured on a local prod build of the branch with a minted next-auth JWE cookie (Hub local-e2e recipe) and `/api/contextualization*` mocked in-spec with realistic Garage/Micro820 data — no DB seed, no migration (the earlier Windows-SSL blocker doesn't apply on CHARLIE/macOS). Both surfaces × both viewports in `docs/promo-screenshots/`:
  - `2026-06-20_hubv3-label-parity_projects_{desktop,mobile}.png` — "Contextualization Projects" + canonical card counts (sources/signals).
  - `2026-06-20_hubv3-label-parity_extracted-signals_{desktop,mobile}.png` — "Extracted Signals" table (signals vocabulary; row-level "Tag" retained).
  - Throwaway capture harness (mirrors `playwright.command-center.config.ts`) not committed — PR stays labels + screenshots.
  - ⚠️ Known: the list-page h1 renders low-contrast (`text-white` on the light content area) — the **theme follow-up #3 above**, not a label issue. Label proof carried by the detail page, card counts, and subtitle.
- **Designer review** — open. ⏳
