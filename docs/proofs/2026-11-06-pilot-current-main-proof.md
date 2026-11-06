# Free-pilot experience: current-main reconciliation

Local integration only. No review, actual CI, deployed funnel, recorded consent or customer acceptance is claimed.

- Main: `090c8e15bfcbd85f0091103cf5a6f5fc6b221056`.
- Preserved original #4960: `62920eafd21266238095baef1a0a84cc788493aa`.
- Tested implementation: `52f71d5d18bdc3c5d4158211e964a6cb077388c5`, Hub package 2.54.5. The following proof commit changes only documentation.
- Original branch is unchanged. Codex CLI owns this bounded continuation; #4930 consent, #5126 Terms and #5241 physical acceptance are preserved dependencies.

The existing signup, waiting, onboarding, sample and continuation repair is reconciled with current main. Both PrintSense conflicts preserve the modern capability-backed renderer. The old branch's legacy free-offer presentation failed three current main claim checks. That copy now points neutrally to the canonical application instead; existing claim guards remain intact. Paid consulting remains separate and its receipt grants no product access.

`GET /pilot` now redirects to the existing Hub signup route through the existing `hubUrl` helper. The request cannot select a destination, and query parameters are not forwarded. This fixes the reported dead entry link without introducing another intake form. Attribution across that alias remains unproved. The existing JSON intake, access controls and approval flag are unchanged.

| Check | Local result | Receipt |
|---|---|---|
| Corrected legacy offer conflicts | 3 reproduced failures; all corrected without weakening the claim guard | pilot-honest-copy-red.log, pilot-web-focused-final.log |
| Required web CI command replay | 6 files, 660 pass, 0 fail | pilot-ci-web-replay.log |
| Additional focused web checks | 4 files, 529 pass, 0 fail | pilot-web-focused-final.log |
| Hub offer/access/onboarding/Markdown checks | 6 files, 110 pass | pilot-hub-focused.log |
| Existing real-component browser harness | 40 assertions pass, 412x915 and 1440x1000 | pilot-browser.log |
| Same harness at required geometry | 60 assertions pass, 390x844, 844x390 and 1440x1000 | pilot-browser-geometry.log |
| Actual localhost HTTP entry | 404 before; 302 to app-staging.factorylm.com/signup with staging config, and app.factorylm.com/signup with production default; hostile callback query not forwarded | pilot-route-*.headers |
| Root-path Hub production build | PASS, no provider credentials | pilot-build-root-receipt.json |
| Changed Hub lint / diff / commit hooks | PASS | pilot-hub-lint.log and commit output |

Browser tests render real components and application CSS with synthetic auth/API doubles and an external-request fence. They do not prove server approval, OAuth delivery, persisted consent, indexing, live answers, citations or a physical Android device. Signup portrait and pending landscape captures were visually inspected. No phone was used. Local HTTP servers and browser fixtures were closed after testing.

The complete unconfigured web suite is not green: current main has 1,023 pass / 16 fail; this candidate has 1,027 pass / the same 16 fail. The matched failures concern missing DB configuration and existing registration/QR/entitlement behavior. No new failing test name remains. The required CI workflow explicitly uses the deterministic subset instead of this full suite. This comparison is local and does not waive any red actual CI check.

## Remaining release and product gates

1. New exact-head/body reviews and actual CI are required. Publishing a code PR starts provider review, so only the isolated branch is prepared until its paid scope is authorized.
2. Configured approval-required values are 1 in stg/prd, but running-container values and real applicant/approval behavior are unverified. No flags or access were changed.
3. Signup links Terms/Privacy but does not establish a per-user versioned consent receipt. Existing #4930 v2 wording remains draft; historical v1 records must not be relabeled as proof of displayed text.
4. Public Terms still state legacy prices. Preserve the current Terms and the byte-bound guard until Mike resolves #5126's proposed amendment and the current Terms section 10 notice/effective-date requirement for material changes. Old #4845's paid pilot wording contradicts the selected free pilot and must not be published unchanged. No legal terms or customer communications were changed here.
5. Use the existing exact-SHA staging, generation-matched acceptance and service-scoped production workflows. The production 114 drift dependency and concrete approval/consent/first-answer acceptance must pass before a coherent deployed pilot journey is claimed.

Evidence: `/Users/charlienode/Documents/Codex/2026-11-06/task/codex-digest-fixes-20261106T151723Z-cb3a56`.
