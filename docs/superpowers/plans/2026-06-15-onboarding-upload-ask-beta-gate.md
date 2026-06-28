# Onboarding Upload → Ask (Beta-Gate Close, #1901) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fresh customer is auto-sent to onboarding, uploads their manual in a wizard step that waits until it is searchable, then gets a cited answer from their own manual — unattended.

**Architecture:** Two changes in `mira-hub`. (1) `/feed` (client component) checks the wizard status on mount and `router.replace("/onboarding")` for any tenant who hasn't finished onboarding. (2) The onboarding wizard gains an `upload` step (after `review`) that POSTs the file to the existing `/api/uploads/local` with `unsPath = <line node uns_path>`, polls `/api/uploads/[id]` until `status==="parsed" && knowledge_chunks_count>0`, then renders the existing `<NodeChat>` for the created line node so the customer asks their own manual. Pure decision logic is isolated in `src/lib/onboarding-flow.ts` for unit testing.

**Tech Stack:** Next.js (App Router, the patched in-repo build — read `node_modules/next/dist/docs/` before touching framework APIs), React client components, vitest (units), @playwright/test (e2e). Reuses `/api/uploads/local`, `/api/uploads/[id]`, `<NodeChat>` (`@/components/namespace/NodeChat` → `/api/namespace/node/[id]/chat`), `/api/wizard/[step]`.

**Key facts verified against the codebase:**
- `POST /api/uploads/local` (session auth) accepts multipart `file` + optional `unsPath` (validated `^[a-z0-9_]+(\.[a-z0-9_]+)*$`); returns the upload row `{ id, status, ... }` with HTTP 201. `handleLocalUpload` tags ingest with `unsPath`.
- `GET /api/uploads/[id]` returns `{ ...row, knowledge_chunks_count, ... }`; `knowledge_chunks_count > 0` only once `row.status === "parsed"`.
- `POST /api/wizard/finish` returns `{ ok: true, kind: "ok", siteId, lineId, sitePath, linePath }`. The onboarding `finish()` currently ignores `lineId`/`linePath` — this plan captures them.
- `GET /api/wizard/company` returns `{ status, currentStep, stepPayloads }`, `status ∈ {"not_started","in_progress","completed"}` (the onboarding page already treats `"completed"` as "go to /namespace").
- `<NodeChat nodeId nodeName unsPath />` posts to `/api/namespace/node/${nodeId}/chat` and renders citations. The node selection is the UNS gate (gate-compliant by construction).
- `(hub)/feed/page.tsx` is a **client** component (`"use client"`). `(hub)/layout.tsx` is a server component but wraps every hub page (so the redirect goes in `/feed`, not the layout — avoids trapping users on other tabs).

---

## File Structure

- Create `mira-hub/src/lib/onboarding-flow.ts` — pure helpers: `isManualReady`, `shouldRedirectToOnboarding`. One responsibility: onboarding decision logic, no React/IO.
- Create `mira-hub/src/lib/__tests__/onboarding-flow.test.ts` — vitest units for the two helpers.
- Modify `mira-hub/src/app/(hub)/feed/page.tsx` — on-mount wizard-status check → redirect.
- Modify `mira-hub/src/app/(hub)/onboarding/page.tsx` — capture `lineId`/`linePath` from `finish()`; add `upload` step id, `STEPS` entry, routing, and the `UploadStep` component.
- Create `mira-hub/tests/e2e/onboarding-upload-ask-1901.spec.ts` — beta-gate e2e.
- Modify `mira-hub/package.json` + `mira-hub/CHANGELOG.md` — version bump + entry.
- Add `docs/promo-screenshots/2026-06-15_onboarding-upload-ask_*.png` — proof.

---

## Task 1: Pure onboarding-flow helpers

**Files:**
- Create: `mira-hub/src/lib/onboarding-flow.ts`
- Test: `mira-hub/src/lib/__tests__/onboarding-flow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// mira-hub/src/lib/__tests__/onboarding-flow.test.ts
import { describe, it, expect } from "vitest";
import { isManualReady, shouldRedirectToOnboarding } from "@/lib/onboarding-flow";

describe("isManualReady", () => {
  it("true only when parsed AND chunks > 0", () => {
    expect(isManualReady({ status: "parsed", knowledge_chunks_count: 3 })).toBe(true);
  });
  it("false while parsed but no chunks yet", () => {
    expect(isManualReady({ status: "parsed", knowledge_chunks_count: 0 })).toBe(false);
  });
  it("false for in-flight statuses", () => {
    expect(isManualReady({ status: "queued", knowledge_chunks_count: 0 })).toBe(false);
    expect(isManualReady({ status: "parsing", knowledge_chunks_count: 0 })).toBe(false);
  });
  it("false for failed status even with stale counts", () => {
    expect(isManualReady({ status: "failed", knowledge_chunks_count: 5 })).toBe(false);
  });
});

describe("shouldRedirectToOnboarding", () => {
  it("redirects when wizard not started or in progress", () => {
    expect(shouldRedirectToOnboarding("not_started")).toBe(true);
    expect(shouldRedirectToOnboarding("in_progress")).toBe(true);
  });
  it("does NOT redirect a completed tenant", () => {
    expect(shouldRedirectToOnboarding("completed")).toBe(false);
  });
  it("does NOT redirect on unknown/empty status (fail safe: stay on feed)", () => {
    expect(shouldRedirectToOnboarding("")).toBe(false);
    expect(shouldRedirectToOnboarding("weird")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mira-hub && npx vitest run src/lib/__tests__/onboarding-flow.test.ts`
Expected: FAIL — cannot find module `@/lib/onboarding-flow`.

- [ ] **Step 3: Write minimal implementation**

```ts
// mira-hub/src/lib/onboarding-flow.ts
// Pure decision logic for the onboarding upload→ask beta-gate flow (#1901).
// No React, no IO — unit-tested in isolation.

import type { UploadStatus } from "./uploads";

export interface UploadReadiness {
  status: UploadStatus;
  knowledge_chunks_count: number;
}

/** A manual is "ready to cite" only once the ingest pipeline has parsed it
 *  AND produced retrievable KB chunks. Mirrors GET /api/uploads/[id]. */
export function isManualReady(row: UploadReadiness): boolean {
  return row.status === "parsed" && row.knowledge_chunks_count > 0;
}

/** A fresh tenant who has not completed the onboarding wizard should be sent
 *  into it. Anything other than an explicit "completed"/"in_progress"/
 *  "not_started" is treated as "stay put" (fail safe — never trap a user who
 *  has a namespace but a weird status). */
export function shouldRedirectToOnboarding(wizardStatus: string): boolean {
  return wizardStatus === "not_started" || wizardStatus === "in_progress";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mira-hub && npx vitest run src/lib/__tests__/onboarding-flow.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add mira-hub/src/lib/onboarding-flow.ts mira-hub/src/lib/__tests__/onboarding-flow.test.ts
git commit -m "feat(hub): pure onboarding-flow helpers (isManualReady, shouldRedirectToOnboarding) (#1901)"
```

---

## Task 2: Auto-redirect fresh tenants from /feed into onboarding

**Files:**
- Modify: `mira-hub/src/app/(hub)/feed/page.tsx`

**Context:** `/feed` is a client component. Add a one-shot mount effect that GETs `/api/wizard/company`, and if `shouldRedirectToOnboarding(status)` is true, `router.replace("/onboarding")`. Gate the page render on the check so a fresh tenant does not see the feed flash before redirecting. Loop-safe: only `/feed` performs this; `/onboarding` never redirects back, and a `completed` tenant stays on the feed.

- [ ] **Step 1: Add imports and the redirect effect**

At the top of the component file, ensure these imports exist (add what is missing — `useRouter`, `API_BASE` is already imported, `shouldRedirectToOnboarding`):

```ts
import { useRouter } from "next/navigation";
import { shouldRedirectToOnboarding } from "@/lib/onboarding-flow";
```

Inside `export default function FeedPage()` (or the page's component), at the very top of the body add:

```ts
  const router = useRouter();
  // #1901: a fresh tenant who hasn't finished onboarding is sent into the wizard
  // so they reach the one gated action (upload a manual → cited answer). Loop-safe:
  // only /feed does this; /onboarding never redirects back; completed tenants stay.
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/wizard/company`, { cache: "no-store" });
        if (cancelled) return;
        const data = res.ok ? await res.json().catch(() => ({})) : {};
        const status = String((data as { status?: unknown }).status ?? "");
        if (shouldRedirectToOnboarding(status)) {
          router.replace("/onboarding");
          return; // keep the gate up; we're leaving
        }
      } catch {
        // network/transient — fail safe: show the feed
      } finally {
        if (!cancelled) setOnboardingChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);
```

- [ ] **Step 2: Gate the render until the check resolves**

Immediately before the page's main `return (`, add a short-circuit (match the file's existing loader markup style if present; this minimal version is acceptable):

```tsx
  if (!onboardingChecked) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500" data-testid="feed-onboarding-gate">
        Loading…
      </div>
    );
  }
```

- [ ] **Step 3: Verify type-check / build passes**

Run: `cd mira-hub && npx tsc --noEmit`
Expected: no new errors from `feed/page.tsx` (pre-existing unrelated errors, if any, are out of scope — note them, do not fix).

- [ ] **Step 4: Commit**

```bash
git add "mira-hub/src/app/(hub)/feed/page.tsx"
git commit -m "feat(hub): auto-redirect un-onboarded tenants from /feed to onboarding (#1901)"
```

---

## Task 3: Capture line node + add the `upload` step slot to the wizard

**Files:**
- Modify: `mira-hub/src/app/(hub)/onboarding/page.tsx`

**Context:** `finish()` returns `{ lineId, linePath }` but the page ignores them. Capture them into state so the upload step can attach the manual (`unsPath = linePath`) and open `<NodeChat nodeId={lineId} />`. Insert the `upload` step between `review` and `try`; route `finish()` to advance to `upload`.

- [ ] **Step 1: Extend StepId, STEPS, and line-node state**

Change the `StepId` type (line ~25) to include `upload`:

```ts
type StepId = "company" | "site" | "line" | "review" | "upload" | "try" | "validate";
```

Add a `lineNode` state next to the other `useState` hooks in `OnboardingPage`:

```ts
  const [lineNode, setLineNode] = useState<{ id: string; name: string; unsPath: string } | null>(null);
```

Insert an `upload` entry into `STEPS` between `review` and `try` (import the icon `Upload` from `lucide-react` alongside the existing icons):

```ts
  { id: "review",  label: "Review & finish", icon: Sparkles },
  { id: "upload",  label: "Upload a manual", icon: Upload },
  { id: "try",     label: "Try MIRA",        icon: MessageSquare },
```

(Add `Upload` to the existing `lucide-react` import line.)

- [ ] **Step 2: Make `finish()` capture the line node and advance to `upload`**

Replace the body of `finish()` (lines ~106-123) with:

```ts
  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/wizard/finish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string; lineId?: string; linePath?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.lineId && data.linePath) {
        setLineNode({ id: data.lineId, name: payloads.line?.name ?? "your line", unsPath: data.linePath });
      }
      advance("upload");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinishing(false);
    }
  }
```

- [ ] **Step 3: Render the upload step in the step switch**

Between the `review` block and the `try` block (after the `ReviewStep` JSX, before `TryStep`), add:

```tsx
        {activeStep === "upload" && (
          <UploadStep
            lineNode={lineNode}
            onContinue={() => advance("try")}
          />
        )}
```

- [ ] **Step 4: Verify type-check fails on the missing component (expected)**

Run: `cd mira-hub && npx tsc --noEmit`
Expected: FAIL — `UploadStep` is not defined yet (added in Task 4). This confirms the wiring references the component.

- [ ] **Step 5: Commit (after Task 4 makes it compile — see Task 4 Step 5)**

(No commit here; Task 3 + Task 4 land together so the tree compiles.)

---

## Task 4: The `UploadStep` component (upload → wait-until-ready → Ask MIRA)

**Files:**
- Modify: `mira-hub/src/app/(hub)/onboarding/page.tsx` (add the `UploadStep` function + `NodeChat` import)

**Context:** Native `<input type="file">` (trust-signal widget). On submit: POST to `/api/uploads/local` with `file` + `unsPath = lineNode.unsPath`. Poll `/api/uploads/[id]` every 2s; use `isManualReady` to decide done. On ready, render `<NodeChat nodeId={lineNode.id} nodeName unsPath />` so the user asks their own manual. Always offer "Skip for now" / "Continue".

- [ ] **Step 1: Add imports at the top of `onboarding/page.tsx`**

```ts
import { NodeChat } from "@/components/namespace/NodeChat";
import { isManualReady } from "@/lib/onboarding-flow";
import type { UploadStatus } from "@/lib/uploads";
import { Upload as UploadIcon } from "lucide-react"; // if not already importing Upload
```

(If `Upload` was already imported for the stepper icon in Task 3, reuse it; do not double-import. Use one name consistently.)

- [ ] **Step 2: Write the `UploadStep` component**

Add near the other step components (e.g., after `ValidateStep`):

```tsx
type UploadPhase = "idle" | "uploading" | "processing" | "ready" | "error";

function UploadStep({
  lineNode,
  onContinue,
}: {
  lineNode: { id: string; name: string; unsPath: string } | null;
  onContinue: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Poll an upload id until the manual is searchable, then flip to "ready".
  function pollUntilReady(uploadId: string) {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`${API_BASE}/api/uploads/${uploadId}`, { cache: "no-store" });
        const row = res.ok
          ? ((await res.json()) as { status?: string; knowledge_chunks_count?: number })
          : null;
        if (row?.status === "failed" || row?.status === "cancelled") {
          setErrMsg("Processing failed for that file. Try a different PDF.");
          setPhase("error");
          return;
        }
        if (row && isManualReady({ status: String(row.status ?? "") as UploadStatus, knowledge_chunks_count: Number(row.knowledge_chunks_count ?? 0) })) {
          setPhase("ready");
          return;
        }
      } catch {
        // transient — keep polling
      }
      if (!stopped) setTimeout(tick, 2000);
    };
    void tick();
    return () => { stopped = true; };
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !lineNode) return;
    setErrMsg(null);
    setPhase("uploading");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("unsPath", lineNode.unsPath);
      const res = await fetch(`${API_BASE}/api/uploads/local`, { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPhase("processing");
      pollUntilReady(data.id);
    } catch (e) {
      setErrMsg((e as Error).message);
      setPhase("error");
    }
  }

  // Defensive: if the wizard somehow reached this step without a line node,
  // don't dead-end the user — let them continue.
  if (!lineNode) {
    return (
      <div className="space-y-4" data-testid="step-upload">
        <p className="text-sm text-slate-600">Your namespace is ready. You can upload a manual any time from Knowledge → Manuals.</p>
        <NavButtons rightLabel="Continue" onRight={onContinue} rightTestId="onboarding-upload-continue" />
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div className="space-y-4" data-testid="step-upload-ready">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <UploadIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Your manual is ready.</h2>
            <p className="mt-1 text-sm text-slate-600">
              Ask a real question about <span className="font-medium text-slate-900">{lineNode.name}</span> — MIRA answers from the manual you just uploaded, with citations.
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200" data-testid="onboarding-node-chat">
          <NodeChat nodeId={lineNode.id} nodeName={lineNode.name} unsPath={lineNode.unsPath} />
        </div>
        <NavButtons rightLabel="Continue" onRight={onContinue} rightTestId="onboarding-upload-continue" />
      </div>
    );
  }

  const busy = phase === "uploading" || phase === "processing";

  return (
    <form onSubmit={onUpload} className="space-y-5" data-testid="step-upload">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Upload your equipment manual</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload a PDF manual for {lineNode.name}. MIRA reads it so it can answer your
          troubleshooting questions with citations from your own document.
        </p>
      </div>

      <Field label="Manual (PDF)" hint="Max 20 MB.">
        <input
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          data-testid="onboarding-upload-input"
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
        />
      </Field>

      {phase === "processing" && (
        <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900" data-testid="onboarding-upload-processing">
          <Loader2 className="h-4 w-4 animate-spin" /> Extracting &amp; indexing your manual…
        </div>
      )}
      {errMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" data-testid="onboarding-upload-error">
          {errMsg}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
          data-testid="onboarding-upload-skip"
        >
          Skip for now
        </button>
        <button
          type="submit"
          disabled={!file || busy}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="onboarding-upload-submit"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {phase === "uploading" ? "Uploading…" : phase === "processing" ? "Processing…" : "Upload manual"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Type-check the whole file**

Run: `cd mira-hub && npx tsc --noEmit`
Expected: PASS for `onboarding/page.tsx` (the Task 3 reference to `UploadStep` now resolves).

- [ ] **Step 4: Lint**

Run: `cd mira-hub && npx eslint "src/app/(hub)/onboarding/page.tsx" "src/app/(hub)/feed/page.tsx" src/lib/onboarding-flow.ts`
Expected: no errors.

- [ ] **Step 5: Commit (Tasks 3 + 4 together)**

```bash
git add "mira-hub/src/app/(hub)/onboarding/page.tsx"
git commit -m "feat(hub): onboarding upload step — upload manual, wait until ready, Ask MIRA on it (#1901)"
```

---

## Task 5: Beta-gate e2e (Playwright)

**Files:**
- Create: `mira-hub/tests/e2e/onboarding-upload-ask-1901.spec.ts`

**Context:** Drives a real browser through the gate. Requires a running hub + a signed-in fresh tenant. Follow the auth/setup pattern in `mira-hub/tests/e2e/audit-setup.ts` (reuse its session/login helper rather than re-implementing auth). Use a real manual fixture (a small PDF). Keep the chat assertion tolerant of ingest latency via Playwright's auto-wait + an explicit long timeout on the citation locator.

- [ ] **Step 1: Write the e2e spec**

```ts
// mira-hub/tests/e2e/onboarding-upload-ask-1901.spec.ts
// Beta-gate (#1901): fresh tenant → onboarding → upload manual → wait ready → cited answer.
//
// Run: cd mira-hub && npx playwright test tests/e2e/onboarding-upload-ask-1901.spec.ts
//
// Requires BASE_URL (or playwright.config baseURL) pointing at a running hub and the
// shared auth helper to establish a FRESH-tenant session. See audit-setup.ts.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { signInFreshTenant } from "./audit-setup"; // reuse existing helper; adapt name to the real export

const MANUAL_FIXTURE = path.join(__dirname, "fixtures", "gs10-manual.pdf");

test("fresh tenant uploads a manual and gets a cited answer", async ({ page }) => {
  await signInFreshTenant(page);            // lands authenticated, 0-namespace

  // 1. Auto-redirect into onboarding from the feed.
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });

  // 2. Run the wizard to the upload step.
  await page.getByTestId("input-company-name").fill("Harper QA Co");
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("input-site-name").fill("QA Plant");
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("input-line-name").fill("Sorting Line");
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-finish").click();

  // 3. Upload the manual.
  await expect(page.getByTestId("step-upload")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("onboarding-upload-input").setInputFiles(MANUAL_FIXTURE);
  await page.getByTestId("onboarding-upload-submit").click();

  // 4. Processing → ready (allow real ingest latency).
  await expect(page.getByTestId("onboarding-upload-processing")).toBeVisible();
  await expect(page.getByTestId("step-upload-ready")).toBeVisible({ timeout: 180_000 });

  // 5. Ask MIRA about the uploaded manual; assert a citation appears.
  const chat = page.getByTestId("onboarding-node-chat");
  await chat.getByRole("textbox").fill("What fault codes does this manual list?");
  await chat.getByRole("textbox").press("Enter");
  // NodeChat renders sources/citations for grounded answers.
  await expect(chat.getByText(/source|citation|p\.\s?\d+|page\s?\d+/i).first()).toBeVisible({ timeout: 120_000 });
});
```

- [ ] **Step 2: Add a small PDF fixture**

Place a real, small (<1 MB) equipment manual PDF at `mira-hub/tests/e2e/fixtures/gs10-manual.pdf` (reuse an existing repo fixture if one is present under `tests/` — search first: `git ls-files "*.pdf" | head`). If none exists, add one and `git add` it.

- [ ] **Step 3: Confirm/adjust the auth helper import**

Open `mira-hub/tests/e2e/audit-setup.ts` and use its real exported sign-in helper name. If it does not expose a fresh-tenant sign-in, follow its login pattern inline in the spec (do not hardcode prod credentials — use the test env vars the other specs use).

- [ ] **Step 4: Run the e2e (against a running hub)**

Run: `cd mira-hub && npx playwright test tests/e2e/onboarding-upload-ask-1901.spec.ts --reporter=line`
Expected: PASS — final assertion (citation visible) is the beta-gate proof. If it fails at the citation step, the upload→retrieval linkage (chunk `uns_path` tagging vs `retrieveNodeChunks` subtree scope) is the suspect — capture the chat response and the `/api/uploads/[id]` final JSON, then fix the tagging before claiming done (do not weaken the assertion).

- [ ] **Step 5: Commit**

```bash
git add mira-hub/tests/e2e/onboarding-upload-ask-1901.spec.ts mira-hub/tests/e2e/fixtures/gs10-manual.pdf
git commit -m "test(hub): e2e beta-gate — fresh tenant upload→cited-answer (#1901)"
```

---

## Task 6: Screenshots, version bump, changelog

**Files:**
- Modify: `mira-hub/package.json`, `mira-hub/CHANGELOG.md`
- Add: `docs/promo-screenshots/2026-06-15_onboarding-upload-ask_desktop.png`, `…_mobile.png`

- [ ] **Step 1: Capture screenshots (Screenshot Rule)**

With the hub running, capture the upload step (idle, processing, ready-with-cited-answer) at desktop (1440×900) and mobile (412×915). Save to `docs/promo-screenshots/` with dated names:
`2026-06-15_onboarding-upload-step_desktop.png`, `2026-06-15_onboarding-cited-answer_desktop.png`, and the `_mobile.png` variants. (On this Windows host, prefer `chrome --headless=new --screenshot=…` per the project note if Playwright CDP times out.)

- [ ] **Step 2: Bump version + changelog**

Edit `mira-hub/package.json` `version` (minor bump — new user-visible feature). Append a `CHANGELOG.md` entry:

```
## <new-version> — 2026-06-15
- feat(hub): onboarding now guides a fresh customer to upload their manual and ask MIRA a cited question about it; un-onboarded tenants are auto-sent to the wizard (#1901).
```

- [ ] **Step 3: Run the full hub unit suite (regression check)**

Run: `cd mira-hub && npx vitest run`
Expected: the new `onboarding-flow` tests pass; no previously-green test turns red (report net pass/fail vs `origin/main`; pre-existing failures are not this PR's regressions).

- [ ] **Step 4: Commit**

```bash
git add mira-hub/package.json mira-hub/CHANGELOG.md docs/promo-screenshots/2026-06-15_onboarding-*.png
git commit -m "chore(hub): release + promo screenshots for onboarding upload→ask (#1901)"
```

- [ ] **Step 5: Open PR (requires explicit user approval before merge)**

```bash
git push -u origin feat/onboarding-upload-ask-1901
gh pr create --title "feat(hub): onboarding upload→ask — beta-gate close (#1901)" \
  --body "Closes #1901. Auto-redirect un-onboarded tenants to the wizard; add an upload step that waits until the manual is searchable then opens Ask MIRA on it (cited answer from the customer's own manual). Reuses /api/uploads/local + NodeChat. e2e asserts the cited answer. Screenshots in docs/promo-screenshots/."
```

Do NOT merge without explicit user approval (PR Workflow rule).

---

## Self-Review

**Spec coverage:**
- Auto-launch fresh tenant → Task 2 (+ helper Task 1). ✓
- Upload step wired to ingest with namespace attachment → Tasks 3–4 (`unsPath = linePath`). ✓
- Wait-until-ready before chat → Task 4 poll + `isManualReady` (Task 1). ✓
- Drop into Ask MIRA on the customer's own manual → Task 4 (`<NodeChat>` for the line node). ✓
- Cited-answer verification → Task 5 e2e. ✓
- Screenshot rule / versioning → Task 6. ✓
- Non-goals (no new upload API, no cloud pickers, no ingest change) → honored. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; the only deliberate "find the real name" steps are Task 5 Step 2/3 (existing PDF fixture / auth helper export) — these are lookups in existing test infra, with explicit fallbacks, not unspecified requirements.

**Type consistency:** `lineNode: { id, name, unsPath }` is produced in Task 3 (`finish()` from `{ lineId, linePath }`) and consumed identically in Task 4 `UploadStep`. `isManualReady`/`shouldRedirectToOnboarding` signatures match Task 1 across Tasks 2 and 4. `UploadPhase` union is self-contained in Task 4. Upload id field is `data.id` (matches POST `/api/uploads/local` 201 body) and the poll reads `status`/`knowledge_chunks_count` (matches GET `/api/uploads/[id]`).
