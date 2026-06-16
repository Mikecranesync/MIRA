# CMMS Deep-Link & Multi-Provider Spec

**Status:** Draft — awaiting Mike approval
**Author:** Claude (Opus 4.7)
**Date:** 2026-05-06
**Related:** [`hub-cmms-integration-spec.md`](./hub-cmms-integration-spec.md) §4 P2

---

## 1. Context

After PR #1022 (P0 honesty) + PR #1024 (route_taken hotfix) + PR #1023 (P1 sync worker), the hub creates real Work Orders in NeonDB and the sync worker (when enabled) pushes them to Atlas, back-filling `work_orders.atlas_id`.

What's missing is the *visible* end of that integration: a consistent **"Open in CMMS"** button on every MIRA-touched object — WO, asset, MIRA conversation — that deep-links to the tenant's configured CMMS. Today:

1. **Broken link on WO detail:** `mira-hub/src/app/(hub)/workorders/[id]/page.tsx:240` builds `cmms.factorylm.com/workorders/${wo.id}` using the **NeonDB UUID**, not `wo.atlas_id`. Atlas 404s on every click. (PR #1022 spec said this should be "hidden until atlas_id is populated" — gating was never implemented.)
2. **No button on MIRA conversations.** `mira-hub/src/app/(hub)/conversations/page.tsx` is currently a hardcoded fixture; no per-conversation detail view, no link to the WO it produced.
3. **Hardcoded to Atlas.** Six different files inline `https://cmms.factorylm.com`. No tenant override → no Maximo/Fiix/MaintainX/UpKeep customer can be onboarded without forking the code.

A new tenant landing on Maximo today would see "Open CMMS" buttons that send them to a Florida URL their Maximo SSO has never heard of. That's a sales-blocker the moment we start outbound on enterprise prospects.

---

## 2. Goals

1. **One reusable button component** drops into any page and renders the right deep-link for the current tenant.
2. **Atlas remains the default** — no behavior change for `tenant_id='mike'` and other Atlas-backed tenants.
3. **Per-tenant provider override** via a `tenant_cmms_config` table. Switching a tenant from Atlas to Maximo is a row update — no code deploy.
4. **Each provider is a small TypeScript class** that knows how to build deep-link URLs from an `external_id`. Sync (push to the external CMMS) is an *optional* method on the same interface — Atlas implements it today, others can be added incrementally as customers come online.
5. **Fail-safe degraded UX:** if `external_id` isn't populated yet (sync hasn't run, no provider configured), the button is hidden (or shown disabled with a tooltip), never broken.

## 3. Non-goals (this spec)

- Implementing Maximo/Fiix/MaintainX/UpKeep **sync** (push WOs to those systems). Out of scope. Deep-link only here.
- Asset/PM record sync to Atlas — already in PR #1023's `mira-cmms-sync` worker.
- A settings UI for tenants to self-configure their CMMS. Phase 2; today, config is admin-managed via SQL or a future admin route.
- Multi-CMMS *fan-out* (one tenant pushing to two CMMSes simultaneously). YAGNI.
- Replacing Atlas as the default. Atlas stays.

---

## 4. Architecture

### 4.1 Data model — new table `tenant_cmms_config`

Migration `mira-hub/db/migrations/008_tenant_cmms_config.sql`:

```sql
CREATE TYPE cmms_provider AS ENUM ('atlas', 'maximo', 'fiix', 'maintainx', 'upkeep');

CREATE TABLE IF NOT EXISTS tenant_cmms_config (
  tenant_id           TEXT PRIMARY KEY,
  provider            cmms_provider NOT NULL DEFAULT 'atlas',
  base_url            TEXT NOT NULL DEFAULT 'https://cmms.factorylm.com',
  -- Per-provider URL templates. Tokens: {external_id}, {tenant_id}.
  -- Defaults are filled in by the provider class; tenants override only when
  -- their CMMS uses non-standard paths.
  link_templates      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Doppler secret name for API auth. Never store the credential itself here.
  auth_credential_ref TEXT,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenant_cmms_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cmms_config ON tenant_cmms_config
  FOR ALL TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', TRUE));

-- Seed every existing tenant with the Atlas default.
INSERT INTO tenant_cmms_config (tenant_id, provider, base_url)
SELECT DISTINCT tenant_id, 'atlas', 'https://cmms.factorylm.com'
FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;
```

Note: the `cmms_provider` enum is intentionally narrow. New providers go in via `ALTER TYPE cmms_provider ADD VALUE` migrations — same pattern as the `sourcetype` enum we just learned a hard lesson on.

### 4.2 Provider interface — `mira-hub/src/lib/cmms/provider.ts`

```ts
export type DeepLinkKind = "work_order" | "asset" | "pm";

export interface CMMSProvider {
  readonly name: string;            // "Atlas", "Maximo", "Fiix", ...
  readonly slug: CMMSProviderSlug;  // "atlas" | "maximo" | ...

  /** Default URL templates; tenant config can override per template key. */
  defaultLinkTemplates: Record<DeepLinkKind, string>;

  /** Builds the deep-link URL. Pure — no I/O. */
  buildDeepLink(args: {
    kind: DeepLinkKind;
    externalId: string;
    baseUrl: string;
    overrideTemplates?: Partial<Record<DeepLinkKind, string>>;
  }): string;

  /** Optional: push a WO/asset/PM to this CMMS. Only Atlas implements today. */
  syncWorkOrder?(...): Promise<{ external_id: string }>;
  syncAsset?(...): Promise<{ external_id: string }>;
}
```

A registry maps `cmms_provider` enum slugs → concrete provider classes:

```ts
// mira-hub/src/lib/cmms/registry.ts
export const PROVIDERS: Record<CMMSProviderSlug, CMMSProvider> = {
  atlas:     new AtlasProvider(),     // wraps existing src/lib/atlas/client.ts
  maximo:    new MaximoProvider(),    // deep-link only
  fiix:      new FiixProvider(),      // deep-link only
  maintainx: new MaintainXProvider(), // deep-link only
  upkeep:    new UpKeepProvider(),    // deep-link only
};
```

Default templates per provider (verified against each vendor's URL convention; these are the **starting points** — actual customers may override):

| Provider  | Work order                          | Asset                            |
|-----------|-------------------------------------|----------------------------------|
| Atlas     | `/workorders/{external_id}`         | `/assets/{external_id}`          |
| Maximo    | `/maximo/ui/?event=loadapp&value=wotrack&additionalevent=useqbe&additionaleventvalue=wonum%3D{external_id}` | `/maximo/ui/?event=loadapp&value=asset&additionalevent=useqbe&additionaleventvalue=assetnum%3D{external_id}` |
| Fiix      | `/g/wo/view/{external_id}`          | `/g/asset/view/{external_id}`    |
| MaintainX | `/dashboard/work-orders/{external_id}` | `/dashboard/assets/{external_id}` |
| UpKeep    | `/work-orders/{external_id}`        | `/assets/{external_id}`          |

### 4.3 Deep-link helper — `mira-hub/src/lib/cmms/deep-link.ts`

```ts
export type DeepLinkResult =
  | { status: "ready"; url: string; provider: string; providerSlug: CMMSProviderSlug }
  | { status: "syncing" }       // external_id not yet populated
  | { status: "unconfigured" }; // tenant has no CMMS config (free-tier hub-only)

export async function getCMMSDeepLink(
  tenantId: string,
  kind: DeepLinkKind,
  externalId: string | null,
): Promise<DeepLinkResult>;
```

Single source of truth. Reads `tenant_cmms_config` once per request via `withTenantContext`. Returns `syncing` when `externalId` is null so the UI can show a spinner / "Syncing to CMMS…" copy instead of a broken link.

### 4.4 Deep-link API endpoint — `mira-hub/src/app/api/cmms/deep-link/route.ts`

```
GET /api/cmms/deep-link?kind=work_order&id={uuid}
GET /api/cmms/deep-link?kind=asset&id={uuid}
```

Returns `DeepLinkResult` JSON. Server-side joins `work_orders` (or `cmms_equipment`) on `id` to fetch `atlas_id`, then defers to `getCMMSDeepLink`. RLS-scoped to `ctx.tenantId`.

Why an API endpoint instead of computing on the page? Three reasons:

1. The MIRA conversation view will show this button across many WOs in a list — a single batched fetch beats 1 RTT per WO if we eventually add bulk.
2. Telegram/Slack adapters will hit the same endpoint server-side to embed deep-links in bot replies (see §5.5).
3. Tenant config invalidation is cleaner with a single fetch boundary.

### 4.5 Shared button component — `mira-hub/src/components/cmms/open-in-cmms-button.tsx`

```tsx
<OpenInCMMSButton kind="work_order" recordId={wo.id} variant="outline" />
```

Behavior (Mike-approved 2026-05-06):

- On mount, fetches `/api/cmms/deep-link?kind=...&id=...`.
- If `status === "ready"`: renders **`Open in {provider.name}`** (dynamic — "Open in Atlas", "Open in Maximo", etc.) using the provider name from tenant config. Falls back to generic `"Open in CMMS"` only when the provider name is unknown/absent.
- If `status === "syncing"`: renders disabled button with tooltip "Syncing to CMMS… typically <60s".
- If `status === "unconfigured"` **on an object page** (WO detail, asset detail, conversation): renders **`Connect a CMMS →`** linking to `/cmms` so the tenant can complete setup. Atlas is pre-seeded for every new tenant, so this state should be rare in practice — it appears only if a tenant explicitly disabled their config.

i18n: reuses existing `openCmms` key in `mira-hub/src/messages/{en,es,hi,zh}.json:655` for the generic fallback. New keys: `openIn` (template `"Open in {provider}"`), `connectCmms` ("Connect a CMMS →"), `syncingToCmms` ("Syncing to CMMS…").

---

## 5. UI Surfaces — where the button appears

### 5.1 `/workorders/[id]` — fix the existing broken button

`mira-hub/src/app/(hub)/workorders/[id]/page.tsx:240` — replace the inline `<a>` with `<OpenInCMMSButton kind="work_order" recordId={wo.id} />`. The current code uses `wo.id` (NeonDB UUID) as the path segment, which 404s in Atlas. New component fetches `wo.atlas_id` via the API.

### 5.2 `/assets/[id]` — asset detail page

`mira-hub/src/app/(hub)/assets/[id]/page.tsx` — drop the same component with `kind="asset"` next to existing CTAs. Replaces whatever the CRA-20 branch added (currently inline, hardcoded Atlas).

### 5.3 `/cmms` — landing page

`mira-hub/src/app/(hub)/cmms/page.tsx:11,132` — keep the page-level "Open CMMS" CTA but route it through the helper so it points to the tenant's `base_url`, not the hardcoded `cmms.factorylm.com`. No `external_id` needed (it's a top-level link).

### 5.4 `/conversations` — MIRA conversation detail (NEW)

**Mike-approved: Option B — real backend first.** The current `/conversations` page is hardcoded fixtures (`CONVERSATIONS = [...]` const). Real conversation data lives in NeonDB tables `telegram_messages` (per-message log) and `work_orders` (with `created_by_agent` / `tenant_id` linking back to the chat).

Required backend work to land the button correctly:

1. **Schema link:** Add `work_orders.conversation_id` (TEXT, nullable, indexed) so a WO can be traced back to the chat that produced it. Today the link is reconstructed from timestamp + `tenant_id` + `created_by_agent` — fragile. Migration: `mira-hub/db/migrations/009_wo_conversation_link.sql`.
2. **Bot writes the link:** `mira-bots/shared/integrations/hub_neon.py:101-118` (the INSERT) gains a new `conversation_id` parameter sourced from the chat thread. `mira-bots/shared/engine.py` plumbs the chat_id through the WO creation call.
3. **List endpoint:** `GET /api/conversations` — returns the per-tenant list of conversations grouped by `chat_id`/`channel`, last message preview, asset reference, **and any linked work_order with its `atlas_id`**. Replaces the fixtures.
4. **Detail endpoint:** `GET /api/conversations/[id]` — returns the full message thread + the linked WO record (with `atlas_id`).
5. **New page:** `mira-hub/src/app/(hub)/conversations/[id]/page.tsx` — full chat view with a sticky right-rail showing the linked WO + `<OpenInCMMSButton kind="work_order" recordId={wo.id} />` prominently at the top.
6. **List page update:** `mira-hub/src/app/(hub)/conversations/page.tsx` becomes data-driven (fetches `/api/conversations`), renders a "Linked WO" chip per row, and hyperlinks to the new detail page.

Estimated scope: 5-7 days. Lives in a separate Phase 2 PR after Phase 1 ships.

### 5.5 `/workorders/new` — success splash

After a WO is created, the success splash currently shows "View" + "Create another". Add `<OpenInCMMSButton ... />` — it'll render in `syncing` state initially (since the worker hasn't pushed yet), then auto-update to `ready` when the user revisits or after a polling interval.

### 5.6 Bot replies (Telegram/Slack) — out of scope this spec but worth noting

Once the API endpoint exists, `mira-bots/shared/integrations/hub_neon.py` can call it server-side and append `View in CMMS: {url}` to bot replies. Cleaner than reimplementing the URL logic in Python. Track as a follow-up.

---

## 6. File inventory

### New files

| File | LOC est. | Purpose |
|------|----------|---------|
| `mira-hub/db/migrations/008_tenant_cmms_config.sql` | 35 | Table + RLS + seed |
| `mira-hub/src/lib/cmms/provider.ts` | 60 | Interface + types |
| `mira-hub/src/lib/cmms/registry.ts` | 25 | Provider registry |
| `mira-hub/src/lib/cmms/atlas-provider.ts` | 50 | Wraps existing `src/lib/atlas/client.ts` |
| `mira-hub/src/lib/cmms/maximo-provider.ts` | 40 | Deep-link only |
| `mira-hub/src/lib/cmms/fiix-provider.ts` | 40 | Deep-link only |
| `mira-hub/src/lib/cmms/maintainx-provider.ts` | 40 | Deep-link only |
| `mira-hub/src/lib/cmms/upkeep-provider.ts` | 40 | Deep-link only |
| `mira-hub/src/lib/cmms/deep-link.ts` | 70 | `getCMMSDeepLink` helper + tenant config fetch |
| `mira-hub/src/lib/cmms/tenant-config.ts` | 40 | Cached `tenant_cmms_config` lookup |
| `mira-hub/src/components/cmms/open-in-cmms-button.tsx` | 100 | Shared component |
| `mira-hub/src/app/api/cmms/deep-link/route.ts` | 60 | GET endpoint |

### Modified files

| File | Change |
|------|--------|
| `mira-hub/src/app/(hub)/workorders/[id]/page.tsx:240-244` | Replace inline broken `<a>` with `<OpenInCMMSButton>`. **Fixes existing 404 bug.** |
| `mira-hub/src/app/(hub)/assets/[id]/page.tsx` | Replace CRA-20 inline button with shared component |
| `mira-hub/src/app/(hub)/cmms/page.tsx:11,132` | Replace `DEFAULT_CMMS_URL` const with helper call |
| `mira-hub/src/app/(hub)/workorders/new/page.tsx` | Add button to success splash |
| `mira-hub/src/app/(hub)/conversations/page.tsx` | Add "Linked WO" chip + button per Option A |
| `mira-hub/src/app/api/cmms/stats/route.ts:11` | Use tenant config base_url instead of inline default |
| `mira-hub/src/messages/{en,es,hi,zh}.json` | Add `openIn` key (provider-name interpolation) |

### Migrations

- `008_tenant_cmms_config.sql` (new table)

---

## 7. Phased rollout

**Mike-approved phasing 2026-05-06: Phase 1 ships standalone first** because every customer clicking the WO detail "Open in CMMS" button today is hitting a 404. Bug fix takes priority over the conversations work.

**Phase 1 — Atlas-only abstraction + fix the broken 404 (1.5 days)** — *next up*
- Migration `008_tenant_cmms_config.sql`: table + RLS + seed Atlas row for every existing tenant
- Provider interface (`provider.ts`), registry (`registry.ts`), Atlas-only implementation (`atlas-provider.ts`)
- Deep-link helper (`deep-link.ts`) + tenant config fetch (`tenant-config.ts`)
- API endpoint `GET /api/cmms/deep-link`
- Shared component `<OpenInCMMSButton>` with the dynamic-name + `Connect a CMMS →` fallback per §4.5
- Replace `mira-hub/src/app/(hub)/workorders/[id]/page.tsx:240` broken button with the component (**fixes the 404 bug**)
- Wire same component into `/assets/[id]` and `/cmms` page
- Wire into `/workorders/new` success splash

Verify end-to-end on app.factorylm.com: create a WO → wait for sync → button label reads "Open in Atlas" → click → land on real Atlas record. Pre-Phase-1 broken WOs (no `atlas_id` because they predate the sync worker) should hide the button cleanly instead of 404'ing.

**Phase 2 — MIRA conversation real backend (5-7 days)** — Option B per §5.4
- Migration `009_wo_conversation_link.sql`: add `work_orders.conversation_id`
- Plumb `conversation_id` through `mira-bots/shared/engine.py` and `hub_neon.py` so new WOs link back to their chat
- New endpoints: `GET /api/conversations` (list, real data) + `GET /api/conversations/[id]` (detail)
- New page: `/conversations/[id]/page.tsx` with right-rail showing linked WO + `<OpenInCMMSButton>`
- Update list page `/conversations/page.tsx` from fixtures → data-driven, with "Linked WO" chip per row

**Phase 3 — Multi-provider deep-link stubs + /cmms connector setup UI (1.5-2 days)**
- Maximo / Fiix / MaintainX / UpKeep classes (URL building only, no sync)
- Per-provider URL templates verified against vendor docs (defaults in §4.2; tenants can override per-row)
- `/cmms` page becomes a guided connector setup: Atlas pre-configured (one-click "Activate"), plus "Connect Maximo / Fiix / MaintainX / UpKeep" cards each opening a config form (base_url + auth credential ref)
- Manual smoke test: insert a Maximo config row for a test tenant, point at `https://example.maximo.com`, verify button URL matches expected pattern

**Phase 4 — Admin settings UI (1-2 days, after a real non-Atlas prospect signs)**
- `/settings/cmms` admin page to edit existing `tenant_cmms_config` (different from Phase 3's *initial* connector setup — this is *editing*)
- Validation: probe the configured `base_url` for a 200, surface auth errors
- Doppler secret reference helper

**Phase 5 — Sync extensions (1+ week per provider, on demand)**
- Extend `mira-hub/scripts/cmms-sync-worker.ts` with per-tenant provider dispatch
- Implement `syncWorkOrder` / `syncAsset` per provider (each is its own REST API surface)
- This is the work-intensive part — tackle one provider at a time when a customer commits

Phases 1-3 unlock the "we support Maximo/Fiix/MaintainX/UpKeep" sales conversation without committing to full sync engineering.

---

## 8. Risks & open questions

### Risks

- **Maximo URL pattern drift.** Vendor URL conventions occasionally change between major versions. Mitigation: URL templates are JSONB per-tenant; a customer running Maximo 7.6 can override the default that targets 8.x.
- **Deep-link auth.** Some CMMSes require SSO before the deep-link works; the user lands on a login page. Not our problem to solve, but document in the per-provider override section so customers know to expect it.
- **Atlas's existing inline `https://cmms.factorylm.com` references** in `cmms/stats/route.ts:11` and i18n message placeholders. We'll keep the constant as a fallback default but route reads through the helper. Don't forget the placeholder strings — those are user-facing form hints, not deep-links, and should keep mentioning Atlas/factorylm.com explicitly until tenant settings UI lands (Phase 4).
- **Backwards compat with `wo.atlas_id` column name.** PR #1023 calls it `atlas_id`, not the more generic `external_id`. For now the column stays; the provider layer reads it as the external CMMS ID regardless of provider name. If/when a tenant switches CMMSes, that gets ugly. Track as a follow-up: rename to `external_id` once we have a non-Atlas customer in production.

### Decisions locked 2026-05-06 (Mike)

1. **Button copy:** Dynamic — "Open in {provider.name}" — for every configured provider including Atlas. Generic "Open in CMMS" used only as fallback when provider name is unknown.
2. **`/conversations` strategy:** Option B — real backend first. Schema link `work_orders.conversation_id`, real endpoints, new detail page. Lives in Phase 2 (~5-7 days).
3. **Free-tier behavior:** "Connect a CMMS →" CTA on object pages when no provider is configured, routing to `/cmms`. Atlas pre-seeded for every new tenant (one-click activate from `/cmms`); other providers connectable from the same page.
4. **Phase ordering:** Phase 1 ships standalone. Fix the active 404 bug first; Phase 2 (conversations) follows independently.

---

## 9. Verification plan

- **Migration:** `SELECT provider, base_url FROM tenant_cmms_config;` returns one row per tenant, all `'atlas' / https://cmms.factorylm.com`.
- **Atlas provider URL match:** `getCMMSDeepLink('mike', 'work_order', 'abc123')` returns `https://cmms.factorylm.com/workorders/abc123`.
- **Tenant override:** `UPDATE tenant_cmms_config SET provider='maximo', base_url='https://test.maximo.com' WHERE tenant_id='test-maximo';` then verify the same call returns the Maximo URL pattern.
- **Syncing state:** Create a fresh WO → button immediately shows `syncing` → run sync worker once → reload → button shows `ready` and links correctly.
- **Existing 404 bug regression:** Click the button on every existing WO in a test tenant — none should land on a 404. Atlas-stale records (no `atlas_id`) should hide the button instead of breaking.
- **Cross-locale:** Verify all four `messages/*.json` files render correctly.
- **Deploy:** No regression in `mira-hub` startup logs after deploy. `bun run build` clean. `tsc --noEmit` clean for touched files.

---

## 10. Out of scope (explicit non-bundles)

- mira-bots reply enrichment with deep-links (follow-up issue)
- Tenant-facing CMMS settings UI (Phase 4)
- Maximo/Fiix/MaintainX/UpKeep *sync* implementations (Phase 5)
- Replacing `wo.atlas_id` column name with `external_id` (follow-up after first non-Atlas customer)
- mira-relay / Ignition tag streaming (different concern, lives in `docker-compose.saas.yml`)
