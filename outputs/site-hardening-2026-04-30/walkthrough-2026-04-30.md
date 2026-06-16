# factorylm.com walkthrough — 2026-04-30

**Tool:** Claude-in-Chrome MCP (Playwright MCP wasn't loaded; local playwright@1.59.1 in mira-web has no browsers downloaded).
**Viewport:** 1200×765 desktop. Window resize to 390×844 succeeded but Claude-in-Chrome screenshots remained at fixed 1200×765, so a true mobile screenshot wasn't captured. Layout was visually inspected at desktop and read from CSS — see "Mobile" finding below.
**Identity used for signup:** `synthetic-test+harden@factorylm.com` (plus-aliased to Mike's Workspace mailbox).

## Steps walked

| # | Action | Result |
|---|---|---|
| 1 | GET `https://factorylm.com/` | 200, full landing page renders, no obvious broken assets. Hero copy + CTA + "68,000+ chunks of OEM documentation indexed" social proof bar all visible above fold. |
| 2 | Click `Start Free — magic link` | Routes to `/cmms` (the magic-link signup form). |
| 3 | Type `synthetic-test+harden@factorylm.com` → click `Send magic link` | Server returns success; UI shows green banner: "✓ Check your inbox — your magic link is on its way (it expires in 10 minutes)." Real Resend email actually fires. |
| 4 | Navigate to `https://app.factorylm.com/` | 301 redirects to `https://app.factorylm.com/login/?callbackUrl=%2Ffeed%2F`. Auth gate works. Three sign-in options: Continue with Google, Email magic link, Sign in with password. |
| 5 | Expand "Sign in with password" | Form expands cleanly, email + password fields render. |
| 6 | Resize to 390×844 + reload `factorylm.com` | Window resize succeeded; Claude-in-Chrome captures at fixed 1200 so true mobile-pixel screenshot not obtained — see Mobile finding below. |

## Findings

### Marketing site (`factorylm.com`)

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| WEB-1 | Magic-link signup writes to a real Resend send | informational | Submitting any email address fires a transactional email immediately. The current rate limiter is process-wide (per the post-sweep mailer fix in PR #887, 4/sec global), but there's no per-email-address dedup — submitting the same address 10 times in a minute fires 10 emails. |
| WEB-2 | Truncated/unbalanced markdown in MIRA replies (`*Lo` mid-italic) | P1 | Caught in Rico's transcript — MIRA's first turn ends `*Find a manual* | *Lo` (cut off). Suggests the MIRA reply is being truncated server-side mid-format. Renders fine in Telegram (which strips trailing partial markdown), but a Slack adapter or any strict markdown renderer would mis-format the suggestion bar. |
| WEB-3 | Apex page returns `Content-Length: 0` on HEAD | informational | `curl -I` returns 0 bytes. GET returns 13.5 KB. Hono / nginx interaction quirk; not a real issue but confuses uptime probes that use HEAD. |
| WEB-4 | Mobile viewport not captured in this pass | P2 — re-test | Window resize accepted but Claude-in-Chrome's screenshot is fixed at 1200 px wide. To validate mobile, install playwright browsers (`bunx playwright install chromium`, ~150 MB) and re-run. |

### Hub (`app.factorylm.com`)

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| HUB-1 | Login page exposes 3 distinct auth paths (Google OAuth, magic link, password) | P1 | Three concurrent auth flows = three concurrent attack surfaces. Magic link is fine. Password sign-in is the new risk — combined with no rate limit on the credential POST (verified via curl earlier), it's an open brute-force surface. |
| HUB-2 | "Start free trial" link in login footer routes to `/api/checkout` (Stripe) | informational | Standard PLG; fine. |
| HUB-3 | NextAuth `callbackUrl=%2Ffeed%2F` in URL | informational | Open-redirect risk if `callbackUrl` accepts external URLs. Need to verify NextAuth's `redirect` callback whitelists internal paths only — quick code read needed; deferring to a follow-up. |

### Synthetic users — observations from running Rico live

See `outputs/site-hardening-2026-04-30/rico-shift-2026-04-30T1034.md` for the full transcript.

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| SYN-1 | Off-topic scenarios picked from Reddit corpus (undergrad research questions) | P0 | Rico's last shift opened with "i'm a third-year undergraduate student majoring in mechanical engineering". `rico.py:load_scenarios()` filter is too loose; lets through any thread mentioning `pump`/`motor`/etc. even if the asker is a student. |
| SYN-2 | Rico's followups are generic fillers ("yep", "correct", "makes sense") that don't answer MIRA's questions | P0 | `rico.py:_generate_follow_up()` keyword-matches on MIRA's reply and falls through to 5-item filler list. Most of MIRA's actual prompts ("What kind of equipment?", "Model number?") miss the keyword set. Conversation never progresses past Q&A loop. Result: every shift dead-ends without diagnosis or WO creation. |
| SYN-3 | `fsm_advanced` heuristic produces false positives | P1 | `result.fsm_advanced = len(final_reply) > 50 and "?" not in final_reply[:50]` — that's just shape-checking. Rico's last 4-turn loop ended with MIRA still asking a question, but the heuristic still reported `FSM: advanced` in the Telegram report. Rico's success metrics are not measuring success. |
| SYN-4 | No cron schedule for Rico | P1 | The synthetic technician was supposed to "exercise the full MIRA stack on every run" — but `crontab -l \| grep rico` returns nothing. Rico runs only when triggered by hand. Total observations in 2 days of being deployed: 10 rows. |
| SYN-5 | Rico's Telegram report uses `parse_mode=Markdown` with no fallback | P1 | Same bug class as PR #886 fixed for the orchestrator. If Rico's report body ever contains the unbalanced `*` from MIRA's truncated reply (WEB-2), Telegram returns 400 and the shift report is silently lost. |
| SYN-6 | Rico runs against production tenant + production NeonDB + production Resend | P1 | No `synthetic_test=true` marker in the tenant context. The 10 rows in `synthetic_observations` mix into any future analytics. Real LLM cascade tokens are spent. Real Atlas writes are made if `random.random() < 0.4` triggers WO creation. |
| SYN-7 | Hub has 4 seeded synthetic personas (carlos/dana/jordan/pat @synthetic.test) but no scheduled exercise of them | P2 | `mira-hub/scripts/seed-synthetic-users.ts` + `tests/e2e/synthetic-day.spec.ts` exist, but the Playwright spec is intended for CI/manual run. No scheduled "exercise the hub as Carlos every hour" job. They're test fixtures, not autonomous agents. |
