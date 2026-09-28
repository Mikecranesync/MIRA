# MIRA Mobile ChatV2 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely integrate the existing ChatV2 mobile surface by closing safety, rollout, transport-honesty, draft, transient-layer, and token violations before merging PR #3516.

**Architecture:** Keep the existing notebook route, SSE parser, persistence, uploads, and citation viewer. Add one server-advertised capability, project persisted safety evidence into the existing MIRA part contract, and make ChatV2 a controlled rendering of `NotebookScreen` state.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Capacitor 8, `@assistant-ui/react` 0.15.17, Next.js Hub capabilities.

**Spec:** `docs/superpowers/specs/2026-08-31-mira-mobile-chatv2-integration-design.md`

## Global Constraints

- MIRA stays grounded maintenance intelligence; no new provider or generic-chat path.
- Existing notebook SSE, persistence, authorization, upload, and citation-viewer contracts remain authoritative.
- Safety STOP state survives reload and supersedes ordinary answer presentation.
- ChatV2 fails closed unless `/api/me` advertises `chat_v2`.
- Native buffered transport must not present cosmetic Stop.
- New ChatV2 styling uses FactoryLM `--fl-*` tokens; no raw hex/RGB/HSL in component CSS.
- Every production behavior change follows red-green TDD.

---

### Task 1: Hydrate persisted safety notices

**Files:**
- Modify: `mira-mobile/src/chat-adapter/__tests__/turns-to-parts.test.ts`
- Modify: `mira-mobile/src/chat-adapter/turns-to-parts.ts`
- Modify: `mira-mobile/src/chat-adapter/contract.ts`
- Modify: `mira-mobile/src/screens/ChatV2.tsx`

**Interfaces:**
- Consumes: persisted evidence entry `{ kind: "safety_notice", trigger: string }` from PR #3517.
- Produces: `MessagePart { type: "safety_notice"; trigger: string | null }` before answer text.

- [ ] **Step 1: Replace the known-gap assertion with a failing parity test**

```ts
expect(hydrated.parts[0]).toEqual({ type: "safety_notice", trigger: "loto" });
expect(hydrated.parts.some((p) => p.type === "source")).toBe(false);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bunx vitest run src/chat-adapter/__tests__/turns-to-parts.test.ts --maxWorkers=1 --no-file-parallelism`
Expected: FAIL because hydrated safety evidence currently becomes `unknown`.

- [ ] **Step 3: Add a narrow guard and hydration mapping**

```ts
function safetyNoticeEntry(value: unknown): { kind: "safety_notice"; trigger: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  return row.kind === "safety_notice" && typeof row.trigger === "string"
    ? { kind: "safety_notice", trigger: row.trigger }
    : null;
}
```

Filter the marker out of unknown evidence and pass its trigger to `assistantParts` before text.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `bunx vitest run src/chat-adapter/__tests__/turns-to-parts.test.ts --maxWorkers=1 --no-file-parallelism`
Expected: all adapter tests pass.

### Task 2: Add the fail-closed server capability

**Files:**
- Modify: `mira-hub/src/lib/__tests__/capabilities.test.ts`
- Modify: `mira-hub/src/lib/capabilities.ts`
- Modify: `docker-compose.saas.yml`
- Modify: `docker-compose.staging-vps.yml`
- Modify: `docs/env-vars.md`
- Modify: `mira-mobile/src/lib/chat-ui-pref.ts`
- Modify: `mira-mobile/src/App.tsx`
- Modify: `mira-mobile/src/screens/NotebooksTab.tsx`
- Modify: `mira-mobile/src/screens/NotebookScreen.tsx`
- Modify: `mira-mobile/src/screens/More.tsx`

**Interfaces:**
- Produces: `/api/me.capabilities[]` contains `chat_v2` only when `MIRA_CHAT_V2_ENABLED=1`.
- Consumes: `chatV2Available: boolean` in the mobile screen tree.

- [ ] **Step 1: Add failing Hub and mobile gate tests**

```ts
process.env.MIRA_CHAT_V2_ENABLED = "0";
expect(getCapabilities(ctx({}))).not.toContain("chat_v2");
process.env.MIRA_CHAT_V2_ENABLED = "1";
expect(getCapabilities(ctx({}))).toContain("chat_v2");
```

Mount `NotebookScreen` once with `chatV2Available={false}` and a stored `v2` preference; assert the
V2 composer is absent. Mount with `true`; assert it is present.

- [ ] **Step 2: Run both tests and verify RED**

Run: `bunx vitest run src/lib/__tests__/capabilities.test.ts` from `mira-hub`, then the ChatV2 test from `mira-mobile`.
Expected: FAIL because the capability and prop do not exist.

- [ ] **Step 3: Implement the server capability and client prop chain**

```ts
if (process.env.MIRA_CHAT_V2_ENABLED === "1") caps.push("chat_v2");
```

`useChatV2Enabled(available)` returns `false` whenever `available` is false. The local preference
selects V2 only inside that server-authorized boundary.

- [ ] **Step 4: Declare the default-off environment variable**

Add `MIRA_CHAT_V2_ENABLED=${MIRA_CHAT_V2_ENABLED:-0}` to Hub in SaaS and staging compose, and
document that removing it is the fleet rollback.

- [ ] **Step 5: Run both tests and verify GREEN**

Run the same Hub and mobile commands from Step 2.

### Task 3: Make the composer and Stop control honest

**Files:**
- Modify: `mira-mobile/src/lib/__tests__/request-stream.test.ts`
- Modify: `mira-mobile/src/api/client.ts`
- Modify: `mira-mobile/src/screens/__tests__/chat-v2.test.tsx`
- Modify: `mira-mobile/src/screens/ChatV2.tsx`
- Modify: `mira-mobile/src/screens/NotebookScreen.tsx`

**Interfaces:**
- Produces: `canCancelChatTransport(): boolean`.
- Consumes: controlled `draft`, `onDraftChange`, and `canStop` props in ChatV2.

- [ ] **Step 1: Add failing tests for native Stop and draft recovery**

```ts
expect(canCancelChatTransport()).toBe(false); // native mock
expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
expect((await composer()).value).toBe("what trips the overload"); // failed send
```

Add an attachment test that types a question, opens Photo, and asserts the LOOK request receives
that exact question rather than the generic fallback.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bunx vitest run src/lib/__tests__/request-stream.test.ts src/screens/__tests__/chat-v2.test.tsx --maxWorkers=1 --no-file-parallelism`
Expected: FAIL on the new transport and visible-draft assertions.

- [ ] **Step 3: Implement transport truth and controlled draft**

```ts
export function canCancelChatTransport(): boolean {
  return !Capacitor.isNativePlatform();
}
```

ChatV2 reads/writes the parent `q` draft. It shows Stop only while a chat request owns an abort
controller and the transport supports cancellation; otherwise it shows a disabled Working state.

- [ ] **Step 4: Replace the attachment popover with the shared Sheet**

Render the two attachment actions inside `<Sheet label="Add to conversation" ...>` so Escape and
hardware BACK use the existing transient-layer registry.

- [ ] **Step 5: Add answer Copy behavior through the existing safe clipboard helper**

Export `copyText` from `AnswerMarkdown.tsx`; add an accessible `Copy answer` action next to the
answer body and test the real clipboard call.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run the same command from Step 2.

### Task 4: Converge new styling and verify the branch

**Files:**
- Modify: `docs/design/factorylm-tokens.css`
- Modify: `mira-mobile/src/tokens.css`
- Modify: `mira-mobile/src/app.css`

**Interfaces:**
- Produces: canonical `--fl-*` aliases used by every ChatV2 rule.

- [ ] **Step 1: Add missing canonical spacing/shape aliases**

Define the small set needed by ChatV2 in the canonical file, then expose equal-value `--fl-*`
aliases in the mobile compatibility block. Do not change existing legacy `--flm-*` values.

- [ ] **Step 2: Replace raw values in the ChatV2 CSS block**

Use `var(--fl-space-*)`, `var(--fl-fs*)`, `var(--fl-radius*)`, `var(--fl-shadow*)`, and state tokens.
Remove both `rgba(...)` fallbacks.

- [ ] **Step 3: Run the no-hardcoded-color scan**

Run: `git diff --unified=0 origin/main...HEAD -- mira-mobile/src | rg '^\+.*(#[0-9A-Fa-f]{3,8}|rgb\(|rgba\(|hsl\()'`
Expected: no ChatV2 production CSS matches.

- [ ] **Step 4: Run full affected verification**

Run:

```text
cd mira-mobile && bunx vitest run src/chat-adapter/__tests__/turns-to-parts.test.ts src/screens/__tests__/chat-v2.test.tsx src/lib/__tests__/request-stream.test.ts --maxWorkers=1 --no-file-parallelism
cd mira-mobile && bun run build
cd mira-hub && bunx vitest run src/lib/__tests__/capabilities.test.ts
git diff --check origin/main...HEAD
```

Expected: all commands exit 0. The known Windows full-suite worker starvation is reported separately
and is not hidden; GitHub's Mobile Unit Tests remains the authoritative clean full-suite run.

- [ ] **Step 5: Commit and push the correction**

```text
git add <only the files listed in this plan>
git diff --cached --check
git commit -m "fix(mobile): make ChatV2 safe to roll out"
git push origin feat/chat-v2-mobile
```

- [ ] **Step 6: Clear the PR hold only after CI is green, then squash-merge**

Remove the `[HELD — Mike decides]` title marker, wait for `hold-gate` and all required checks, then
merge PR #3516. Do not deploy or publish an APK in this task.
