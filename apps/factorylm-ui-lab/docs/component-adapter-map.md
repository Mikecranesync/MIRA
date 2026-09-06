# Component and adapter map — FactoryLM unified UI

What the shared packages export, which surfaces consume each thing, and what a host has to
inject to mount the shell. Read this before writing a surface adapter.

**Sources of truth for this map:** `origin/main` = `128eda10f` (Tasks 1–4 plus the CI gate)
and PR #3628 head `e90f86735` (Task 5: conversation, parts, composer, source viewer).
Rows delivered by Task 5 are marked; until #3628 merges they exist only on that head.

The three packages are layered and the dependency direction never reverses:

```
factorylm-theme         tokens only, no TypeScript API beyond THEME_NAMES
        ^
factorylm-interaction   runtime-neutral types, reducer, fixtures, adapter contract
        ^                       (no React import anywhere)
factorylm-ui            React components — no Next.js, no Capacitor, no router
        ^
apps/factorylm-ui-lab   fixture-driven preview, and every future host adapter
```

---

## Table 1 — exported surface

`Profiles` is the set of `SurfaceKind`s that observably change behaviour for that export.
**all** means the export is profile-independent — it renders or behaves the same on
public, web, mobile, and hub. That is the default and the point: divergence is the
exception and each one is listed.

### `@factorylm/theme`

| Export | Kind | Profiles | Adapter method | Task |
|---|---|---|---|---|
| `THEME_NAMES` | `const` (`["light","dark"]`) | all | — | 3 |

The rest of the package is CSS: `src/tokens.css` (canonical FactoryLM tokens) and
`src/workspace.css` (semantic `--fl-workspace-*` aliases). There is no other TypeScript
API by design — a component that needs a colour reads a token, never a JS constant.

### `@factorylm/interaction`

Runtime-neutral. No React, no DOM, no transport. Everything is `readonly` and the fixtures
are deep-frozen.

| Export | Kind | Profiles | Adapter method | Task |
|---|---|---|---|---|
| `SurfaceKind`, `ThemeName`, `ViewportKind` | type | all | — | 1 |
| `SurfaceProfile`, `PROFILES` | type + const | **defines all four** | — | 1 |
| `Lifecycle` | type (9 states) | all | — | 1 |
| `Attachment` | type | all | `attachPhoto`, `attachFile` (produced by) | 1 |
| `SourceReference` | type | all | — | 1 |
| `EvidenceBasisKind`, `EvidenceBasis` | type | all | — | 1 |
| `MachineEvidence` | type | all | — | 1 |
| `VisualObservation` | type | all | — | 1 |
| `SafetyNotice` | type | all | — | 1 |
| `ToolState`, `ApprovalRequest` | type | all | — | 1 |
| `DiagnosticPlan`, `PlanStep`, `RunObservation`, `Hypothesis`, `Finding`, `Artifact` | type | all (Work mode) | `shareArtifact` (Artifact) | 1 |
| `ContextSnapshot` | type | all | — | 1 |
| `Usage`, `InteractionError` | type | all | — | 1 |
| `InteractionPart` | type (22 members) | all | — | 1 |
| `InteractionTurn`, `InteractionThread`, `InteractionRun` | type | all | — | 1 |
| `Project`, `ProjectNode`, `ProjectFolder`, `MachineLink`, `ProjectItem`, `Machine` | type | all | — | 1 |
| `FixtureReviewDimensions` | type | all | — | 1 |
| `OfflineState` | type | **mobile** (only profile with `offlineCapabilities`) | — | 1 |
| `InspectorField` | type | **hub** | — | 1 |
| `ShellFixture` | type | all | — | 1 |
| `PlatformAdapter` | interface | all | *is* the contract | 2 |
| `ShellState`, `ShellAction` | type | all | — | 2 |
| `createShellState`, `shellReducer` | function | all | — | 2 |
| `FIXTURE_IDS`, `FixtureId`, `fixtures`, `getFixture` | const/type/fn | **lab only** | — | 1 |

`fixtures` is lab-only on purpose. A host adapter builds `ShellState` from real data via
`createShellState`; importing the fixtures into a product surface would ship demo content.

### `@factorylm/ui`

| Export | Profiles | Adapter method | Task |
|---|---|---|---|
| `FactoryLMShell`, `FactoryLMShellProps` | all — branches on `profile.kind` for layout only | passes `adapter` down; calls none itself | 4 |
| `Sidebar` | all | — | 4 |
| `ProjectTree` | all | — | 4 |
| `ThreadHeader` | all — reveals inspector control when `profile.enterpriseInspector` | — | 4 |
| `Inspector` | **hub** — gated on `profile.enterpriseInspector` | — | 4 |
| `Conversation`, `ConversationProps`, `breadcrumb` | all | — | **5 (#3628)** |
| `PartRenderer`, `PartRendererProps` | all | **`shareArtifact`** | **5 (#3628)** |
| `assertNever`, `describeContext`, `lifecycleLabel`, `machineName` | all | — | **5 (#3628)** |
| `Composer`, `ComposerProps` | all — `profile.nativeDevice` gates camera/scan | **`attachPhoto`, `attachFile`, `scanMachine`** | **5 (#3628)** |
| `SourceViewer`, `SourceViewerProps` | all | — | **5 (#3628)** |

**Only two components touch the adapter at all:** `Composer` (three methods) and
`parts.tsx` (one). Everything else is a pure function of `ShellState`. That is the property
that makes a host adapter small.

---

## Table 2 — what each host must inject

`PlatformAdapter` is five methods (`packages/factorylm-interaction/src/adapters.ts`). The
reducer never calls them; only the two components above do.

```ts
export interface PlatformAdapter {
  attachPhoto(): Promise<Attachment | null>;
  attachFile(): Promise<Attachment | null>;
  scanMachine(): Promise<string | null>;
  shareArtifact(artifactId: string): Promise<"shared" | "cancelled">;
  onBack(): "handled" | "pass";
}
```

| Method | Hub (Next.js) — **not yet built** | Mobile (Capacitor) — **not yet built** | Public web — **not yet built** | Lab (exists) |
|---|---|---|---|---|
| `attachPhoto` | file input constrained to images, then the canonical files upload | Capacitor Camera, then the existing mobile upload path | resolve `null` — demo mode uploads nothing | fake, returns a fixture `Attachment` |
| `attachFile` | file input → canonical files + `workspace_file_links` | native picker → same upload path | resolve `null` | fake |
| `scanMachine` | resolve `null`; Hub selects a machine by navigation, not by scanning | Capacitor Barcode/QR → the machine's UNS identifier | resolve `null` | fake |
| `shareArtifact` | browser download / copy link | native share sheet | resolve `"cancelled"` | fake, records the call |
| `onBack` | return `"pass"` — the browser owns history | hardware Back: close drawer or sheet first, else `"pass"` | `"pass"` | records the call |

**"Not yet built" is literal.** No host adapter exists in the repository today. The only
implementation is the test fake in `packages/factorylm-ui/src/__tests__/harness.tsx`, and
the lab's own `fake-adapter.ts` is a Task 7 deliverable that has not landed either. Every
Hub/mobile/public column above is a specification for work not yet done, not a description
of code.

### Two things a host author will otherwise trip over

**`onBack` is declared but not yet consumed.** At `e90f86735` the only references outside
the interface are the reducer test and the component test harness — no shipped component
calls it. Drawer, sheet, and hardware-Back ordering is **Task 6**, which owns the focus
trap, the scrim, and the Escape/Back precedence. A mobile adapter written today would have
its `onBack` invoked by nothing.

**`scanMachine` returns a machine identifier, not a `Machine`.** The host resolves that
identifier against canonical asset identity itself. The shell never resolves a machine —
consistent with the rule that projects and folders store references, and that machines
stay canonical assets owned elsewhere.

### The boundary that must not move

`packages/factorylm-ui` imports React and `@factorylm/interaction`, and nothing else. No
Next.js, no Capacitor, no router, no transport, no fetch. Anything a surface needs that is
not expressible as `(ShellState, dispatch, PlatformAdapter)` belongs in that surface's
adapter, or it is a change to `PlatformAdapter` — which is a shared-core change under one
writer, not something a surface lane may add locally.

---

## Known gap carried from the salvage record

The merged mobile adapter (`mira-mobile/src/chat-adapter/contract.ts`, #3516) has an
`identity_dispute` part — the server withheld a machine binding because the client's asset
claim did not match. **`InteractionPart` has no member for it**, and no existing member
carries the meaning, so it currently degrades to `unknown` and renders nothing. That is
acceptable in a fixture lab and not acceptable once the mobile adapter is connected, since
the marker exists precisely so the technician learns their claim was refused. Resolve it
before capability #3 (evidence, citations, identity, safety) is connected. See
`salvage-record.md` § #3516.
