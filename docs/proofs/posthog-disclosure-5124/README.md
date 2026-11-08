# PostHog Disclosure Proof

Candidate-only proof for PR #5124 and issue #5287. No production deployment,
provider inventory, physical-phone or offline acceptance is claimed.

Run the stripped-environment command at the top of `browser-proof.ts` after
installing mira-web's locked dependencies. It uses the real Hono app, a fake
analytics project, an ephemeral loopback listener and an isolated headless Chrome
profile. Database credentials are forbidden and external requests are blocked.

Screenshots are append-only under `docs/promo-screenshots/`. Receipts identify
source bytes by SHA-256, not by a parent commit that lacks uncommitted changes.

## Evidence History

- `mw7dwfgr-1d6ae166`: superseded for viewport acceptance. CSS visibility and
  overflow assertions passed, but visual inspection found the mobile trust
  capture occurred before smooth scrolling settled. Its PASS records only the
  narrower checks in that original run; do not use it to claim viewport coverage.
- The revised proof uses instant scrolling, checks the entire PostHog row's
  viewport bounds and unobscured center, and repeats that check immediately
  before each screenshot. A newer receipt is required for viewport acceptance.
- `mw7dzhhn-a21980a5`: viewport proof passed and all four images were visually
  inspected. Its app source is unchanged; its test-source fingerprint predates
  the final positive-disclosure regression case.
- `mw7e8x71-bdca7daf`: authoritative final candidate receipt. All seven recorded
  source hashes match the candidate; all four captures are byte-identical to
  the visually inspected corrected run. Use this receipt and its screenshots
  for current viewport acceptance. Earlier artifacts are retained, not replaced.

## Test Evidence

- Expanded seven-file deterministic CI selection: 671 pass, 0 fail. It now
  includes the executable PostHog HTTP-response test instead of leaving that
  file outside the required job.
- Existing offline OpenRouter contracts: 23 pass, including no-training/ZDR
  request payloads. No inference request was sent.
- Full unconfigured web suite: 1,033 pass / 16 fail; exact unchanged baseline
  f71a1adcf95646ed28f0225b362cf02ce81a7420 has 1,028 pass / the same 16 fail.
  Database-required integration cases and known env/mock-sensitive tests were
  not made green by supplying production credentials or weakening assertions.
- Negative control: the old source regex accepts a misleading true marker in
  a comment while the actual option is false. The real-response test fails.
  Restoring the actual option returns the focused and CI selections to green.
- Positive control: truthful third-party tracking disclosures remain allowed;
  known false no-tracking denials remain rejected.

## Limits And Sources

External requests are blocked, so the browser proof verifies emitted configuration
and visible policy text, not PostHog SDK ingestion or project-side recording state.
No live provider inventory is asserted: local production SSH host-key verification
failed and was not bypassed. The changed privacy paragraph is qualified around
configured web providers and existing request-level controls.

Authoritative provider references supporting the narrow configuration/defaults:

- [PostHog replay controls](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record)
- [OpenAI API/business data defaults](https://openai.com/business-data/)
- [OpenRouter zero retention and data-collection controls](https://openrouter.ai/blog/insights/zero-data-retention/)

The live public init endpoint was inspected without printing its project key and
uses the US project host. The server-side funnel sender uses the same configured
PostHog host. No new collection, provider, Hub tag or policy compliance claim is
introduced. Production release still requires the normal exact-RC staging,
acceptance, human checkpoint, smoke and observation evidence plus coordination
with the other active session.
