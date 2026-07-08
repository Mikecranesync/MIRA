# #2013 re-check — durable QA account does NOT log in (live, 2026-06-27)

**Surface:** https://app.factorylm.com/login/ (password login)
**Account:** `hermes-qa-maint@example.com` (creds from Doppler `factorylm/dev`: `HERMES_QA_EMAIL`/`HERMES_QA_PASSWORD`)
**Environment:** production, dogfood maintenance-manager pass from CHARLIE.

## Two defects found

### 1. Credentials rejected — account no longer authenticates
Logged in **by hand** in the browser with the exact Doppler creds. Result:
> **"Email or password is incorrect."**

Saved session has only 2 cookies (`__Host-next-auth.csrf-token`, `__Secure-next-auth.callback-url`) and **no `__Secure-next-auth.session-token`** → not authenticated. Console shows a **401** during the login POST.

**Likely root cause:** the account was provisioned **2026-06-16** as an **isolated 7-day trial tenant** (per the resolving comment + `tools/qa/README.md`). Today is **2026-06-27 — 11 days later.** The trial has lapsed, so the "durable" account isn't durable. This is exactly the guarantee #2013 was meant to provide.

### 2. `qa-login-save-state.mjs` reports `ok: true` on failure (false positive)
`dogfood-output/qa-login-save-state.mjs:43` prints `ok: true` **unconditionally**. The `waitForURL` (line 38) has a `.catch()` that swallows the timeout and falls through. It never asserts (a) a `session-token` cookie exists or (b) the URL left `/login`. So a failed login still returns `ok: true` with `url: ".../login/"`.

**This false positive is why the regression was silent** — the 4/4 verification in the resolving comment trusted `ok: true`, which can be true even when login fails.

## Repro
```bash
doppler run --project factorylm --config dev -- bash -c \
  'node dogfood-output/qa-login-save-state.mjs "$HERMES_QA_EMAIL" "$HERMES_QA_PASSWORD"'
# => ok:true, BUT url ends in /login/, 401 in console, no session-token cookie
```

## Fix recommendations
- **Account:** make the QA tenant genuinely durable (non-expiring / auto-renew), or document a re-mint step + alert when it lapses.
- **Helper:** gate `ok:true` on `state.cookies.some(c => c.name.includes('session-token'))` AND `!page.url().includes('/login')`; exit non-zero otherwise. Then the lapse self-reports.

## Impact
Hub dogfood is blocked again (no auth) AND the tooling can't tell — so #2013 reads "resolved" while the account is dead. Keep `blocked` until the account logs in and the helper fails loudly.

## Evidence
- Live snapshot: "Email or password is incorrect." after hand-login with Doppler creds.
- Cookie dump: 2 cookies, no session-token.
- `qa-login-save-state.mjs:43` unconditional `ok:true`.
- No browser JS errors on the page; 401 on the auth POST.
