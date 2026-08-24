# Universal Technician — current → target map and slices

**Written:** 2026-08-24 · **Doctrine:** `docs/specs/mira-technician-app-dogfood-system.md` §1.1–§1.4
**Read that first.** This document is the engineering map, not the product decision.

> MIRA is a universal maintenance copilot that can help a technician troubleshoot any equipment
> immediately, then progressively become the persistent, evidence-backed memory of that component,
> machine, and plant as more context is added.

Every row below was verified against `origin/main` at `c546d0166` (prod `v3.289.6`), not from
handoffs.

---

## 1. What already exists (do not rebuild)

| Capability | Where | State |
|---|---|---|
| Canonical inference seam | `mira-hub/src/lib/inference/canonical-cascade.ts` | **Live.** `MIRA_CANONICAL_SEAM=1` in stg+prod. Legacy inline `providers()` still present in the notebook route as the flag-off fallback. |
| Canonical safety seam | `mira-hub/src/lib/safety-classifier.ts` (`matchSafetyStop`, `SAFETY_STOP`) | **Live.** Notebook chat calls it *before* retrieval and *before* any provider call. |
| Typed SSE frame contract | `mira-hub/src/lib/notebook-chat-types.ts` | **Live.** `sources → content* → usage? → safety? → status → [DONE]`. Documents the precedent that **clients ignore unknown frame kinds** — how `usage` and `safety` were added additively. |
| Strict grounding + refusal | notebook chat route, `chunks.length === 0` → `insufficient_evidence`, no provider call | **Live. Preserve exactly.** |
| Citation entailment | `citationsUsedInAnswer`, refusal-strips-citations | **Live.** A refusal must never ship citations. |
| Equipment Notebook (sources / chat / studio) | `equipment-notebooks/[id]/*`, `NotebookScreen.tsx` | **Live**, proven on device this week. |
| Notebook **without** an asset | `createNotebook()` — `equipment_entity_id` nullable; mobile "+ Create new" | **Live.** A notebook already exists unbound. This is the seam L0 should reuse. |
| Asset → KG bridge | `lib/knowledge-graph/asset-bridge.ts` (#3382/#3384) | **Live.** UI-created assets now open notebooks. |
| Nameplate → identity → manual discovery | `ComponentNameplateFlow.tsx` + recognize/discover pipeline | **Live but notebook-coupled** — see §2. |
| Files / workspace evidence | `/api/files`, `FilesScreen.tsx`, canonical-files dedupe | **Live.** In-app upload proven on device. |
| Machine memory | `/api/assets/[id]/machine-memory` | **Exists.** Live conveyor currently `NO-GO: REPLAY` (spec §3) — frozen data still arriving. |
| Work orders / PM / offline queue | `Workorders.tsx`, `Schedule.tsx`, `lib/offline-queue.ts` | **Live.** The offline queue is the pattern to extend, not replace. |
| 5-tab shell | `mira-mobile/src/nav.ts` | **Frozen contract.** One definition; nothing else defines tabs. |

## 2. What is actually missing

| Gap | Evidence | Level |
|---|---|---|
| **An authenticated, assetless, general-reasoning answer** | The only assetless door is `/api/quickstart/ask` — *public, unauthenticated, pinned to the OEM-corpus tenant, and it refuses when ungrounded*. That is the funnel demo, the opposite of L0. `/api/mira/ask` requires a `session_id` bound to an asset/component. | **L0** |
| **Evidence-basis labelling** | Citations exist; nothing distinguishes *general reasoning* from *OEM documentation* from *machine history* from *live signal*. No `evidence` frame kind. | **L0–L3** |
| **An explicit "ask generally" affordance** | With 0 sources the composer is disabled ("Add a source to start") and the server returns `insufficient_evidence`. Correct today; §1.4 requires an explicit general option instead of a dead end. | **L0** |
| **Component identity independent of a notebook** | `ComponentNameplateFlow` takes a required `notebookId` and calls `recognizeComponentNameplate(notebookId,…)`, `getNotebookDetail(notebookId)`, and attaches with `targetId: notebookId`. Identify-first-decide-later is impossible. | **L1** |
| **Scanner beyond QR** | `ScanView.tsx` uses the `qr-scanner` npm library — **QR only**. No Data Matrix, Code 128/39/93, ITF, PDF417, Aztec, and no OCR pass. | **L1** |
| **Identifier-as-observation model** | A scan resolves to a FactoryLM tag or fails. There is no representation for "decoded this string, meaning not yet established". | **L1** |
| **Progressive component→machine assembly** | Assets and kg entities exist, but nothing proposes "you have identified a Micro820 and two photoeyes while working on CV-101 — add them?" | **L2** |
| **Freshness labelling on live data** | Machine memory exists; the product must distinguish live / stale / historical / unavailable. The current `NO-GO: REPLAY` state is precisely why. | **L3** |

## 3. Deliberate non-goals for this arc

- No second MIRA, provider cascade, safety classifier, evidence model, file system, nameplate
  pipeline, or machine graph.
- No 6th tab (`nav.ts` is frozen; spec §2 forbids a parallel generic Chat tab).
- No second conversation store — general turns persist in the existing notebook turns.
- No control writes at any level.
- No giant upfront machine-building wizard.

## 4. Slices

Sized so each is testable alone. **Only Slice 1 is in scope now.**

### Slice 1 — Ask MIRA without an asset  ← THIS ONE

An explicitly-general turn, opt-in, inside the existing Notebook store.

- **Server:** the notebook chat route accepts `mode: "general"`. When set, it skips retrieval,
  calls the canonical cascade with a general-troubleshooting system prompt, and emits a new
  additive `evidence` frame (`basis: "general_reasoning"`). Safety runs **first**, unchanged.
  Citations are forced empty — a general answer may never carry one.
- **Client:** where the composer is dead at 0 sources, offer *"Ask generally — not grounded in this
  machine's documents"*; general answers render a visible **General guidance** badge.
- **Untouched:** grounded mode. Zero chunks in grounded mode still returns `insufficient_evidence`
  with no provider call.
- **Acceptance:** general answer with no asset and no source; safety stop still fires; grounded
  path byte-identical; scan→Notebook→source→cited-answer still green.

### Slice 2 — Universal identify (L1)

Lift `ComponentNameplateFlow`'s domain seam off `notebookId` so identification can start from the
front door and *then* choose: just troubleshoot / save component / add to machine. Reducer and
discovery pipeline reused, not duplicated.

### Slice 3 — Scanner as "identify what is in front of me" (L1)

Evaluate ML Kit (on-device, offline: Code 128/39/93, Codabar, EAN, UPC, ITF, QR, Data Matrix,
PDF417, Aztec + text recognition) against the current WebView `qr-scanner`. Compare formats,
physical reliability, offline behaviour, camera lifecycle, permissions, APK size, integration cost.
FactoryLM QR stays the fastest exact-identity path. **Decide with Pixel evidence, not vendor docs.**

### Slice 4 — Evidence ladder end-to-end (L0–L3)

Extend the `evidence` frame to `oem_documentation` / `workspace_evidence` / `machine_history` /
`live_machine_evidence`, with freshness on the live one. UI stops implying equal certainty.

### Slice 5 — Progressive assembly (L2) and Slice 6 — conversation → work order → resolution → memory

Suggest relationships; human confirmation stays authoritative; never silently promote a guess into
verified plant structure.

## 5. Open question for Mike

`/api/quickstart/ask` and the new general mode will overlap. Quickstart is the unauthenticated
funnel door pinned to the OEM corpus; general mode is the authenticated technician door. They
should probably converge later, but **not** in Slice 1 — folding them together now would put a
public rate-limited path and a tenant path in one route.
