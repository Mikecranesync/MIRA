## Why

The cowork branches (#562, #565, #566, #568, #569, #570, #571, #572, #573, #574, #575, #576, #578, #579) collectively import ~14 packages that are NOT in `mira-hub/package.json`. Today every one of these branches will fail `npm run build` because module resolution can't find them. The chat route, the webhook signing, the SSO routes — all reference imports that aren't installed.

This issue tracks a SINGLE consolidating PR that adds every missing dep + commits the resulting `package-lock.json`. Without it, none of the parity branches can land.

## Source

- `docs/competitors/cowork-gap-report-2026-04-25.md` §3.2
- `docs/competitors/pre-merge-review-2026-04-25.md` §1 (universal blocker #3)
- `docs/competitors/fix-execution-report-2026-04-25.md` (every fix listed vitest as deferred-pending-this)

## Acceptance criteria

### Required dependencies (production)

- [ ] `libsodium-wrappers` (#574 KEK encryption, #576 webhook secret storage) — MIT
- [ ] `@anthropic-ai/sdk` (#574 chat route — currently uses raw fetch, swap when wired) — MIT
- [ ] `jose` (#578 JWT signing/verification — Edge-safe Web Crypto) — MIT
- [ ] `bcrypt` (#578 password hashing for local-auth fallback) — MIT
- [ ] `@node-saml/node-saml` (#579 SAML protocol) — MIT
- [ ] `openid-client` (#579 OIDC) — MIT
- [ ] `xml2js` (#579 SAML response parsing) — MIT
- [ ] `dexie` (#575 IndexedDB offline cache) — Apache 2.0
- [ ] `rrule` (#566 calendar PM scheduling) — BSD-3-Clause
- [ ] `fft-js` (#569 vibration FFT) — Apache 2.0
- [ ] `recharts` (#571 sensor reports + asset charts) — MIT
- [ ] `pdfkit` (#563 QR code label PDF rendering) — MIT
- [ ] `qrcode` (#563 QR code generation) — MIT

### Required dev dependencies

- [ ] `vitest` (every fix branch ships test files; none can run today)
- [ ] `@vitest/expect`
- [ ] `@types/libsodium-wrappers`
- [ ] `@types/bcrypt`
- [ ] `@types/xml2js`
- [ ] `@types/qrcode`
- [ ] `@types/pdfkit`

### Verification

- [ ] `cd mira-hub && npm install` runs clean (no peer-dep warnings beyond what main already had)
- [ ] `npx tsc --noEmit -p .` passes (modulo the pre-existing untouched-file errors documented in `pre-merge-review-2026-04-25.md` §1)
- [ ] `npx eslint src --max-warnings 0` passes
- [ ] `npx vitest run` exits 0 — all 86 unit tests + the 9 integration tests where TEST_DATABASE_URL is set
- [ ] `package-lock.json` committed
- [ ] `package.json` version bump per `mira-hub/AGENTS.md` (minor — meaningful change since deps cross multiple feature surfaces)

### Audit hygiene

- [ ] `npm audit` — no high/critical vulns at install time. If any surface, document the upgrade-or-pin decision per package in the PR body.
- [ ] License audit: every added dep is Apache-2.0, MIT, or BSD per the hard constraint in top-level `CLAUDE.md`. No GPL, no proprietary.

## Dependency order

This PR has NO branch dependencies — it can land on `main` standalone or be cherry-picked into any feature branch. **Recommended:** land on `main` first, then rebase every feature branch on top so they all pick up the new lockfile.

## Out of scope

- Implementation wiring for any of these packages — that's done on the feature branches that already import them.
- Doppler env vars for libs that need keys — see the companion env-vars issue.
