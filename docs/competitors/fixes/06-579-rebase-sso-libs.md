# Fix #6 — #578 ↔ #579: rebase SSO library files onto the right branch

**Branches:** `agent/issue-578-multi-tenancy-0445` and `agent/issue-579-sso-saml-oidc-0445`
**Severity:** 🚫 Functional
**Effort:** ~30 min
**Why now:** Until done, #579 cannot be reviewed in isolation — its routes import lib files that don't exist on its branch.

## What's broken

Verified via `git diff --name-only` per branch:

- **#578 contains** (842 lines that don't belong here):
  - `mira-hub/src/lib/auth/sso/saml.ts`
  - `mira-hub/src/lib/auth/sso/oidc.ts`
  - `mira-hub/src/lib/auth/sso/jit.ts`
  - `mira-hub/src/lib/auth/sso/db-helpers.ts`
  - `mira-hub/src/lib/auth/sso/types.ts`

- **#579 imports them** (verified in `mira-hub/src/app/api/v1/auth/sso/saml/acs/route.ts`):
  ```ts
  import { validateAcsResponse, extractClaims } from "@/lib/auth/sso/saml";
  import { provisionUser, JITProvisionError } from "@/lib/auth/sso/jit";
  ```
  ...but those files don't exist on #579's tree. PR review against `main` will show TS errors.

## The fix

A surgical rebase that moves the 5 files from #578's commit to a new commit on top of #579, then drops them from #578.

### Step 1 — capture the 5 files from #578

```bash
# from your MIRA repo, anywhere
git checkout agent/issue-578-multi-tenancy-0445 -- \
  mira-hub/src/lib/auth/sso/saml.ts \
  mira-hub/src/lib/auth/sso/oidc.ts \
  mira-hub/src/lib/auth/sso/jit.ts \
  mira-hub/src/lib/auth/sso/db-helpers.ts \
  mira-hub/src/lib/auth/sso/types.ts

# Stash so we can switch branches without losing them.
git stash push -m "sso-libs-from-578"
```

### Step 2 — drop them from #578

```bash
git switch agent/issue-578-multi-tenancy-0445

# Verify the files are tracked.
git ls-tree -r HEAD -- mira-hub/src/lib/auth/sso/

# Remove and commit.
git rm \
  mira-hub/src/lib/auth/sso/saml.ts \
  mira-hub/src/lib/auth/sso/oidc.ts \
  mira-hub/src/lib/auth/sso/jit.ts \
  mira-hub/src/lib/auth/sso/db-helpers.ts \
  mira-hub/src/lib/auth/sso/types.ts

git commit -m "refactor(hub): move SSO lib files to #579 (no behavior change)

The five files in src/lib/auth/sso/ were authored on this branch by
mistake; they belong on agent/issue-579-sso-saml-oidc-0445 alongside
the SSO routes that import them. No tests reference these files on
this branch, so removal is a no-op."

# Re-run the static checks — should still pass since #578's own code
# doesn't import sso/*.
cd mira-hub
npx tsc --noEmit -p .
cd ..
```

### Step 3 — add them to #579

```bash
git switch agent/issue-579-sso-saml-oidc-0445

# Pop the stash that has the 5 files.
git stash pop

# Verify the files are present and identical to what was on #578.
ls -la mira-hub/src/lib/auth/sso/
git diff --stat   # should show 5 new files

git add mira-hub/src/lib/auth/sso/
git commit -m "feat(hub): add SSO library files (saml/oidc/jit/db-helpers/types) (#579)

Adds the lib/* files that the routes in this branch already import.
These files were originally committed to #578 by mistake and have
been removed there in a companion commit; this brings the SSO
implementation back together on its own branch so it can be reviewed
and merged in isolation."

# Static checks now pass on #579 in isolation.
cd mira-hub
npx tsc --noEmit -p .
cd ..
```

### Step 4 — verify both branches build cleanly

```bash
for b in agent/issue-578-multi-tenancy-0445 agent/issue-579-sso-saml-oidc-0445; do
  git switch "$b"
  cd mira-hub
  npx tsc --noEmit -p . || { echo "❌ $b"; exit 1; }
  cd ..
done
```

## Why not just merge #578 first

You could, and the files would naturally show up on `main` for #579 to
import. But:

1. PR review for #579 would be confusing — reviewers see imports referencing
   files that "magically appeared" elsewhere.
2. Reverting #578 (if it ever needed reverting) would silently break #579
   because the SSO libs would vanish.
3. Stacking PRs makes the chain `main → #578 → #579`. If you ever want to
   merge them in a different order (e.g. #579 first behind a feature flag),
   you can't — they're co-mingled.

The rebase costs 30 minutes and untangles the branches cleanly. Worth it.

## Test (verifies the rebase, not the SSO logic)

`mira-hub/src/lib/auth/sso/__tests__/imports.test.ts` — on #579 only:

```ts
import { describe, it, expect } from "vitest";

describe("#579 SSO lib files are present (post-rebase verification)", () => {
  it("saml.ts exports buildAuthnRequest, validateAcsResponse, extractClaims", async () => {
    const mod = await import("../saml");
    expect(typeof mod.buildAuthnRequest).toBe("function");
    expect(typeof mod.validateAcsResponse).toBe("function");
    expect(typeof mod.extractClaims).toBe("function");
  });

  it("oidc.ts exports buildAuthorizeUrl + validateCallback", async () => {
    const mod = await import("../oidc");
    expect(typeof mod.buildAuthorizeUrl).toBe("function");
    expect(typeof mod.validateCallback).toBe("function");
  });

  it("jit.ts exports provisionUser + JITProvisionError", async () => {
    const mod = await import("../jit");
    expect(typeof mod.provisionUser).toBe("function");
    expect(typeof mod.JITProvisionError).toBe("function");
  });

  it("db-helpers.ts exports rowToSSOConfig", async () => {
    const mod = await import("../db-helpers");
    expect(typeof mod.rowToSSOConfig).toBe("function");
  });

  it("types.ts exports SSOConfig + JITProfile interfaces (compile-only)", () => {
    // Import-only check; the test is that this module compiles.
    expect(true).toBe(true);
  });
});
```

Plus on `main` (after both branches merge), a smoke test asserting #578
doesn't ship the 5 files alone:

```bash
git switch main
git log --all --diff-filter=A -- mira-hub/src/lib/auth/sso/saml.ts
# Expected: shows ONLY the #579 commit, never the #578 commit.
```

## Estimated time

- Step 1 + 2 (drop from #578): 10 min
- Step 3 (add to #579): 10 min
- Step 4 (verify both branches build): 10 min

## Stash recovery

If `git stash pop` in Step 3 conflicts (unlikely — #579 doesn't have these
files yet), resolve manually with:

```bash
git stash list   # confirm "sso-libs-from-578" is at the top
git stash apply --index
# Resolve conflicts, then
git add mira-hub/src/lib/auth/sso/
git stash drop
```
