# ADR-0039: assistant-ui Adoption Boundary and MIRA Runtime Adapter

**Status:** Proposed
**Date:** 2026-08-30
**Resolves:** PRD §8, §12.1, §12.2, §12.4; Open Decision 3 (§22)
**Depends on:** ADR-0038 (Option A — MIRA frames, custom transport)

## Context

Dependency assessment: `@assistant-ui/react` 0.15.17, MIT throughout (incl. `assistant-cloud` client), 0 npm advisories, active but single-founder-concentrated; non-Vercel backends first-class via `LocalRuntime`/`ExternalStoreRuntime`; **inline superscript citations are NOT built in** (discussion #3067) — custom text-part renderer required; `@assistant-ui/react-native` is 0.1.x — not production material. **Open decision 3 answer: assistant-ui (web React) on both existing surfaces — hub pages and the Capacitor WebView-delivered mobile app; no React Native rewrite in this program.** OTA-shippable per ADR-0034 amendment (pure JS).

Today hub and mobile chat share **zero code**; cross-lane contracts are exact-string conventions (`BASIS_LABEL`/`FRESHNESS_LABEL` cross-cite `mira-mobile/src/lib/replay.ts`). The inventories are silent on any workspace/monorepo npm tooling linking the two apps — do not assume a shared package can be imported by both without build-system work.

## Ownership boundary

**assistant-ui owns (commodity):** thread viewport + stick-to-bottom + jump-to-latest; message list rendering and per-message actions (copy, retry hooks); composer primitives (auto-grow, Send↔Stop toggle bound to run state, attachment slots via `AttachmentAdapter`); markdown rendering (`@assistant-ui/react-markdown` — re-audit deps when added); tool-part lifecycle rendering (`Tools()` API); local interaction state.

**MIRA owns (domain — the adapter's job is to keep the library away from these):**
- Transport: all four doors in `mira-mobile/src/api/client.ts` incl. cookie jar and 401 fan-out; hub `API_BASE` + trailing-slash discipline. The library never fetches.
- Frame parsing: `createChatSseParser` semantics (reused verbatim).
- Request assembly: `sourceDocIds` scope (never auto-downgrade to `mode:"general"`), `buildChatHistory` 12-line window with stopped-turn exclusion, `machineEvidence`/`visualEvidence` riders, byte-identical retry bodies (`PendingSend`).
- Stopped/failed disambiguation (`isStoppedTurn` null-text heuristic) — applied at the translation boundary, never in presentation.
- Citation→viewer chain: `originFileId` fallback, `getSourcePassage`, authenticated blob rendering (`FilePreview`/`requestBinary`), hub navigation to `/equipment/[id]/source/[docId]?page=N`.
- Transient-layer BACK stack (`mira-mobile/src/lib/transient-layer.ts`): every assistant-ui dialog/sheet/popover must register here or hardware BACK ordering breaks.
- Render policy: ADR-0034 (no remote images, neutered links, no HTML passthrough) re-imposed on assistant-ui's markdown via component overrides — its defaults render links/images.
- All server-side trust gates (unchanged; never reimplemented client-side).
- Styling: FactoryLM `--fl-*` tokens only; full re-skin of assistant-ui defaults.

## Runtime choice

**`ExternalStoreRuntime`** for the production adapter: MIRA owns message state (hydrated `turns` + session live turns + pending), stopped semantics, and reconciliation — inversion of control matches that. Adapter supplies `messages`, `isRunning`, `onNew`, `onCancel`, `onReload` (regenerate — **deferred**: banned by recovery PRD §5 until its gates exit), `onAddToolResult` (unused until tool events exist). `LocalRuntime`+`ChatModelAdapter` is acceptable for the spike (less code) but its library-owned thread state conflicts with server-truth hydration and the three-store reality; the spike should try LocalRuntime first and prove ExternalStore before Phase 1 (spike plan, criterion 6).

## Module layout

No importable shared package exists between the apps, and creating one mid-recovery-window is out of scope. Layout:

```
mira-hub/src/lib/chat-adapter/          # web adapter
  contract.ts        # re-exports lib/notebook-chat-types.ts (already the shared truth on hub)
  frames-to-parts.ts # frame → canonical part translation (pure, unit-testable)
  runtime.ts         # ExternalStoreRuntime wiring; postNotebookChat as transport
  parts/             # registered custom part components (below)

mira-mobile/src/chat-adapter/           # mobile adapter, same file names
  contract.ts        # mobile copy of the part/type contract
  frames-to-parts.ts
  runtime.ts         # requestStream + createChatSseParser as transport
  parts/
```

`frames-to-parts.ts` is deliberately identical logic in both apps. **Drift guard:** a parity-pin test in each app asserts a shared fixture corpus (recorded SSE transcripts, checked into both repos' test fixtures) translates to identical part JSON — the same pattern the safety-classifier uses to pin TS against `guardrails.py`. Extracting a real shared package is a Phase 5 cleanup item, not a prerequisite. (If the team disagrees, that is a build-tooling decision to surface explicitly — the inventories give no basis for it.)

## MIRA-specific part registration

Custom part kinds are registered as components, not forks of the library core:

| Part | Source data | Component (reused from) |
|---|---|---|
| `source` | `sources` frame / persisted `evidence[]` (has `citationId`) | Custom **text-part renderer** carrying the remark citation-chip plugin (`remark-citation-marks.ts` mobile / `remarkCitationChips` hub — both portable); chips gated on structured `knownIds`, unknown `[7]` stays literal. assistant-ui's built-in `sources` block is not used for inline markers (gap confirmed upstream, #3067). Tap → existing viewer chain / navigation. |
| `machine_evidence` | `evidence` frame entries with window semantics | Port of `MachineEvidenceCards` (mobile NotebookScreen ~1030-1105) / hub replay cards; **never coerced into `source`** — freshness/window strings are a frozen cross-lane contract (`replay.ts`), rendered verbatim. |
| `observation` | `visual_observation` entries | Port of `VisualEvidenceCards`; photo via authenticated `requestBinary` (mobile) / `/api/namespace/files/[id]` (hub). |
| `safety_notice` | `safety` frame live; persisted `evidence[]` marker per protocol ADR item 3 | New component; renders **before** answer chrome; fixes mobile's current frame-drop and both clients' reload amnesia. |
| `error` / stopped | typed `ApiError.kind` + null-text heuristic | Custom status renderer preserving `userMessage` copy (incl. the 403 `source_not_in_notebook` string) — never flattened to generic strings. |
| Tool parts | none today | Registered with `Tools()` API but fed nothing until net-new server events exist (Phase 3); LOOK/READ/REPLAY stay sheet-hosted in v0, with the adapter exposing the imperative append/send API their "Ask MIRA" hand-off needs. |

## Feature flags (§12.4, using infra that actually exists)

1. **Server capability advertisement (primary):** add `chat_v2` to the role-derived matrix in `mira-hub/src/lib/capabilities.ts`, delivered via existing `GET /api/me` `capabilities[]`. Mobile gates rendering with the existing fail-closed `can(capabilities, "chat_v2")` (`nav.ts`); hub gates its pages the same way. No new schema. Per-tenant/per-user opt-in beyond role granularity **does not exist today** — if beta cohorting needs it, that is a new table under `mira-hub-migrations.md` discipline; flag that as a Phase 4 prerequisite rather than pretending the infra exists.
2. **Server env flag:** `MIRA_CHAT_V2_FRAMES=1` gating the new additive frames (`turn`, `lifecycle`) — same pattern as `MIRA_CANONICAL_SEAM`; declared explicitly in compose files (canonical-seam lesson).
3. **Platform enablement:** capability computation may branch on platform if needed; the client never infers from app version (ADR-0034 rule 3).
4. **Emergency fallback:** legacy surface stays code-present and reachable when `chat_v2` is absent from `/api/me`; server-side capability revert = instant rollback with no store release (PRD §19). Mobile-side, OTA channel rollback is the second lever.
5. **Removal:** flags carry a removal review date (proposed: end of Phase 5 observation window); `MIRA_CANONICAL_SEAM`'s legacy `providers()` fallback shows what unfinished flag cleanup looks like — name it as the anti-pattern.

## Consequences

- One adapter per app, contract pinned by shared fixtures; five hand-rolled parsers retire in favor of two thin transports over one parser semantics.
- The adapter isolates the app from library types (§12.2 last bullet): if assistant-ui's single-founder risk materializes, the blast radius is `chat-adapter/` + `parts/`, not the domain layer.
- NodeChat/AssetChat/Quickstart/AssetValidateTab adoption is explicitly deferred: NodeChat and AssetChat adopt the adapter only after the dialect consolidation (protocol ADR item 4); Quickstart (non-streaming, anonymous) and AssetValidateTab (records Q&A rows) stay bespoke by decision, not neglect — recorded here so they don't become orphan dialects silently.
