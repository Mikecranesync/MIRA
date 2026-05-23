# Goal Prompt: Namespace Tree — Inline Child Creation + Doc Upload

**Audience:** A future Claude Code session, contractor, or agent picking this up cold.
**Style:** Outcomes-only. No file paths, no API contracts. Figure out implementation yourself.
**Date:** 2026-05-21
**Owner:** Mike Harper (FactoryLM)

---

## Context (what you need to know before starting)

MIRA is an industrial-maintenance SaaS at `app.factorylm.com`. The product is a Slack-first maintenance copilot grounded in a Unified Namespace (UNS) — a tree of the customer's plant: Enterprise → Site → Area → Line → Equipment → Component.

The hub (Next.js app at `mira-hub/`) has a page at `/hub/namespace/` that currently shows this tree as read-only. Users can expand rows, search, see counts, drag-drop to reparent — but they cannot **add** anything. The tree is populated by AI proposals from manual ingest + photo recognition, plus the namespace wizard during onboarding. There is no way for a user to type a new subsystem in directly. This is the gap.

A separate document-ingest pipeline already exists. Manuals, PDFs, and photos get uploaded (via Google Drive picker, Dropbox Chooser, or local upload), parsed by a chunker + embedding worker, and stored as searchable knowledge entries tagged with a UNS path. The pipeline works. We are not changing it.

The customer is a maintenance technician on a noisy plant floor, sometimes with gloves on, often on a phone. Optimize for that user.

## Environment

- **Dev:** Local on CHARLIE Mac Mini.
- **Staging:** `http://165.245.138.91:4101/hub/` (VPS staging stack, separate Docker network, prefix `stg-`).
- **Production:** `https://app.factorylm.com/hub/` (VPS production stack).
- Staging-gate workflow blocks merge to main until smoke + audit checks pass.
- `deploy-staging.yml` deploys feature branches to staging on workflow_dispatch.
- `deploy-vps.yml` deploys main to production.

## Hard constraints (do not violate)

1. **Don't break the existing read-only tree.** Drag-drop, search, counts, the detail pane on the right — all must keep working exactly as they do now. Verify against the current behavior before each commit.
2. **Mobile-first.** A technician on an iPhone in a noisy plant with one hand holding a flashlight must be able to add a subsystem and attach a photo of a nameplate. If a feature only works on a 1440px desktop, it is broken.
3. **UNS compliance.** Every new tree node gets a `uns_path` derived from its parent + a slug of the typed name. Use the existing slug rules; do not reinvent them.
4. **Authorization.** Only signed-in users with write access to the tenant can create. Anonymous, expired-session, or wrong-tenant requests get 401/403, never silently succeed.
5. **Audit trail.** Every create writes a row to the namespace versions history so we can answer "who created this and when" without grepping logs.
6. **No new database tables.** The schemas you need (tree entities, history log, uploads) already exist. If you find yourself wanting a migration, stop and ask.
7. **Don't auto-promote anything.** This is human-driven creation, not an AI proposal. Things you create here go straight to "verified" status, not "proposed."
8. **Re-use the existing upload pipeline.** Do not write a second parser, a second chunker, or a second storage path. Plumb the new UI into the existing endpoints.

## What the user must see (acceptance criteria)

A user lands on `/hub/namespace/`. The tree shows their existing subsystems.

1. **Every row in the tree has a `+` button at the far right of the row.** The button is visible without hovering or right-clicking — touch users have to see it the moment the row paints. Tap target ≥44×44 px so it works under gloves.

2. **Tapping `+` opens a form right under that row, indented as a child would be.** The form has:
   - A type dropdown with the choices: Site, Area, Line, Equipment, Component, Namespace, Custom. "Custom" reveals a small text input where the user types a free-form type name.
   - A required Name field.
   - A read-only preview of the path the new subsystem will get (e.g., `enterprise.knowledge_base.your_typed_name`). The preview updates live as the user types the name.
   - A three-option file attach: Google Drive, Dropbox, Upload-from-this-device. The user can pick one source and select one file. After picking, the filename + size appear with a remove (✕) button so the user can change their mind before saving.
   - A Save button.
   - A Cancel button. Cancel discards everything, closes the form, no row is created.

3. **Hitting Save with valid input:**
   - If a file was attached, the file uploads first. While uploading, the form shows "Uploading… (filename)" and the Save button is disabled.
   - After upload finishes (or immediately if no file), the new subsystem is created under the parent.
   - The tree refreshes so the new row appears in its real spot, sorted with its siblings.
   - The form closes.
   - A small toast says "Created" with the new path.
   - The attached file (if any) is now bound to the new subsystem's UNS path and gets fed into the existing parsing pipeline automatically. The user does not need to click anything else.

4. **Validation, in real time:**
   - Empty Name → red text under the Name field: "Name is required." Save disabled.
   - Type not picked → red text under the dropdown: "Pick a type." Save disabled.
   - File >20 MB → red text under the Attach section: "File is too big. Limit is 20 MB."
   - File of unsupported type → red text: "We can only ingest PDFs and images right now."
   - Duplicate name at same parent → red text under Name: "A subsystem named '<X>' already exists here." (Server-checked on save; client should also do best-effort check against the current tree.)

5. **Errors:**
   - Parent deleted in another tab → toast "This parent no longer exists. Refreshing tree." Tree refetches. Form closes.
   - Session expired → page redirects to login with a callback back to `/namespace`.
   - Network timeout on upload → "Upload took too long. Try again." with a Retry button. New subsystem is NOT created in this case.
   - Network timeout on create → "Couldn't save. Try again." Retry available.
   - Unhandled server error → "Something broke on our side. We've been notified." Error reported to whatever logging the rest of the app uses.

6. **What does NOT exist in this ship (deferred to Option B / C):**
   - No multi-file upload. One file per save.
   - No "Save + Add Another" button. Save closes the form. To add another sibling, the user taps `+` on the parent again.
   - No bulk-paste / CSV import path.
   - No slug-edit affordance. The slug is derived from the name; the user cannot override it.
   - No depth limit beyond what the database enforces.

## How we'll know it works (E2E staging tests)

Write a Playwright test suite that runs against `http://165.245.138.91:4101/hub/namespace/`. The suite must include and pass these scenarios. Each scenario starts from a signed-in admin session on a clean test tenant.

**Scenario 1 — Happy path, no file.**
1. Open `/hub/namespace/`. Confirm tree renders with the existing Enterprise root.
2. Tap the `+` button at the right of the Enterprise row. Confirm the inline form opens directly under it, indented like a child.
3. In the type dropdown, pick "Site."
4. In the Name field, type "Plant A".
5. Confirm the path preview reads `enterprise.plant_a`.
6. Tap Save.
7. Confirm a "Created" toast appears.
8. Confirm a new "Plant A" row appears under Enterprise, with kind label "site."
9. Refresh the page. Confirm Plant A is still there (persisted to DB).

**Scenario 2 — Happy path, with file (local upload).**
1. Pre-stage: have a 1MB sample PDF named `nameplate.pdf` in the test fixtures.
2. Open `/hub/namespace/`. Tap `+` on the new Plant A row.
3. Type: Area. Name: "Compressor Room."
4. Tap "Upload from this device." Pick `nameplate.pdf`. Confirm filename + size appear next to a ✕ button.
5. Tap Save. Confirm the form shows "Uploading… (nameplate.pdf)" while it runs.
6. After save, confirm the new row appears. Confirm the toast says "Created."
7. Independently query the staging uploads table (via the staging API or DB read) and confirm there is one row with `uns_path = 'enterprise.plant_a.compressor_room'` and a non-null upload status. (You do not need to wait for parsing to complete in this test — just verify the binding happened.)

**Scenario 3 — Validation: empty name.**
1. Open form on any row. Type dropdown: "Line." Leave Name empty.
2. Tap Save. Confirm Save is either disabled OR a red error appears under the Name field reading "Name is required."
3. No new row appears in the tree.

**Scenario 4 — Validation: duplicate name at same parent.**
1. Pre-stage: a subsystem "Line 1" already exists under Plant A.
2. Open form on Plant A. Type: Line. Name: "Line 1." Save.
3. Confirm red error: "A subsystem named 'Line 1' already exists here." or similar.
4. Tree is unchanged.

**Scenario 5 — Cancel discards.**
1. Open form on any row. Type: Equipment. Name: "Test." Attach a file.
2. Tap Cancel.
3. Confirm form closes, no new row appears, no upload was persisted (or if it was uploaded, it has no UNS binding and gets cleaned by the orphan janitor).

**Scenario 6 — Auth.**
1. With no session, attempt to call the create endpoint directly. Confirm 401.
2. With a valid session for tenant A, attempt to create under a parent owned by tenant B (look up a known parent ID in another tenant). Confirm 403 or 404 — do not silently succeed.

**Scenario 7 — Audit log written.**
1. After Scenario 1's save, query the staging `namespace_versions` table (via the staging API). Confirm there is a row with operation = "create", entity_id = the new Plant A node, actor = the test user, and timestamps populated.

**Scenario 8 — Mobile viewport.**
1. Configure Playwright to use an iPhone 14 viewport.
2. Run Scenario 1 again at that viewport.
3. Confirm the `+` button is tappable (≥44px hit target). Confirm the inline form fits without horizontal scroll. Confirm the path preview wraps gracefully if long.
4. Screenshot the form open state and save to `docs/promo-screenshots/2026-05-21_namespace-inline-create_mobile.png`.

**Scenario 9 — Existing functionality not regressed.**
1. Confirm drag-drop reparent still works (drag Plant A onto Enterprise's sibling — should be allowed; drag Enterprise onto Plant A — should error).
2. Confirm search still filters the tree.
3. Confirm the right-side detail pane still renders for a selected node.
4. Confirm `GET /api/namespace/tree` still returns the same shape it does today (no breaking changes to the response).

## Workflow

1. Branch from `main` named `feat/namespace-inline-create`.
2. Implement, iterate, push.
3. Open PR against `main`. Title: "feat(hub): inline child create + doc attach on /namespace tree."
4. Bump `mira-hub/package.json` version (minor — this is a feature). Add a `CHANGELOG.md` entry summarizing what changed.
5. Wait for CI: staging-gate must be green. The 9-scenario Playwright suite must run as part of CI (add it to the existing E2E job in the CI workflow, do not create a new workflow).
6. Once CI green, trigger staging deploy: `gh workflow run deploy-staging.yml -f services=mira-hub --ref feat/namespace-inline-create`.
7. Wait for staging deploy to complete. Phone-probe `http://165.245.138.91:4101/hub/namespace/` from a real phone. Run Scenarios 1, 2, 4, 5 manually. Capture mobile screenshots into `docs/promo-screenshots/` with today's date.
8. Post the staging URL + screenshots in the PR description. Ask Mike to do his own phone-probe.
9. Once Mike approves, squash-merge the PR.
10. Tag `mira-hub/v<new-version>` at the merge commit. Push the tag.
11. Trigger prod deploy: `gh workflow run deploy-vps.yml -f services=mira-hub`.
12. Verify prod: `curl -sI https://app.factorylm.com/hub/namespace/` should redirect through auth (HTTP 301 → /login or 200 if session). Confirm no 5xx.
13. Update the spec doc at `docs/superpowers/specs/2026-05-21-namespace-tree-inline-create-and-card-design.md` (if it doesn't exist, write it from the brainstorming session this prompt came from) with a "Shipped" note pointing at the merge commit + tag.

## Done means

- PR merged to main.
- All 9 Playwright scenarios passing in CI.
- Staging gate green.
- Mike has phone-probed staging and approved.
- Production deploy succeeded.
- `mira-hub/v<new-version>` tag exists on the merge commit.
- Mobile screenshots committed to `docs/promo-screenshots/`.
- PR description has links to the screenshots and the staging URL.

## Not done

- "It compiles locally" is not done.
- "Tests pass locally" is not done.
- "Staging deploy ran" without phone-probing the actual page is not done.
- "Mike said it looks good in the PR description" without his own phone-probe is not done.

## When you get stuck

- If you can't make a research call between two patterns, look at what Notion, Linear, MaintainX, or UpKeep do for the same kind of interaction. If multiple of them converge on a pattern, copy it. ("Industry standard" beats "we invented something better.")
- If you need to add a database column, stop and ask. The hard constraint says no migrations.
- If a CI check fails for a reason you don't understand, do not skip hooks or bypass the gate. Investigate root cause.
- If the existing tree breaks during your changes (drag-drop stops working, counts disappear, search throws), revert your last change and re-approach. Do not ship a regression to gain a feature.
- If you're tempted to "while I'm here" refactor adjacent code, don't. Open a follow-up issue.

## Out of scope (do not build, even if you have time)

- Multi-file upload per save. One file per save in this ship.
- "Save + Add Another" button. Out of scope.
- Bulk paste / CSV import. Out of scope.
- Slug edit affordance. Out of scope.
- Inline rename (existing tree rows). Out of scope — the PUT endpoint already exists for this; UI lands in a separate ship.
- Inline delete. Out of scope.
- Drag a file from desktop onto a tree row to upload-and-create-in-one-gesture. Out of scope.
- Voice-to-text for name field. Out of scope (worth considering for a later ship per the research notes).
- Switching to a bottom-sheet drawer if the inline expansion gets cramped at deep nesting. That's a fallback, not v1. v1 ships inline expansion.

---

**End of goal prompt.** Self-contained. Pick this up cold; deliver.
