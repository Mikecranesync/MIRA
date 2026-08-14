# PRD — FactoryLM Native Mobile App (iOS + Android)

**Status:** Draft v1 (2026-08-13) · **Architecture:** ADR-0034 (static Capacitor 8 client → Hub APIs)
**Owner:** Mike · **UX contract:** `docs/specs/hub-mobile-spec.md` (5 tabs, 44px targets, 768px boundary)

## Product goal
A standalone, store-distributable technician app: sign in → your plant's work orders, PM schedule,
grounded equipment chat, and assets — with QR-to-asset deep links, camera capture, and useful
offline behavior on a plant floor with bad connectivity. The web Hub remains the desktop/admin
surface and deploys independently.

## Non-goals (v1)
- No in-app purchases / subscription checkout (enterprise companion model — ADR-0034 §7).
- No public marketing surfaces, no `/m` web renderer, no `/scan` (mira-scan-monday) embedding.
- No PLC control of any kind (read-only doctrine unchanged).
- No offline chat generation (chat requires connectivity; cached context is readable offline).

## Phases and acceptance

### Phase 2 — Walking skeleton (this session)
launch → credentials sign-in (real NextAuth dance) → `/api/me` (user/tenant/capabilities) →
assets list → asset detail → notebook chat (one real grounded turn) → sign out → deep link
`factorylm://m/<TAG>` + `https://app.factorylm.com/m/<TAG>` → installed on Android emulator.
iOS project generated (build documented as the macOS step). Evidence: screenshots + API traces.

### Phase 3 — Core technician app
Five tabs per the frozen spec: Workorders (list/create/update — `work_orders.create|update`
capability-gated), Schedule (pm-schedules list/complete/meter), Chat (notebook + asset chat with
streaming SSE), Assets (list/detail/documents/signals), More (capability-filtered sheet: team,
usage, documents, settings, sign out, delete account). Canonical nav model = single
`capabilities → tabs` map; active-tab persistence; Android back behavior; safe areas; keyboard
handling in chat.

### Phase 4 — Native capabilities
QR scan (ML Kit barcode; reuse `qr-scanner-view.tsx` semantics), camera/photo → WO close photos +
notebook uploads, file/PDF upload, verified App Links + `apple-app-site-association`/
`assetlinks.json` served at the prod origin, secure storage hardening, offline cache
(assets/faults/recent docs) + offline WO mutation queue with client idempotency keys
(**requires server change:** idempotency support on `POST /api/work-orders`), tenant-keyed purge
on logout/tenant-switch, visible sync state.

### Phase 5 — Store readiness
In-app account deletion (**requires server change:** Hub deletion flow + a safe worker that
preserves retry state until external purges succeed — the mira-web worker's
delete-tenant-row-last-but-unconditionally ordering and placeholder MinIO/Langfuse purges are the
documented anti-pattern), privacy manifests + data-safety declarations, permission strings +
denied/revoked states, production logging safeguards, signing pipelines, review account + sample
QR + reviewer instructions, distribution-model documentation (Apple/Play implications incl.
Sign-in-with-Apple analysis).

### Phase 6 — Production validation
Full acceptance suite on release builds against prod with a fresh QA tenant (`notebook-qa-*` —
covered by `qa-cleanup.yml`): auth matrix (cold/warm/background callbacks, cancel, retry, expiry),
security matrix (fail-closed roles, 403s, cross-tenant probes, plugin origin restriction, no
secrets in bundle), camera/files matrix, offline matrix (no duplicate WO, conflict, purge), and
deletion matrix (per-system failure injection, retryable).

## Key technical contracts
- **API base:** `https://app.factorylm.com` (root basePath; env-switchable for staging `/__staging/`).
- **Transport:** `CapacitorHttp` (native; no CORS; native cookie jar carries
  `__Secure-next-auth.session-token`). SSE chat: streamed fetch where available; full-body SSE
  parse is the fallback (frames are `sources` → `content`* → `status` → `[DONE]`).
- **Auth dance:** `GET /api/auth/csrf` → `POST /api/auth/callback/{credentials|magic-token}`
  (form-encoded, csrfToken) → session cookie in native jar → verify via `GET /api/me`.
  Sign-out: `POST /api/auth/signout` + clear cookies + purge tenant-keyed local data.
- **Authorization:** render from `/api/me.capabilities[]`; missing/unknown ⇒ least privilege
  (fail closed). Server 403s are authoritative; UI gating is UX only.
- **QR/tag parsing:** Hub `extractAssetTag` semantics (full URL | `/m/<TAG>` | raw tag) →
  `GET /api/assets/by-tag/[tag]`.
- **Trust boundary:** packaged bundle only; `@capacitor/browser` for all external content; no
  `server.url`; no `allowNavigation`.

## Server-side work queue (each a separate reviewable Hub/mira-web PR, not bundled with the client)
1. Idempotency key on `POST /api/work-orders` (Phase 4 gate).
2. Hub account deletion: in-app initiation endpoint + web path + safe retryable worker with a
   deletion ledger that outlives the tenant row; idempotent; per-system (DB, KB/vector, MinIO,
   Langfuse, OAuth tokens) status until all succeed (Phase 5 gate; Apple requirement).
3. Well-known files for App/Universal Links at the prod origin (Phase 4 gate).
4. Fix the web client's `role ?? "owner"` fail-open default (`src/providers/access-control.ts:47`,
   `auth-provider.ts:35`) — independent P0 hygiene the mobile client will not inherit.
5. Optional: bearer fallback in `requireSession()` if native cookie handling proves fragile.

## Risks
- **Store review "web wrapper" perception** → mitigated by native nav/scan/camera/offline + no
  remote URL loading.
- **SSE streaming under CapacitorHttp** (no incremental body) → streamed-fetch plugin or accept
  full-turn latency in v1 chat; measure.
- **Google OAuth return path** relies on App Links verification on prod nginx → Phase 4 server task.
- **Windows dev host** → Android fully local; iOS archive/signing is the one external (macOS) step.
