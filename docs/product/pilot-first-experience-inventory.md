# Pilot first-experience inventory — 2026-10-29

Current offer: [current-pilot-offer.md](current-pilot-offer.md). This inventory describes source changes and dependencies, not a deployed acceptance receipt.

| Entry or stage | Source / ownership | Decision and validation boundary |
|---|---|---|
| Meta / Google acquisition | Native lead forms, campaign #4873 | Application, not immediate access; no live ad ID or completed form verified. No ads edited or launched. |
| `/`, `/pricing`, `/buy`, `/assess`, `/cmms`, navigation, SEO/LLM metadata, feature/blog CTAs | MIRA public-copy draft #4570, head inspected `c5ecdea609f30ec25b20cf506382bc28b2ba6aaf` | Preserve this active branch. It owns the conflicting public prices and lead claims. This PR depends on its review and release; public site remains unchanged by this work. `/cmms` is a returning-user door, not a second pilot application. |
| Hub `/signup` and metadata | `mira-hub/src/app/signup` | Five free scoped pilots; manual review; no reserved place; approval clock; distinct consulting link. Duplicate-account message directs to sign-in; failed Google initiation releases spinner. Existing credential and OAuth authorization untouched. |
| `/login`, magic-link return | `mira-hub/src/app/login`, existing auth | Returning workspace / application language, application link. Existing sign-in callbacks and middleware remain authoritative. |
| Pending application | `(hub)/pending-approval` | No running clock or CMMS promises. Explicit unchanged-pending, network failure, non-OK and changed-status feedback. Retry, contact and sign-out paths. Approved result requires fresh sign-in, not client-side access elevation. |
| Approval, cap, duration | `capabilities/pilot-access.ts`, users, migrations 107/108 | Existing implementation preserved. Unit tests cover pending/no clock and approval window/caps. No migration, production flag, slot or approval changed. Approval starts the clock; coordinate it with scoped onboarding. |
| Onboarding / manual upload | `(hub)/onboarding`, existing opened-document scope adapter | Describe one agreed scope, indexing and source validation. The follow-up CTA now opens the customer's namespace instead of the public demo. Existing uploaded-document chat, duplicate-upload scope and safety/error behavior preserved. |
| First answer / inspect source | Existing NodeChat / notebook evidence UI; #4932 | This branch does not duplicate the active namespace Markdown/mobile fix. Existing source renderer and onboarding-scope tests pass; no claim that a real customer reached the first answer in production. |
| `/quickstart` | Hub public sample | Clearly shared library, no company uploads, not a protected workspace. Existing Markdown renderer escapes HTML. HTTP(S) sources stay links; internal sources explicitly say the link is unavailable. No fabricated PDF URL. Missing public source links remain a limitation. |
| Returning pilot / continuation | Trial banner and `/upgrade` | Use pilot terminology; continuation and consulting are separate mailto inquiries. No checkout, prices, renewal or guaranteed integration claims. Existing paid access and billing webhooks preserved. |
| Legacy public registration email | `beta-welcome.html` | Directs interest registrants to Hub application or existing-account login. Does not claim that the legacy registration itself is a Hub application. |
| Timed nurture / payment emails | `mailer.ts`, emails README | Historical day-1..10 sequence retained but exported schedule empty. Prevents unsupported claims and a day-seven $97 demand. Existing paid-customer receipts and sign-in messages unchanged. No email sent. |
| `/printsense` | Existing PrintSense route | Paid print-package consulting explicitly separate from free MIRA application. Interest receipt is not access or approval; removes unverified response-time promise. Existing capture storage retained. |
| `/public/printsense.html` | Historical static exploration | Publicly reachable via `/public/*`; marked historical and noindex, removes pretend submission form. Historical examples/prices explicitly not a current offer or production proof. |
| Legal / consent | Terms main; held #4845; draft #4930 | No contract amendment, new consent version, or historical consent backfill. Legal reconciliation remains owner work; existing terms can still describe older paid offers. |
| Campaign instructions and long-term strategy | Root pointers, marketing skill copies, promo playbook | Current offer takes precedence for acquisition; historic strategy/proofs are retained. No new capability or evidence status awarded. |
| Companion factorylm repository | README/AGENTS/CLAUDE + current-offer doc | Live customer site/Hub belong to MIRA. `apps/web` has NOT_IMPLEMENTED status: its unmounted 14-day pricing prototype and old website design are explicitly historical, not implemented as another signup. CMMS vendor billing templates and technical documentation are not the MIRA acquisition offer. |

## Suggested native lead-form wording (draft only)

Headline: **Apply for a free 30-day MIRA pilot**

Body: **We are selecting five teams for a scoped MIRA pilot. Tell us about your equipment and manuals. We review applications manually and agree the scope before approval and onboarding. Waiting uses no pilot days. Any paid continuation is agreed separately.**

Confirmation: **Your request has been received for review. This is not approval or workspace access. If you already applied through the Hub, sign in to check your status rather than making another account.**

Use the platform's native form and the existing Hub signup route. This wording is not a published consent notice, a configured form, or evidence that attribution/CRM deduplication works across ad lead forms and Hub accounts. No automatic lead-form provisioning is introduced.

## Local verification

Run from `mira-hub`:

- `node tests/first-experience/check.mjs`: real page components and application CSS on localhost, mocked navigation/auth/APIs, browser request fence blocks external hosts. Phone 412×915 and desktop 1440×1000 screenshots. Synthetic `example.invalid` identities never reach a database, CRM, email provider or pilot counter.
- `node_modules/.bin/vitest run src/factorylm-ui/pilot-entry.test.tsx src/capabilities/__tests__/users-pilot-approval.test.ts src/capabilities/__tests__/pilot-access.test.ts src/capabilities/__tests__/pilot-funnel.test.ts src/factorylm-ui/onboarding-try-mira.test.ts src/components/equipment/notebook-markdown.test.tsx`.

Run from `mira-web`: `bun test src/lib/__tests__/pilot-email-journey.test.ts src/__tests__/printsense-landing.test.ts`.

The four rendered-offer tests fail against the unchanged base pages, then pass with the correction. Browser fixtures prove component behavior, not server middleware, OAuth delivery, persistence, manual indexing or answer accuracy. Existing approval tests use database doubles, not a production concurrency proof.

## Outstanding release dependencies

- Public-copy #4570 and namespace UI #4932 remain active, independently owned work. No silent supersession.
- Exact-head independent review and the legacy UI lifecycle exception remain required. This draft does not apply exception labels or claim those gates passed.
- Production customer-role upload/index/answer/citation and approval/cap proof remain untested here. Preserve #4372's private blocker and owner; do not use personal admin credentials. Safety/accuracy acceptance remains mandatory.
- OAuth signup does not use the credential-register attribution/owner-notification hook. Applicant confirmation email and later funnel milestones are not implemented in the existing funnel. Manual review is still necessary. This copy repair does not establish complete analytics or CRM deduplication.
- Existing legal wording and held consent/terms decisions must be reconciled before campaign release. No pricing or legal terms are invented here.

Rollback: revert this draft's commits. No schema or data changes; this would also restore the historical drip schedule, so review email scheduling before rollback deployment. Nothing is merged or deployed by this task.

## Verification receipt

119 focused Hub tests pass, including public-sample safety/answer route controls; 8 web tests pass. The 4 offer tests fail against base pages; the 4 new email/PrintSense checks fail against their base implementations. Forty browser assertions pass across phone and desktop fixtures. Changed Hub files pass ESLint. Whole-Hub `tsc --noEmit --incremental false` remains nonzero with byte-identical diagnostics on the unchanged base and candidate after a locked dependency install; none concern changed files. This is not a clean whole-repository build.

Screenshots and command logs are saved under the task workspace `evidence/pilot-first-experience/`; the committed browser harness regenerates them. Visually inspected signup, pending, sample-answer and continuation layouts.
