# Security policy

We take security seriously. If you've found a vulnerability in MIRA, this page tells you how to report it and what to expect.

---

## Supported versions

Only the latest tagged release on `main` is supported with security fixes.

| Version | Supported |
|---------|-----------|
| `main` (latest tag) | ✅ |
| Anything older | ❌ |

`mira-hub` is versioned independently — check `mira-hub/package.json` for its current version.

---

## Reporting a vulnerability

**Do not open a public GitHub issue for security bugs.**

Email **`mike@cranesync.com`** with:

- A clear description of the issue
- Steps to reproduce (a minimal proof-of-concept is ideal)
- What an attacker could do with it
- Your name or handle if you want credit (optional)
- Whether you've shared it with anyone else

You can encrypt sensitive details with [age](https://github.com/FiloSottile/age) if you'd prefer — ask in your first email and we'll exchange a public key.

---

## What to expect

| Stage | Target |
|-------|--------|
| Acknowledgment that we received your report | within **48 hours** |
| Initial triage (reproduce + severity assessment) | within **7 days** |
| Status update if a fix takes longer | every **7 days** until resolved |
| Public disclosure | **after** a fix is shipped — typically within 30 days of acknowledgment |

If your report is something we already knew about, we'll tell you. If it's a duplicate of someone else's report, we'll tell you that too — but we still appreciate the work.

---

## Scope

In scope:
- Code in this repository (all `mira-*` services)
- The deployed apps at `app.factorylm.com` and `factorylm.com`
- The MIRA Telegram, Slack, Teams, and WhatsApp adapters

Out of scope:
- Third-party services we depend on (NeonDB, Doppler, Stripe, Groq, Cerebras, Gemini) — report directly to the vendor.
- Issues that require physical access to a customer's plant network.
- Denial-of-service via volumetric attacks (we have rate limits — actual logic-DoS bugs are in scope).
- Reports from automated scanners with no proof-of-impact ("this header is missing" without showing what an attacker can do).

---

## What's already known

Tracked security limitations are listed in [`docs/known-issues.md`](docs/known-issues.md). Reporting one of those is fine but won't get a response — we already know.

---

## Disclosure

We prefer **coordinated disclosure**: don't publish the issue until we've shipped a fix or 90 days have passed, whichever comes first.

When the fix ships, we'll:
- Note it in [`docs/CHANGELOG.md`](docs/CHANGELOG.md) under a `### Security` heading
- Credit you by name or handle (with your permission)
- Open a GitHub Security Advisory if the issue warrants a CVE

We don't pay bug bounties today. If we add a program later, we'll honor reports already received.

---

## Defensive controls in place

For context — these aren't a license to test, but they explain what a careful pentest will find:

- **Secrets** managed via Doppler. No secrets in `.env` files committed to git. Pre-commit hook + AST-grep rule scans for hardcoded credentials.
- **PII sanitized** at the inference boundary (`InferenceRouter.sanitize_context()`) — IPv4, MAC, serial numbers redacted before any LLM call.
- **Safety keywords** (arc flash, LOTO, confined space, etc.) trigger immediate STOP escalation in chat — the LLM cannot override.
- **TLS 1.3** in transit. **AES-256** at rest. **Tenant isolation** at the database query layer.
- **Authentication:** Magic link (default), Google SSO, Microsoft SSO, Okta (Team plan and above).
- **Rate limits** per tenant per minute, fail-open on DB errors.

---

## Contact

`mike@cranesync.com` — direct to the maintainer.
