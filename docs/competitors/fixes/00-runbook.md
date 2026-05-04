# Pre-merge fixes — runbook

Reviewed 2026-04-25 by direct code read. Each fix below was verified to
correspond to a real bug in the named branch (not just inferred from
AGENT_NOTES). Fixes include the patch, the test, and verification steps.

## Retractions (false alarms from earlier review)

- **#578 audit-log immutability** — actually already protected. The
  migration creates a `BEFORE UPDATE OR DELETE` trigger on
  `tenant_audit_log` that raises an exception. UPDATE/DELETE from any
  app role fails. Strong design — well done. Withdrawing the prior
  finding. The integration test in `auth-sweep/04-rls-deny.test.ts`
  case 8 still works as a regression guard.

## Apply order (binding)

| Order | Fix | Branch | Severity | Effort |
|---|---|---|---|---|
| 1 | [01-574-llm-keys-rotation.md](01-574-llm-keys-rotation.md) | #574 | 🔴 Sec | 1.5h |
| 2 | [02-574-sse-cancel.md](02-574-sse-cancel.md) | #574 | 🚫 Func | 45min |
| 3 | [03-574-safety-keywords.md](03-574-safety-keywords.md) | #574 | 🔴 Sec | 30min |
| 4 | [04-574-pii-sanitizer.md](04-574-pii-sanitizer.md) | #574 | ⚠️ High | 30min |
| 5 | [05-576-cron-timing.md](05-576-cron-timing.md) | #576 | 🔴 Sec | 10min |
| 6 | [06-579-rebase-sso-libs.md](06-579-rebase-sso-libs.md) | #578↔#579 | 🚫 Func | 30min |
| 7 | [07-579-jit-email-verified.md](07-579-jit-email-verified.md) | #579 | 🔴 Sec | 30min |
| 8 | [08-568-idempotent-seed.md](08-568-idempotent-seed.md) | #568 | 🚫 Func | 45min |
| 9 | [09-565-force-skip-guard.md](09-565-force-skip-guard.md) | #565 | ⚠️ High | 30min |
| 10 | [10-562-slug-fallback.md](10-562-slug-fallback.md) | #562 | ⚠️ High | 15min |

**Total: ~5–6 hours of focused work.** Each file is self-contained: drop in the patch, run the test, commit.

## Sequencing constraints

- All fixes can be applied to their respective branches independently.
- #6 (rebase SSO libs) is the only one that touches two branches simultaneously — must apply before either #578 or #579 lands.
- #1 (#574 KEK rotation) MUST land **before any real customer key is stored**. After that point, the fix becomes a customer-impacting outage migration.
- #5 (#576 cron timing-safe) is a 4-line edit — apply first, no excuse.

## Quality gate per fix

Each numbered fix file has these sections — DO NOT MERGE until every checkbox is ticked:

- [ ] Patch applied to the named branch
- [ ] Test file added to `mira-hub/src/**/__tests__/`
- [ ] `npx tsc --noEmit -p mira-hub` passes
- [ ] `npx eslint mira-hub/src --max-warnings 0` passes
- [ ] `npx vitest run <test-file>` passes
- [ ] (For DB changes) integration test passes against ephemeral Postgres

## What's NOT in this directory

These were flagged in the pre-merge review but require investigation/work
that goes beyond a focused patch. Track as separate issues:

- **#574 BYO-LLM provider expansion** — OpenAI/Google currently 501. Real provider implementation is out of scope for a security patch.
- **#578 reserved-subdomain case sensitivity** — needs end-to-end review of slug-validation paths. Add a test, fix once.
- **#578 login rate limiting + lockout** — designs as a separate PR; needs Redis or a `login_attempts` table.
- **#579 SCIM 2.0 + SLO + cert rotation cron** — v2 work, documented in #579 AGENT_NOTES.
- **#580 SOC 2 program deliverables** — 6-month effort, not a patch.

## Verifying the whole tier passes

After applying all 10 fixes:

```bash
# From repo root
for branch in agent/issue-562 agent/issue-565 agent/issue-568 agent/issue-574 agent/issue-576 agent/issue-579; do
  git switch "${branch}-*" 2>/dev/null || continue
  cd mira-hub
  npx tsc --noEmit -p . && npx eslint src --max-warnings 0 && npx vitest run
  cd ..
done
```

A clean run = ready to open PRs in the merge order from `pre-merge-review-2026-04-25.md` §7.
