# FactoryLM next qualification — November 21, 2026

Scope: private website, opt-in bounded public adapter and new personal technician signup. No production activation, real customer account, email, meeting, payment or plant action.

- 51 focused unit tests, including prior trial, pilot, admin and invitation controls: PASS (`unit-tests.json`).
- Seven actual-handler/disposable PostgreSQL tests, zero skipped: PASS (`postgres-tests.json`).
- 24 bounded public adapter and existing-Terms-scope tests, 45 assertions: PASS. Command: `cd mira-web && bun test src/factorylm-ui/marketing-next.test.ts src/factorylm-ui/free-technician-terms.test.ts`.
- Actual local registration and NextAuth credentials cookie session: PASS (`http-signup.json`). No session token or password is included.
- Connected browser: 60 private preview layouts, 32 production adapter layouts and four signup layouts after policy load; zero horizontal overflow. Menu, MIRA FAQ, query-preserving legacy redirect, Terms scope, demo draft selection/reset and lazy calendar: PASS (`browser-checks.json`). Responsive viewport rehearsal is not a physical-device acceptance run. The signup initially displays neutral text until its policy response arrives.
- Calendar rendered with no available dates in November or December 2026. Demo email draft is primary; calendar settings and meetings were unchanged.
- Private build: 15 URLs, 509 local references. Release: eight pages, seven assets, 231 local references; hashes match and production rebuild is byte-identical. Local public policy matches the free offer.
- Full-project TypeScript: existing 76 hub and 34 web errors, with identical normalized baseline diagnostics (`typecheck-comparison.json`). These commands are not green. The locked Next.js CLI reports an existing security advisory; dependencies were not upgraded or certified as safe by this change.

Production policy/current-build document and source behavior, physical phone/plant acceptance, legal review and governed release remain separate gates. Screenshots show illustrative site content or the actual local signup page; they do not prove a deployed free offer.
