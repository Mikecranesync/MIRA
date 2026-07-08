# Secret Shopper Issues 2300-2303 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring GitHub issues #2300, #2301, #2302, and #2303 to verified fixed state, with regression coverage, clean issue comments, passing checks, and merge/closure discipline.

**Architecture:** Treat `origin/main` and deployed `/api/version/` as truth before writing code. The Hub issues are mostly already fixed by merged PRs #2206 and #2290, so the work is verification plus missing regression guards and issue closure; the marketing-site pricing issue is no longer a 404 but still redirects `https://factorylm.com/pricing/` to an `http://` Location, so it needs a small canonical redirect follow-up if the team wants a perfect fix.

**Tech Stack:** GitHub CLI, git, Next.js 16 Hub (`mira-hub`), Hono/Bun marketing app (`mira-web`), Vitest, Bun test, Playwright.

## Global Constraints

- Do not use the dirty `/Users/charlienode/MIRA` worktree for implementation; create a fresh worktree from `origin/main`.
- Before writing code, run `git fetch origin main --prune` and verify `git log HEAD..origin/main --oneline` is empty in the implementation worktree.
- Before adding any helper, search local repo, `origin/main`, and merged PRs for the same concept.
- Do not use `git add -A`; stage explicit files only.
- Before merge, run `gh pr checks <num>` and compare any failures against main.
- Do not close #2300, #2301, #2302, or #2303 until the verification command for that issue is attached in a GitHub issue comment.

---

## Current Evidence

- #2300, #2301, #2302, and #2303 are open with no labels as of 2026-06-25.
- `origin/main` is `5c194a8fe239fb2d9317d77b94ea3919763fdb2d`.
- Live Hub `/api/version/` reports `version=3.42.4`, `gitSha=5c194a8fe239fb2d9317d77b94ea3919763fdb2d`, `builtAt=2026-06-25T21:39:08Z`.
- PR #2206 merged `fix(hub): browser-reachable CMMS links + namespace disabled-button hints`.
- PR #2290 merged `fix(hub): unblock namespace and team invites`; all required checks passed.
- PR #2189 merged `fix(web): add trailing-slash trim middleware to fix /pricing/ 404`; all required checks passed.
- Live `https://factorylm.com/pricing/` returns 301 then 200, but the 301 Location is `http://factorylm.com/pricing`.

## File Map

- `mira-hub/src/app/api/cmms/health/route.ts`: returns server-side CMMS configured state and browser-safe public URL for CMMS links.
- `mira-hub/src/app/(hub)/cmms/page.tsx`: renders Open Atlas and quick links from the public URL returned by health.
- `docker-compose.saas.yml`: sets `HUB_CMMS_API_URL` for server-side Docker access and `CMMS_PUBLIC_URL` for browser links.
- `mira-hub/src/app/(hub)/namespace/page.tsx`: renders New Folder and Upload toolbar states plus empty-state CTAs.
- `mira-hub/tests/e2e/namespace-inline-create.spec.ts`: existing E2E coverage for namespace creation, upload binding, and hydration guard.
- `mira-hub/src/app/(hub)/settings/users/page.tsx`: renders self-serve invite form.
- `mira-hub/src/app/api/team/route.ts`: sends invite magic links and enforces admin/owner permission.
- `mira-hub/src/lib/__tests__/users-invites.test.ts`: current unit coverage for invite token metadata and invited-user tenant safety.
- `mira-web/src/server.ts`: marketing app middleware and `/pricing` route.
- `mira-web/src/lib/trailing-slash.ts`: create this only if implementing the HTTPS-preserving redirect helper.
- `mira-web/src/lib/__tests__/trailing-slash.test.ts`: create this only with the redirect helper.

---

### Task 1: Fresh Worktree and Evidence Snapshot

**Files:**
- No code files changed.
- Optional local notes only in the implementation branch PR body.

**Interfaces:**
- Consumes: GitHub issues #2300-#2303, `origin/main`, live `/api/version/`.
- Produces: a clean branch for any required follow-up code and a verified issue state table.

- [ ] **Step 1: Create clean worktree from current main**

Run:

```bash
git -C /Users/charlienode/MIRA fetch origin main --prune
mkdir -p /Users/charlienode/Documents/Codex/worktrees
git -C /Users/charlienode/MIRA worktree add /Users/charlienode/Documents/Codex/worktrees/mira-secret-shopper-2300-2303 origin/main
cd /Users/charlienode/Documents/Codex/worktrees/mira-secret-shopper-2300-2303
git switch -c fix/secret-shopper-2300-2303
git log HEAD..origin/main --oneline
```

Expected: final command prints nothing.

- [ ] **Step 2: Confirm the issues are still open**

Run:

```bash
for n in 2300 2301 2302 2303; do
  gh issue view "$n" --repo Mikecranesync/MIRA --json number,title,state,labels,updatedAt,url \
    --jq '[.number,.state,.title,([.labels[].name]|join(",")),.updatedAt,.url] | @tsv'
done
```

Expected: all four print `OPEN` unless a human closed one after this plan was written.

- [ ] **Step 3: Confirm deployed Hub SHA**

Run:

```bash
curl -sS --max-time 15 https://app.factorylm.com/api/version/
git rev-parse origin/main
```

Expected: the JSON `gitSha` equals `git rev-parse origin/main`.

---

### Task 2: Verify and Close #2300 CMMS Public Links

**Files:**
- Inspect: `mira-hub/src/app/api/cmms/health/route.ts`
- Inspect: `mira-hub/src/app/(hub)/cmms/page.tsx`
- Inspect: `docker-compose.saas.yml`
- Optional test: `mira-hub/src/app/api/cmms/health/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `GET /api/cmms/health/` returns `{ configured, url, missing }`.
- Produces: proof that browser-facing CMMS links use `CMMS_PUBLIC_URL` or `https://cmms.factorylm.com`, never `HUB_CMMS_API_URL`.

- [ ] **Step 1: Re-check reuse before adding tests**

Run:

```bash
git grep -n "CMMS_PUBLIC_URL\|browser-reachable\|cmms-backend" origin/main -- mira-hub docker-compose.saas.yml
gh pr list --repo Mikecranesync/MIRA --state merged --limit 20 --search "cmms-backend public CMMS links"
```

Expected: PR #2206 appears; `route.ts` documents the split between internal `HUB_CMMS_API_URL` and public `CMMS_PUBLIC_URL`.

- [ ] **Step 2: Verify code root cause is fixed on main**

Run:

```bash
git show origin/main:mira-hub/src/app/api/cmms/health/route.ts | sed -n '14,31p'
git show origin/main:mira-hub/src/app/'(hub)'/cmms/page.tsx | sed -n '241,256p'
git show origin/main:docker-compose.saas.yml | sed -n '656,667p'
```

Expected:
- `route.ts` reads `CMMS_PUBLIC_URL` and falls back to `https://cmms.factorylm.com`.
- `cmms/page.tsx` builds quick links from `config.url`.
- `docker-compose.saas.yml` sets `CMMS_PUBLIC_URL=${CMMS_PUBLIC_URL:-https://cmms.factorylm.com}` for the Hub service.

- [ ] **Step 3: Run authenticated browser verification**

Run with the known QA credentials, without printing secrets:

```bash
cd mira-hub
E2E_BASE_URL=https://app.factorylm.com \
E2E_HUB_EMAIL="$E2E_HUB_EMAIL" \
E2E_HUB_PASSWORD="$E2E_HUB_PASSWORD" \
npx playwright test tests/e2e/hub-validation.spec.ts --grep "CMMS|Work Orders|Reports"
```

Expected: CMMS page loads after login. If the spec does not assert link hosts, inspect the page manually in Playwright and record:

```js
await page.locator('a[href*="cmms"]').evaluateAll((els) => els.map((a) => a.href))
```

Expected result contains `https://cmms.factorylm.com/...` and does not contain `cmms-backend`.

- [ ] **Step 4: Add regression test only if missing**

If no route-level guard exists, create `mira-hub/src/app/api/cmms/health/__tests__/route.test.ts` with a mocked `sessionOr401` and this assertion:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "tenant-1", userId: "user-1" })),
}));

describe("/api/cmms/health", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.HUB_CMMS_API_URL = "http://cmms-backend:8080";
    process.env.CMMS_PUBLIC_URL = "https://cmms.factorylm.com";
    process.env.ATLAS_API_USER = "atlas@example.com";
    process.env.ATLAS_API_PASSWORD = "secret";
  });

  it("returns a browser-reachable public URL instead of the internal Docker host", async () => {
    const { GET } = await import("../route");
    const res = await GET();
    expect(res).toBeInstanceOf(NextResponse);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.url).toBe("https://cmms.factorylm.com");
    expect(body.url).not.toContain("cmms-backend");
  });
});
```

Run:

```bash
cd mira-hub
bunx vitest run src/app/api/cmms/health/__tests__/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Comment and close #2300 if verification passes**

Run:

```bash
gh issue comment 2300 --repo Mikecranesync/MIRA --body "Verified fixed on deployed Hub gitSha $(curl -sS https://app.factorylm.com/api/version/ | jq -r .gitSha). /api/cmms/health now returns the browser-safe CMMS_PUBLIC_URL, compose sets CMMS_PUBLIC_URL=https://cmms.factorylm.com, and authenticated browser inspection shows CMMS quick links do not contain cmms-backend."
gh issue close 2300 --repo Mikecranesync/MIRA --reason completed
```

Expected: issue #2300 closes as completed.

---

### Task 3: Verify and Close #2301 Namespace Disabled Buttons

**Files:**
- Inspect: `mira-hub/src/app/(hub)/namespace/page.tsx`
- Test: `mira-hub/tests/e2e/namespace-inline-create.spec.ts`

**Interfaces:**
- Consumes: namespace toolbar `data-testid="toolbar-new-folder"` and `data-testid="toolbar-upload"`.
- Produces: proof that New Folder enables after tree load and Upload explains/select-gates correctly.

- [ ] **Step 1: Verify code state**

Run:

```bash
git show origin/main:mira-hub/src/app/'(hub)'/namespace/page.tsx | sed -n '349,375p'
git show origin/main:mira-hub/src/app/'(hub)'/namespace/page.tsx | sed -n '1188,1211p'
```

Expected:
- New Folder is disabled only while `loading` and has title `Loading namespace...`.
- Upload is disabled only when no folder is selected and has title `Select a folder first, then upload files into it`.
- Empty namespace shows a root `New Folder` CTA and an `Upload manual` link to `/documents`.

- [ ] **Step 2: Run existing E2E coverage**

Run:

```bash
cd mira-hub
E2E_HUB_EMAIL="$E2E_HUB_EMAIL" \
E2E_HUB_PASSWORD="$E2E_HUB_PASSWORD" \
npx playwright test tests/e2e/namespace-inline-create.spec.ts --grep "Scenario 12|Upload"
```

Expected:
- Scenario 12 proves New Folder is disabled only during tree load, then enabled.
- Upload scenario proves selecting a node allows file upload and binds the file to the selected node.

- [ ] **Step 3: Comment and close #2301 if verification passes**

Run:

```bash
gh issue comment 2301 --repo Mikecranesync/MIRA --body "Verified fixed on deployed Hub gitSha $(curl -sS https://app.factorylm.com/api/version/ | jq -r .gitSha). New Folder is disabled only during initial tree load with title guidance; Upload is disabled until a folder is selected with explicit title guidance; the empty namespace state provides New Folder and Upload manual CTAs. Regression covered by namespace-inline-create Scenario 12 plus upload binding coverage."
gh issue close 2301 --repo Mikecranesync/MIRA --reason completed
```

Expected: issue #2301 closes as completed.

---

### Task 4: Verify and Close #2302 Team Invite UI

**Files:**
- Inspect: `mira-hub/src/app/(hub)/settings/users/page.tsx`
- Inspect: `mira-hub/src/app/api/team/route.ts`
- Test: `mira-hub/src/lib/__tests__/users-invites.test.ts`

**Interfaces:**
- Consumes: `POST /api/team/` with `{ email, role }`.
- Produces: proof that Settings -> Users has an invite-by-email form and API permission checks.

- [ ] **Step 1: Verify UI and API code state**

Run:

```bash
git show origin/main:mira-hub/src/app/'(hub)'/settings/users/page.tsx | sed -n '88,176p'
git show origin/main:mira-hub/src/app/api/team/route.ts | sed -n '88,154p'
```

Expected:
- UI has `Invite member`, `team-invite-form`, email input, role select, and `Send invite`.
- API validates email, role, admin/owner permission, tenant collision, creates a magic token, and sends an email when `RESEND_API_KEY` is set.

- [ ] **Step 2: Run invite unit coverage**

Run:

```bash
cd mira-hub
bunx vitest run src/lib/__tests__/users-invites.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run authenticated browser verification**

Run:

```bash
cd mira-hub
E2E_BASE_URL=https://app.factorylm.com \
E2E_HUB_EMAIL="$E2E_HUB_EMAIL" \
E2E_HUB_PASSWORD="$E2E_HUB_PASSWORD" \
npx playwright test tests/e2e/hub-validation.spec.ts --grep "Invite User|Users"
```

Expected: Settings -> Users exposes an invite action. If the existing spec still checks legacy `/admin/users`, add a focused production smoke or manually verify `/settings/users/` in Playwright:

```js
await page.goto("https://app.factorylm.com/settings/users/");
await page.getByRole("button", { name: /invite member/i }).click();
await expect(page.getByTestId("team-invite-form")).toBeVisible();
```

- [ ] **Step 4: Comment and close #2302 if verification passes**

Run:

```bash
gh issue comment 2302 --repo Mikecranesync/MIRA --body "Verified fixed on deployed Hub gitSha $(curl -sS https://app.factorylm.com/api/version/ | jq -r .gitSha). Settings -> Users now exposes an Invite member flow with email and role fields; POST /api/team validates admin/owner permission, tenant collisions, and invite magic-token creation. Unit coverage: mira-hub/src/lib/__tests__/users-invites.test.ts."
gh issue close 2302 --repo Mikecranesync/MIRA --reason completed
```

Expected: issue #2302 closes as completed.

---

### Task 5: Fix or Reclassify #2303 Pricing Trailing Slash

**Files:**
- Modify: `mira-web/src/server.ts`
- Create: `mira-web/src/lib/trailing-slash.ts`
- Create: `mira-web/src/lib/__tests__/trailing-slash.test.ts`

**Interfaces:**
- Consumes: Hono request URL and proxy headers.
- Produces: canonical trailing-slash redirect that preserves `https://factorylm.com`.

- [ ] **Step 1: Verify current live behavior**

Run:

```bash
curl -sS -I --max-time 15 https://factorylm.com/pricing/ | sed -n '1,12p'
curl -sS -I --max-time 15 https://factorylm.com/pricing | sed -n '1,12p'
```

Expected today:
- `/pricing/` is not a 404.
- `/pricing/` redirects to `/pricing`, but Location may be `http://factorylm.com/pricing`.
- `/pricing` returns 200.

- [ ] **Step 2: Replace generic Hono slash middleware with proxy-aware helper**

Create `mira-web/src/lib/trailing-slash.ts`:

```ts
function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

export function trailingSlashRedirectTarget(requestUrl: string, headers: Headers): string | null {
  const url = new URL(requestUrl);
  if (url.pathname === "/" || !url.pathname.endsWith("/")) return null;

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";

  const forwardedProto = firstHeaderValue(headers.get("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstHeaderValue(headers.get("host"));

  if (forwardedProto) url.protocol = `${forwardedProto}:`;
  if (host) url.host = host;

  return url.toString();
}
```

Modify `mira-web/src/server.ts`:

```ts
import { trailingSlashRedirectTarget } from "./lib/trailing-slash.js";
```

Remove:

```ts
import { trimTrailingSlash } from "hono/trailing-slash";
```

Replace:

```ts
app.use(trimTrailingSlash());
```

with:

```ts
app.use("*", async (c, next) => {
  const target = trailingSlashRedirectTarget(c.req.url, c.req.raw.headers);
  if (target) return c.redirect(target, 301);
  await next();
});
```

- [ ] **Step 3: Add redirect helper tests**

Create `mira-web/src/lib/__tests__/trailing-slash.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { trailingSlashRedirectTarget } from "../trailing-slash";

describe("trailingSlashRedirectTarget", () => {
  test("returns null for canonical path without trailing slash", () => {
    const headers = new Headers({ host: "factorylm.com", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://127.0.0.1/pricing", headers)).toBeNull();
  });

  test("trims trailing slash and preserves forwarded https origin", () => {
    const headers = new Headers({ host: "factorylm.com", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://127.0.0.1/pricing/", headers)).toBe("https://factorylm.com/pricing");
  });

  test("preserves query string while trimming slash", () => {
    const headers = new Headers({ "x-forwarded-host": "factorylm.com", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://mira-web:3000/pricing/?utm=qa", headers)).toBe("https://factorylm.com/pricing?utm=qa");
  });

  test("does not redirect the root path", () => {
    const headers = new Headers({ host: "factorylm.com", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://127.0.0.1/", headers)).toBeNull();
  });
});
```

Run:

```bash
cd mira-web
bun test src/lib/__tests__/trailing-slash.test.ts
```

Expected: 4 pass.

- [ ] **Step 4: Verify locally**

Run:

```bash
cd mira-web
bun test
bun run src/server.ts
```

In another terminal:

```bash
curl -sS -I -H 'Host: factorylm.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:3000/pricing/ | sed -n '1,12p'
```

Expected: `301` with `Location: https://factorylm.com/pricing`.

- [ ] **Step 5: Commit, PR, checks, deploy**

Run:

```bash
git add mira-web/src/server.ts mira-web/src/lib/trailing-slash.ts mira-web/src/lib/__tests__/trailing-slash.test.ts
git commit -m "fix(web): preserve https in trailing-slash redirects"
git push -u origin fix/secret-shopper-2300-2303
gh pr create --repo Mikecranesync/MIRA --base main --head fix/secret-shopper-2300-2303 --title "fix(web): preserve HTTPS in trailing-slash redirects" --body "Fixes the residual #2303 behavior where /pricing/ no longer 404s but emits an http Location before landing on /pricing. Adds a proxy-aware redirect helper and Bun tests."
gh pr checks "$(gh pr view --json number --jq .number)"
```

Expected: all required checks pass or failures are proven pre-existing on main before merge approval.

- [ ] **Step 6: Verify production and close #2303**

After merge and redeploy:

```bash
curl -sS -I --max-time 15 https://factorylm.com/pricing/ | sed -n '1,12p'
curl -sS -I --max-time 15 https://factorylm.com/pricing | sed -n '1,12p'
```

Expected:
- `/pricing/` returns 301 or 308 with `Location: https://factorylm.com/pricing`.
- `/pricing` returns 200.

Then:

```bash
gh issue comment 2303 --repo Mikecranesync/MIRA --body "Verified fixed in production. https://factorylm.com/pricing/ now redirects to https://factorylm.com/pricing and https://factorylm.com/pricing returns 200. Regression coverage added for proxy-aware HTTPS trailing-slash redirects."
gh issue close 2303 --repo Mikecranesync/MIRA --reason completed
```

Expected: issue #2303 closes as completed.

---

## Final Merge Checklist

- [ ] `git status --short` shows only intended files.
- [ ] New symbol verification is complete for any added helper: `trailingSlashRedirectTarget` is defined and imported exactly once.
- [ ] `cd mira-web && bun test src/lib/__tests__/trailing-slash.test.ts` passes if Task 5 is implemented.
- [ ] `cd mira-hub && bunx vitest run src/lib/__tests__/users-invites.test.ts` passes if invite code is touched.
- [ ] Authenticated Playwright or manual browser proof is attached for #2300, #2301, and #2302 before closing.
- [ ] `gh pr checks <num>` is green, or any red check is confirmed pre-existing on `origin/main` and user-approved before merge.
- [ ] Issue comments include exact deployed SHA or curl output evidence.
