# FactoryLM Unified UI V2 Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete disconnected, fixture-driven React lab for one shared FactoryLM interaction shell across public, signed-in web, mobile, and enterprise Hub profiles.

**Architecture:** Three framework-neutral packages own the design tokens, authoritative interaction/view model, and shared React components. A standalone Bun-served static React lab consumes those packages through local file dependencies, renders every required state from fixtures, and has no production transport, authentication, storage, or API code. The existing Equipment Notebook contract and shipped mobile ChatV2 remain the production authority; this lab converges their proven semantics without connecting to them.

**Tech Stack:** TypeScript 5.7.2, React/React DOM 19.2.4 lab runtime with React `>=18 <20` peer compatibility, `@types/bun` 1.3.10, Bun's native HTML bundler/dev server/test runner, `@happy-dom/global-registrator` 18.0.1 for component tests, Playwright 1.59.1 for browser proof, plain CSS using FactoryLM tokens, and Bun lock/install.

**Toolchain ruling (2026-09-06):** The initial Vite/Vitest/Testing Library draft was rejected during Task 1 review because its transitive closure introduced ISC, BSD, and CC-BY dependencies outside MIRA's MIT/Apache-2.0 allowlist. Bun already supplies the required HTML build, dev server, and test runner; component tests use native DOM queries so `@testing-library/dom` does not reintroduce the ISC dependency. Every newly introduced package is checked from the installed lock closure by `scripts/check-dependency-licenses.ts`.

**Spec:** `docs/initiatives/FLM-UI-4000.md`, indexed by `docs/prd/2026-09-06-factorylm-unified-interaction-v1.md`, at PR #3622 head `470aa1873f05da597b5304ead119aeb19ba3d9b9`.

## Global Constraints

- Phase 1 is disconnected and fixture-only: no auth, production API, database, provider, upload, CMMS write, deployment, or existing-default-UI change.
- The same `FactoryLMShell` implementation renders `public`, `web`, `mobile`, and `hub`; profiles reveal capabilities but never replace the navigation, interaction contract, or core components.
- Projects and folders contain links. A machine keeps one canonical asset ID even when linked into multiple projects.
- Ordered turn parts preserve unknown future parts and distinguish safety, citations, live evidence, recorded evidence, plans, findings, artifacts, errors, and status.
- The active machine is visible and correctable. Machine-specific claims require confirmed identity and authorized evidence in every relevant fixture.
- Historical turns retain their captured context snapshot when the active future-turn context changes.
- Ask and Work share one shell and composer; Work adds a structured run, never a second chat UI.
- Shared UI code has no Next.js, Capacitor, router, provider, or transport dependency.
- React packages declare `react: ">=18 <20"` as a peer dependency; the lab verifies React 19 while current merged mobile ChatV2 remains the React 18 reuse proof.
- The complete newly introduced dependency closure must be MIT or Apache-2.0 licensed. Do not add axe-core, jsdom, Vite, Vitest, or Testing Library to this lab because their current closures contain non-allowlisted licenses.
- UI values come from `@factorylm/theme`; component code contains no hard-coded colors.
- The ordinary conversation route's compressed JavaScript budget is 300 KB.
- Web controls have visible focus, keyboard operation, screen-reader labels, reduced-motion behavior, and at least 44 by 44 CSS-pixel targets on mobile.
- The lab build must enforce `connect-src 'none'`; mock send/state changes are in-memory only.

---

### Task 1: Local workspace and authoritative fixture contract

**Files:**
- Create: `packages/factorylm-interaction/package.json`
- Create: `packages/factorylm-interaction/src/types.ts`
- Create: `packages/factorylm-interaction/src/fixtures.ts`
- Create: `packages/factorylm-interaction/src/index.ts`
- Create: `packages/factorylm-interaction/src/__tests__/fixtures.test.ts`
- Create: `packages/factorylm-theme/package.json`
- Create: `packages/factorylm-ui/package.json`
- Create: `apps/factorylm-ui-lab/package.json`
- Create: `apps/factorylm-ui-lab/tsconfig.json`
- Create: `apps/factorylm-ui-lab/scripts/check-dependency-licenses.ts`

**Interfaces:**
- Consumes: PRD objects `InteractionThread`, `InteractionRun`, `InteractionTurn`, ordered part types, and `SurfaceProfile`.
- Produces: `SurfaceKind`, `SurfaceProfile`, `PROFILES`, `InteractionPart`, `InteractionTurn`, `InteractionThread`, `InteractionRun`, `ProjectNode`, `Machine`, `ShellFixture`, `FIXTURE_IDS`, `fixtures`, and `getFixture(id)`.

- [ ] **Step 1: Add package manifests and a test runner, without adding runtime implementation**

```json
{
  "name": "@factorylm/interaction",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

The lab owns the test toolchain and references all three packages with `file:../../packages/<name>`. Pin the versions listed in the plan Tech Stack and add scripts `dev`, `build`, `preview`, `test`, `test:watch`, `test:e2e`, `licenses`, and `verify`. Task 1's `build` boundary is type-check-only until Task 7 adds the HTML entrypoint. The license checker recursively reads every installed package manifest, resolves symlinks once, and fails on missing or non-MIT/Apache-2.0 licenses.

- [ ] **Step 2: Write the failing fixture-contract tests**

```ts
import { describe, expect, it } from "bun:test";
import { FIXTURE_IDS, fixtures, getFixture } from "@factorylm/interaction";

it("covers every Phase 1 review state", () => {
  const required = [
    "empty", "general-ask", "machine-ask", "project-tree", "attachments",
    "grounded-answer", "machine-evidence", "safety-stop", "work-run",
    "error-retry", "offline-sync", "enterprise-inspector", "long-history",
  ] as const;
  for (const id of required) expect(FIXTURE_IDS).toContain(id);
});

it("links one canonical machine into multiple projects", () => {
  const scenario = getFixture("project-tree");
  const links = scenario.projects.flatMap((project) => project.children)
    .flatMap((item) => item.kind === "folder" ? item.children : [item])
    .filter((item) => item.kind === "machine-link");
  expect(new Set(links.map((link) => link.machineId)).size).toBeLessThan(links.length);
});
```

- [ ] **Step 3: Run the fixture tests and confirm RED**

Run: `cd apps/factorylm-ui-lab && bun install && bun test ../../packages/factorylm-interaction/src/__tests__/fixtures.test.ts`

Expected: FAIL because `@factorylm/interaction` does not yet export the contract and fixtures.

- [ ] **Step 4: Implement the minimal runtime-neutral contract and immutable fixtures**

```ts
export type InteractionPart =
  | { type: "text"; text: string }
  | { type: "attachment"; attachment: Attachment }
  | { type: "source"; source: SourceReference }
  | { type: "evidence_basis"; basis: EvidenceBasis }
  | { type: "machine_evidence"; evidence: MachineEvidence }
  | { type: "visual_observation"; observation: VisualObservation }
  | { type: "safety_notice"; notice: SafetyNotice }
  | { type: "tool_call"; tool: ToolState }
  | { type: "tool_result"; tool: ToolState }
  | { type: "approval_request"; approval: ApprovalRequest }
  | { type: "plan"; plan: DiagnosticPlan }
  | { type: "plan_step"; step: PlanStep }
  | { type: "observation"; observation: RunObservation }
  | { type: "hypothesis"; hypothesis: Hypothesis }
  | { type: "finding"; finding: Finding }
  | { type: "artifact"; artifact: Artifact }
  | { type: "context_change"; change: ContextSnapshot }
  | { type: "status"; status: Lifecycle }
  | { type: "usage"; usage: Usage }
  | { type: "error"; error: InteractionError }
  | { type: "followups"; suggestions: readonly string[] }
  | { type: "unknown"; raw: unknown };
```

Populate deterministic fixture data for the thirteen scenario IDs. Each scenario also declares supported viewport/theme combinations, so light/dark and desktop/tablet/mobile are dimensions rather than duplicate fixtures.

- [ ] **Step 5: Run the fixture tests and type-check**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-interaction/src/__tests__/fixtures.test.ts && bunx tsc --noEmit && bun run licenses`

Expected: PASS with all fixture invariants and zero TypeScript errors.

- [ ] **Step 6: Commit the foundation contract**

```bash
git add packages/factorylm-interaction packages/factorylm-theme/package.json packages/factorylm-ui/package.json apps/factorylm-ui-lab/package.json apps/factorylm-ui-lab/tsconfig.json apps/factorylm-ui-lab/scripts/check-dependency-licenses.ts apps/factorylm-ui-lab/bun.lock
git commit -m "feat(ui): add unified interaction fixture contract"
```

### Task 2: Reducer and platform-adapter boundary

**Files:**
- Create: `packages/factorylm-interaction/src/reducer.ts`
- Create: `packages/factorylm-interaction/src/adapters.ts`
- Create: `packages/factorylm-interaction/src/__tests__/reducer.test.ts`
- Modify: `packages/factorylm-interaction/src/index.ts`

**Interfaces:**
- Consumes: `ShellFixture`, `InteractionThread`, `ContextSnapshot`, `SurfaceProfile`.
- Produces: `ShellState`, `ShellAction`, `createShellState(fixture, profile)`, `shellReducer(state, action)`, and `PlatformAdapter`.

- [ ] **Step 1: Write failing reducer tests for shared shell behavior and historical-context immutability**

```ts
it("changes context only for future turns", () => {
  const before = createShellState(getFixture("machine-ask"), PROFILES.web);
  const oldSnapshot = before.thread.turns[0].context;
  const after = shellReducer(before, { type: "select-machine", machineId: "machine-drive-b" });
  expect(after.activeContext.machineId).toBe("machine-drive-b");
  expect(after.thread.turns[0].context).toEqual(oldSnapshot);
});

it("switches Ask and Work without replacing the shell", () => {
  const state = createShellState(getFixture("general-ask"), PROFILES.mobile);
  expect(shellReducer(state, { type: "set-mode", mode: "work" }).mode).toBe("work");
});
```

- [ ] **Step 2: Run the reducer tests and confirm RED**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-interaction/src/__tests__/reducer.test.ts`

Expected: FAIL because the reducer and adapter interfaces do not exist.

- [ ] **Step 3: Implement immutable state transitions and the injected adapter contract**

```ts
export interface PlatformAdapter {
  attachPhoto(): Promise<FixtureAttachment | null>;
  attachFile(): Promise<FixtureAttachment | null>;
  scanMachine(): Promise<string | null>;
  shareArtifact(artifactId: string): Promise<"shared" | "cancelled">;
  onBack(): "handled" | "pass";
}
```

Reducer actions cover fixture selection, Ask/Work, project/folder/machine selection, sidebar/inspector/sheet state, source selection, draft text, mock send, retry, theme, and surface profile. No action invokes I/O.

- [ ] **Step 4: Run focused and full interaction tests**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-interaction/src`

Expected: PASS with immutable historical turns and one shared state model.

- [ ] **Step 5: Commit the reducer boundary**

```bash
git add packages/factorylm-interaction
git commit -m "feat(ui): add shared shell state reducer"
```

### Task 3: FactoryLM theme package

**Files:**
- Create: `packages/factorylm-theme/src/tokens.css`
- Create: `packages/factorylm-theme/src/workspace.css`
- Create: `packages/factorylm-theme/src/index.ts`
- Create: `packages/factorylm-theme/src/__tests__/theme-contract.test.ts`
- Modify: `packages/factorylm-theme/package.json`

**Interfaces:**
- Consumes: canonical values from `docs/design/factorylm-tokens.css` and the approved #3622 prototype.
- Produces: package exports `@factorylm/theme/tokens.css`, `@factorylm/theme/workspace.css`, and `THEME_NAMES`.

- [ ] **Step 1: Write a failing token-contract test**

```ts
it("uses FactoryLM-prefixed tokens for every semantic workspace role", () => {
  const css = readFileSync(new URL("../workspace.css", import.meta.url), "utf8");
  for (const token of ["--fl-bg", "--fl-surface", "--fl-ink", "--fl-line", "--fl-accent", "--fl-fault"]) {
    expect(css).toContain(token);
  }
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-theme/src/__tests__/theme-contract.test.ts`

Expected: FAIL because the theme files do not exist.

- [ ] **Step 3: Add the canonical token copy and semantic workspace aliases**

`tokens.css` is byte-identical to `docs/design/factorylm-tokens.css`. `workspace.css` imports it and defines only mappings through existing `var(--fl-*)` and `var(--fl-dark-*)` values for light/dark themes; it introduces no raw color.

- [ ] **Step 4: Run theme tests and CSS hard-code scan**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-theme/src && ! rg -n '#[0-9a-fA-F]{3,8}|rgba?\(' ../../packages/factorylm-theme/src/workspace.css`

Expected: PASS; no raw color in semantic workspace CSS.

- [ ] **Step 5: Commit the theme package**

```bash
git add packages/factorylm-theme
git commit -m "feat(ui): package FactoryLM workspace theme"
```

### Task 4: Shared responsive shell and project navigation

**Files:**
- Create: `packages/factorylm-ui/src/FactoryLMShell.tsx`
- Create: `packages/factorylm-ui/src/Sidebar.tsx`
- Create: `packages/factorylm-ui/src/ProjectTree.tsx`
- Create: `packages/factorylm-ui/src/ThreadHeader.tsx`
- Create: `packages/factorylm-ui/src/Inspector.tsx`
- Create: `packages/factorylm-ui/src/icons.tsx`
- Create: `packages/factorylm-ui/src/shell.css`
- Create: `packages/factorylm-ui/src/index.ts`
- Create: `packages/factorylm-ui/src/__tests__/harness.tsx`
- Create: `packages/factorylm-ui/src/__tests__/shell.test.tsx`
- Modify: `packages/factorylm-ui/package.json`
- Create: `apps/factorylm-ui-lab/bunfig.toml`
- Create: `apps/factorylm-ui-lab/src/test-setup.ts`
- Modify: `apps/factorylm-ui-lab/package.json`
- Modify: `apps/factorylm-ui-lab/bun.lock`

**Interfaces:**
- Consumes: `ShellState`, `ShellAction`, `ProjectNode`, and `SurfaceProfile` from `@factorylm/interaction`.
- Produces: `FactoryLMShell({ state, dispatch, adapter })`, with the same landmarks and child components for every profile, plus shared `Harness`, `renderHarness()`, and `fakeAdapter()` test utilities used by later behavior suites.

- [ ] **Step 1: Write failing shell parity and machine-link tests**

```tsx
for (const surface of ["public", "web", "mobile", "hub"] as const) {
  it(`renders the canonical shell in ${surface}`, () => {
    const view = renderHarness({ surface, fixture: "project-tree" });
    expect(view.container.querySelector("main")).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Ask MIRA"]')).not.toBeNull();
    expect(view.buttonNamed("New chat")).not.toBeNull();
  });
}
```

- [ ] **Step 2: Run and confirm RED**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/shell.test.tsx`

Expected: FAIL because the shell is not implemented.

- [ ] **Step 3: Implement landmarks, responsive regions, and canonical link rendering**

Use `<aside aria-label="FactoryLM navigation">`, `<main>`, a persistent `<header>`, and an optional inspector `<aside aria-label="Inspector">`. Mobile changes CSS presentation to drawer/sheet; it does not branch to a different shell component.

Task 4 pins `@happy-dom/global-registrator` 18.0.1, registers it through Bun's test preload, and re-runs `bun run licenses`. The shared test harness owns state exactly like the lab and exposes small native-DOM query/event helpers; it does not recreate Testing Library:

```tsx
export function Harness({ surface, fixture, adapter = fakeAdapter() }: HarnessProps) {
  const [state, dispatch] = useReducer(
    shellReducer,
    createShellState(getFixture(fixture), PROFILES[surface]),
  );
  return <FactoryLMShell state={state} dispatch={dispatch} adapter={adapter} />;
}
```

- [ ] **Step 4: Run shell tests and type-check**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/shell.test.tsx && bunx tsc --noEmit && bun run licenses`

Expected: PASS on all four profiles.

- [ ] **Step 5: Commit the shared shell**

```bash
git add packages/factorylm-ui apps/factorylm-ui-lab/bunfig.toml apps/factorylm-ui-lab/src/test-setup.ts apps/factorylm-ui-lab/package.json apps/factorylm-ui-lab/bun.lock
git commit -m "feat(ui): add shared FactoryLM shell"
```

### Task 5: Conversation parts, Ask/Work, and universal composer

**Files:**
- Create: `packages/factorylm-ui/src/Conversation.tsx`
- Create: `packages/factorylm-ui/src/parts.tsx`
- Create: `packages/factorylm-ui/src/Composer.tsx`
- Create: `packages/factorylm-ui/src/SourceViewer.tsx`
- Create: `packages/factorylm-ui/src/conversation.css`
- Create: `packages/factorylm-ui/src/__tests__/conversation.test.tsx`
- Create: `packages/factorylm-ui/src/__tests__/composer.test.tsx`
- Modify: `packages/factorylm-ui/src/FactoryLMShell.tsx`
- Modify: `packages/factorylm-ui/src/index.ts`

**Interfaces:**
- Consumes: `InteractionPart[]`, `InteractionRun`, `PlatformAdapter`, and reducer actions.
- Produces: exhaustive `PartRenderer`, `Conversation`, `Composer`, and `SourceViewer` components.

- [ ] **Step 1: Write failing tests for safety suppression, evidence labels, unknown parts, and shared Ask/Work shell**

```tsx
it("renders a safety stop without success chrome", () => {
  const view = renderHarness({ fixture: "safety-stop", surface: "web" });
  expect(view.container.querySelector('[role="alert"]')?.textContent).toMatch(/stop/i);
  expect(view.container.textContent).not.toMatch(/verified finding/i);
});

it("labels live and recorded evidence distinctly", () => {
  const view = renderHarness({ fixture: "machine-evidence", surface: "hub" });
  expect(view.container.textContent).toContain("LIVE");
  expect(view.container.textContent).toContain("RECORDED");
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/conversation.test.tsx ../../packages/factorylm-ui/src/__tests__/composer.test.tsx`

Expected: FAIL because the conversation and composer components do not exist.

- [ ] **Step 3: Implement exhaustive ordered-part rendering and the one composer**

`PartRenderer` uses a `switch (part.type)` and an `assertNever` guard. Unknown parts render an inspectable disclosure in lab mode. The composer exposes labelled text, attachment, machine, voice, and send controls; unavailable profile capabilities remain honest and disabled rather than simulated.

- [ ] **Step 4: Run conversation/composer tests**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/conversation.test.tsx ../../packages/factorylm-ui/src/__tests__/composer.test.tsx`

Expected: PASS for general Ask, machine Ask, Work plans/findings/artifacts, attachments, citations, safety, error/retry, and unknown parts.

- [ ] **Step 5: Commit the interaction surface**

```bash
git add packages/factorylm-ui
git commit -m "feat(ui): render Ask and Work interaction parts"
```

### Task 6: Mobile drawer, inspector sheet, keyboard, and Back behavior

**Files:**
- Create: `packages/factorylm-ui/src/Overlay.tsx`
- Create: `packages/factorylm-ui/src/focus.ts`
- Create: `packages/factorylm-ui/src/__tests__/mobile-behavior.test.tsx`
- Modify: `packages/factorylm-ui/src/FactoryLMShell.tsx`
- Modify: `packages/factorylm-ui/src/Composer.tsx`
- Modify: `packages/factorylm-ui/src/shell.css`

**Interfaces:**
- Consumes: `PlatformAdapter.onBack`, sidebar/inspector/source/attachment-sheet reducer state.
- Produces: `Overlay`, `useFocusReturn`, `composerKeyAction`, and deterministic layer-closing precedence.

- [ ] **Step 1: Write failing tests for focus, Escape/Back, touch targets, Enter, Shift+Enter, and IME**

```tsx
it("closes the top mobile layer before passing Back to the host", async () => {
  const adapter = fakeAdapter();
  const view = renderHarness({ surface: "mobile", fixture: "enterprise-inspector", adapter });
  view.buttonNamed("Open inspector")?.click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(view.container.querySelector('[aria-label="Inspector"]')).toBeNull();
  expect(adapter.onBackCalls()).toBe(0);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/mobile-behavior.test.tsx`

Expected: FAIL because overlay/focus/Back behavior is absent.

- [ ] **Step 3: Implement one overlay stack and keyboard contract**

Close order is source viewer, attachment menu, inspector sheet, navigation drawer, then `adapter.onBack()`. Trap focus while a modal sheet is open and restore it to the opening control. Composer sends on Enter only when `!shiftKey && !isComposing`.

- [ ] **Step 4: Run mobile behavior tests**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/mobile-behavior.test.tsx`

Expected: PASS with no fake native capability.

- [ ] **Step 5: Commit responsive behavior**

```bash
git add packages/factorylm-ui
git commit -m "feat(ui): add mobile shell behavior"
```

### Task 7: Runnable disconnected lab and scenario controls

**Files:**
- Create: `apps/factorylm-ui-lab/index.html`
- Create: `apps/factorylm-ui-lab/src/main.tsx`
- Create: `apps/factorylm-ui-lab/src/App.tsx`
- Create: `apps/factorylm-ui-lab/src/lab.css`
- Create: `apps/factorylm-ui-lab/src/fake-adapter.ts`
- Create: `apps/factorylm-ui-lab/src/__tests__/app.test.tsx`
- Create: `apps/factorylm-ui-lab/scripts/build.ts`
- Create: `apps/factorylm-ui-lab/README.md`
- Modify: `apps/factorylm-ui-lab/package.json`

**Interfaces:**
- Consumes: all fixtures, reducer, `FactoryLMShell`, and `PlatformAdapter`.
- Produces: a local-only lab with surface/scenario/theme/viewport controls and deterministic mock actions.

- [ ] **Step 1: Write failing lab tests for controls and network prohibition**

```tsx
it("uses only in-memory actions", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => { calls += 1; throw new Error("network forbidden"); }) as typeof fetch;
  try {
    const view = renderApp();
    view.inputNamed("Ask MIRA").value = "What is bearing preload?";
    view.inputNamed("Ask MIRA").dispatchEvent(new InputEvent("input", { bubbles: true }));
    view.buttonNamed("Send")?.click();
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `cd apps/factorylm-ui-lab && bun test src/__tests__/app.test.tsx`

Expected: FAIL because the lab application does not exist.

- [ ] **Step 3: Implement the lab and deny connections in the built document**

`index.html` includes:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
```

The fake adapter resolves deterministic fixture attachments and never imports `fetch`, `XMLHttpRequest`, `EventSource`, WebSocket, auth, storage, or production endpoint constants. Update the scripts so `dev` runs `bun ./index.html`, `build` type-checks then invokes a small `Bun.build()` wrapper with `index.html` as its entrypoint, and `preview` serves the built HTML. The build wrapper removes only the explicit local `dist/` directory before emitting the static bundle.

- [ ] **Step 4: Run unit tests and production build**

Run: `cd apps/factorylm-ui-lab && bun test ../../packages src && bun run build`

Expected: PASS and a static `dist/` build.

- [ ] **Step 5: Commit the reviewable lab**

```bash
git add apps/factorylm-ui-lab
git commit -m "feat(ui): add disconnected unified UI lab"
```

### Task 8: Browser matrix, accessibility, performance, and salvage record

**Files:**
- Create: `apps/factorylm-ui-lab/playwright.config.ts`
- Create: `apps/factorylm-ui-lab/e2e/fixture-matrix.spec.ts`
- Create: `apps/factorylm-ui-lab/e2e/keyboard-mobile.spec.ts`
- Create: `apps/factorylm-ui-lab/scripts/check-build-budget.ts`
- Create: `apps/factorylm-ui-lab/docs/component-adapter-map.md`
- Create: `apps/factorylm-ui-lab/docs/salvage-record.md`
- Create: `docs/promo-screenshots/2026-09-06_flm-ui-v2-*.png`
- Modify: `apps/factorylm-ui-lab/package.json`
- Modify: `apps/factorylm-ui-lab/README.md`
- Modify: `wiki/hot.md`

**Interfaces:**
- Consumes: built lab, thirteen fixtures, four profiles, two themes, and viewport set `390x844`, `412x915`, `768x1024`, `1440x900`, `1720x1000`.
- Produces: screenshot evidence, zero-console/network assertions, keyboard/mobile behavior proof, compressed bundle budget result, component/adapter map, and exact reuse/non-reuse list.

- [ ] **Step 1: Write the failing outside-in matrix**

```ts
for (const surface of ["public", "web", "mobile", "hub"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${surface}-${theme}`, async ({ page }) => {
      const external: string[] = [];
      page.on("request", (request) => {
        if (!request.url().startsWith("http://127.0.0.1:")) external.push(request.url());
      });
      await page.goto(`/?surface=${surface}&theme=${theme}&scenario=grounded-answer`);
      await expect(page.getByRole("textbox", { name: /ask mira/i })).toBeVisible();
      expect(external).toEqual([]);
    });
  }
}

for (const scenario of FIXTURE_IDS) {
  test(`renders ${scenario} without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`/?surface=web&theme=light&scenario=${scenario}`);
    await expect(page.getByRole("main")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
```

- [ ] **Step 2: Run and confirm RED for missing matrix behavior or configuration**

Run: `cd apps/factorylm-ui-lab && bun run build && bun run test:e2e`

Expected: FAIL until URL-controlled lab state, viewport behavior, and screenshot paths are complete.

- [ ] **Step 3: Complete URL state, screenshot capture, keyboard checks, and build budget**

`check-build-budget.ts` gzips every emitted ordinary-route JavaScript asset with `node:zlib` under Bun, sums byte lengths, prints the exact total, and exits non-zero above `300 * 1024` bytes.

- [ ] **Step 4: Record exact salvage decisions**

The record must name exact heads and dispositions:

- #3515 `39c5424d29275414dbeccd8060ff0e4715a82b4d`: reuse ExternalStore/FactoryLM-owned adapter proof and terminal-status/unknown-part lessons; do not merge its stale Hub lab route or middleware bypass.
- merged #3516: reuse current mobile `chat-adapter` vocabulary, safety suppression, identity-dispute, and live/hydrated parity semantics; do not move current production code in Phase 1.
- #3514 `9cc9e366a53b5dc3ba9675582b34a39305f37454`: reuse proposed additive typed-event and adapter isolation decisions; do not create a second protocol.
- #3587 `8e9e0e5cd1813b4bb93a8287f980584bfb415dba`: reuse MIRA-first mobile information architecture where consistent with #3622; do not merge its overlapping authority files.
- #3595 `6f2c29b662c7a9ee91108d7936277cabb58bfb3b`: follow its authority/safety/tenant rules; do not duplicate its documentation stack.
- #3596 `5ed5bf1d190536a28c2855cda16a077cb9a426d0`: reuse current canonical Notebook seam and convergence inventory; #3622 supersedes its earlier caution against a shared package for visual sameness.

- [ ] **Step 5: Run full verification**

Run:

```bash
cd apps/factorylm-ui-lab
bun install --frozen-lockfile
bun run verify
bun run test:e2e
bun scripts/check-build-budget.ts
cd ../..
git diff --check origin/pr-3622...HEAD
rg -n 'fetch\(|XMLHttpRequest|EventSource|WebSocket|https?://' packages/factorylm-* apps/factorylm-ui-lab/src
```

Expected: all unit/E2E/type/build checks pass; no production transport symbol or endpoint appears in source; the only URL text allowed is documentation/test localhost context.

- [ ] **Step 6: Update continuity, commit, and prepare the draft implementation PR**

```bash
git add packages apps/factorylm-ui-lab docs/promo-screenshots wiki/hot.md
git commit -m "test(ui): prove unified shell fixture matrix"
```

Before pushing, repeat the open-PR overlap check and re-read the work claim. The draft PR must target the #3622 design branch while stacked, link back to #3622, include exact base/head SHAs, commands/results, screenshot matrix, salvage record, unresolved product decisions, rollback, and a `PARTIAL` label until independent exact-SHA review and CI are complete. Do not merge or deploy.
