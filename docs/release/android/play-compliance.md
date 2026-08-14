# FactoryLM — Play compliance package (evidence-based drafts)

Every claim below is derived from the actual client/server code on this branch, with the
source named. Items marked **OWNER** need a business/legal decision — do not self-serve.

## Play policy audit result (2026-08, official docs)

| Requirement | FactoryLM state |
|---|---|
| Target API ≥36 for NEW apps by 2026-08-31 | ✅ targetSdk=36, compileSdk=36 (`android/variables.gradle`) |
| Android App Bundle (.aab) | ✅ `bundleRelease` output |
| Play App Signing | ✅ upload-key workflow (`signing.md`); enrollment happens at first upload |
| 64-bit native libraries | ✅ N/A — no NDK libs; Capacitor WebView only |
| Permissions minimal | ✅ INTERNET + CAMERA only; `camera required=false` (manifest) |
| Cleartext traffic | ✅ none — API base is https; no `usesCleartextTraffic`; no network-security-config overrides |
| Exported components | ✅ only `MainActivity` (launcher + deep links); FileProvider `exported=false` |
| App Links | ✅ `autoVerify` for `app.factorylm.com/m/*`; assetlinks.json staged in `deployment/well-known/` — **needs release-cert fingerprint added + deployed** (currently debug fingerprint) |
| debuggable in release | ✅ false (AGP default; never overridden) |
| Ads | ✅ none — declare "No ads" |
| Target audience | 18+ / business users (not child-directed) — content rating questionnaire accordingly |
| Account deletion (User Data policy) | ❌ **GAP — OWNER**: app has account creation but no in-app deletion path and no web deletion URL. Required for the Data Safety form before production. Sign-out purges device data (proven) but server-side account deletion does not exist yet. |
| Privacy policy URL | ❌ **GAP — OWNER**: no public privacy policy page exists. Required before any track is published. |
| Reviewer/app-access instructions | Needed (app is login-gated): provide a working demo account in Play Console → App access. **OWNER**: create a dedicated reviewer account (do NOT reuse internal QA creds). |

## Data inventory (what the app actually collects/transmits — from code)

| Data | Evidence | Where it goes |
|---|---|---|
| Email, name, password | register/login (`src/screens/Login.tsx` → NextAuth on app.factorylm.com) | FactoryLM backend (NeonDB). Passwords bcrypt-hashed server-side (`api/auth/register/route.ts`). |
| Session token | JWE cookie persisted via Capacitor Preferences (`src/api/client.ts` cookie jar) | Device only; cleared on sign-out (purge proven in QA 2026-08-13) |
| Work orders, PM schedules, chat/notebook messages | user-created content via `/api/*` | FactoryLM backend, tenant-scoped (RLS + tenant_id — proven in #3223/#3229 QA) |
| Uploaded documents (PDF manuals) + nameplate photos | notebook add-source + camera capture | FactoryLM backend (`knowledge_entries`, `is_private=true` for tenant uploads) |
| Camera frames for QR scan | `qr-scanner` in WebView (`src/screens/ScanView.tsx`) | **Processed on-device only; never uploaded** |
| Chat/notebook text sent to AI providers | server-side cascade Groq→Cerebras→Together (`mira-bots/shared/inference/router.py`) | Third-party LLM APIs. PII sanitization (IP/MAC/serial → tokens) is default-on in `InferenceRouter.complete()` |
| Analytics / ads / crash reporting SDKs | none — package.json has only Capacitor plugins; no google-services.json | N/A |
| Device location, contacts, identifiers | not requested (manifest) | N/A |

## Data Safety form — draft answers

- Collects: **Personal info** (email, name — account management, required);
  **User-generated content** (messages, documents, photos — app functionality, required);
  all **encrypted in transit** (HTTPS everywhere — androidScheme https, API https).
- Shared with third parties: **user content is processed by AI service providers**
  (Groq/Cerebras/Together) to generate answers, after automated PII sanitization —
  disclose under "Data shared / App functionality". **OWNER** review of wording.
- Data deletion: device data purged on sign-out (provable). Account/server deletion:
  **cannot be claimed until the deletion endpoint ships** — leave "request deletion"
  answers honest (GAP above).
- Do NOT claim encryption at rest, retention periods, or "not shared" — not proven in-repo.

## Content rating inputs
No UGC visible across users outside the tenant, no violence/sexual content, no gambling,
business tool → expected rating: Everyone (IARC questionnaire answered "no" throughout,
except user-to-user content within a private workspace if asked).

## OWNER decision list (blocking production, not Internal Testing)
1. Public privacy-policy URL (factorylm.com/privacy) — content + hosting.
2. Account-deletion: server endpoint + in-app entry + public web request URL.
3. Reviewer demo account for App access.
4. Support email + website on the listing.
5. Data Safety "shared with third parties" wording sign-off (AI providers).
