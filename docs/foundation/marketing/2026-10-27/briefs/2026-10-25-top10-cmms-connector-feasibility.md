# Top-10 CMMS connector feasibility (read-only), 2026-10-25
Builds on /workspace/briefs/2026-10-25-cmms-connectors-inventory.md (MIRA main `cb7545e4`). Web research 2026-10-25. Vendor docs and pricing change; items not read on a vendor's own page are marked UNVERIFIED.

## 1. Top 10 (mindshare in industrial/manufacturing)
There is no public vendor-share data for manufacturing CMMS. QY Research names IBM, Dude Solutions (Brightly), UpKeep, Rockwell (Fiix) among key players, with the top 2 at ~25% share, and manufacturing at ~50.6% of CMMS demand [S1]. BRI names IBM Maximo, Fiix, SAP, UpKeep and eMaint [S2]. An AI-answer mention index (Oct 2026) ranks MaintainX 67%, Limble 45%, UpKeep 43%, Maximo 39%, eMaint 39%, Fiix 21%, SAP 5% [S3]. Latka revenue puts MaintainX ($115.5M) ahead of UpKeep ($22.4M) [S4] (UNVERIFIED figures).

**Picked:** MaintainX, Limble, UpKeep, IBM Maximo, eMaint, Fiix, SAP PM (S/4HANA), HxGN EAM (ex-Infor EAM), Fracttal, Hippo (now Eptura Asset). MPulse and Brightly are the alternates; Brightly is more facilities/education than plant floor (UNVERIFIED).

## 2. Per system
| # | System | API / docs | Auth | Access gate | WO / asset R/W | Webhooks | Nango? | Our code | Effort |
|---|---|---|---|---|---|---|---|---|---|
| 1 | MaintainX (Autodesk) | REST v1, api.getmaintainx.com/v1, help.getmaintainx.com/build [S5] | Bearer API key; multi-org header `x-organization-id` | Premium/Enterprise plans only [S5] | R/W WOs, assets, parts, locations; `externalId` on WOs | Yes [S6] | Not in the Nango public catalog [S10]; we have a custom Nango integration | mira-mcp/cmms/maintainx.py, nango-integrations/maintainx/*, mira-connectors mock | **S** |
| 2 | Limble | REST v2, apidocs.limblecmms.com [S7] | Basic (client id:secret) | API Settings in app; plan gate UNVERIFIED | R/W tasks (WOs), assets | Yes, HMAC-SHA256 signed [S7] | No | mira-mcp/cmms/limble.py; Integrations page tile | **S** |
| 3 | UpKeep | REST v2, developers.onupkeep.com [S8] | Org API token (Bearer, new 2026-10-15) or session token | **Enterprise plan only** [S8] | Full WO CRUD, assets | Yes (WORK_ORDER_* events); org tokens can't manage webhooks [S8] | No | none | **S** |
| 4 | IBM Maximo (Manage/MAS) | OSLC/JSON REST `/maximo/api/os/mxapiwodetail` [S11] | `apikey` header | Customer-hosted or MAS SaaS; per-customer admin creates the key | R/W via object structures | Via Integration Framework publish channels → HTTP endpoint, set up per customer [S12] | No | mira-connectors mock only; registry comment "Phase 3" | **M** (schema variance, per-site config) |
| 5 | eMaint (Fluke) | X4 API v2, api.x4.emaint.com [S13] | Basic or JWT (`GetLoginToken`, 7-day) + `Xt-UserAgent` | Plan/add-on gate UNVERIFIED | Generic table API (GetAnyData etc.) | Not documented (UNVERIFIED) | No | none | **M** |
| 6 | Fiix (Rockwell) | RPC-style JSON over `https://<tenant>.macmms.com/api/` [S9] | appKey + accessKey + HMAC-SHA256-signed URL | Per-tenant API application | R/W via FindRequest/AddRequest on WorkOrder, Asset | None documented; poll [S9] | **Yes** (`fiix`, BASIC) [S10] | mira-mcp/cmms/fiix.py; tile | **M** (signing, polling) |
| 7 | SAP PM (S/4HANA) | OData v2 `API_MAINTENANCEORDER`, `API_EQUIPMENT` on SAP Business Accelerator Hub [S14] | OAuth2 CC or Basic (comm. arrangement) | Customer Basis/IT must create a comm. arrangement; SAP partner/certification for an "SAP-certified" claim | Create/update orders; validation-heavy (operation control keys) [S14] | Event Mesh / BTP (customer-side, UNVERIFIED) | Partial: `sap-odata-basic`, `sap-odata-oauth2-cc` auth only [S10] | mira-connectors sap mock | **L** |
| 8 | HxGN EAM (ex-Infor EAM) | REST `/axis/restservices/workorders` [S15] | Auth + tenant + organization headers | Per-customer; Hexagon partner for listing | WO create/get/patch, activities, comments | UNVERIFIED | Infor ION only (`infor`), not EAM-specific [S10] | none | **M-L** |
| 9 | Fracttal | REST, api.fracttal.com/v2-En [S16] | API key/OAuth2 UNVERIFIED | WO create needs the **"Advanced API" add-on** [S17] | R assets/WOs; W WOs/requests with add-on | UNVERIFIED | No | none | **M** |
| 10 | Hippo → Eptura Asset | No public reference found; API credentials via Eptura support [S18] | UNVERIFIED | Contact vendor | UNVERIFIED | UNVERIFIED | No | none | **M-L** (unknown) |
| alt | MPulse | REST API Bundle [S19] | UNVERIFIED | Enterprise add-on to MPACT Advanced [S19] | WO/request create | UNVERIFIED | No | none | M |

**Unified APIs:** Merge and Apideck have no CMMS/maintenance category; Apideck lists accounting, CRM, HRIS, PM, issue tracking and others [S20][S21]. Nango is auth + proxy + sync scaffolding, not a unified CMMS model. Its public catalog covers only Fiix and generic SAP/Infor auth [S10]; MaintainX in our repo is a custom Nango integration (PR #808).

**Marketplaces:**
- MaintainX has a Technology/SI/Referral Partner Program and an integrations page [S22].
- Limble has Technology and Referral partner programs [S23].
- UpKeep has a Channel Partner Program and a 100+ integration ecosystem [S24].
- Fiix lists connectors via its Integration Hub/integrations page [S25].
- SAP Store / SAP certification and IBM Partner Plus / Hexagon partner programs gate formal listings for the enterprise three.
- Listing mechanics (application, review, co-marketing) are vendor-run and not published in detail: UNVERIFIED per vendor.

## 3. Recommendations
**Build order:**
1. MaintainX (S, code exists, biggest mindshare, webhooks).
2. Limble (S, code exists, webhooks).
3. UpKeep (S, clean REST, Enterprise-only).
4. Fiix (M; Rockwell installed base matches our Rockwell-heavy manual corpus; Nango auth available).
5. eMaint (M).
6. Maximo (M; per-site config).
7. Fracttal (M; add-on).
8. HxGN EAM (M-L).
9. SAP PM (L; customer IT project).
10. Eptura/Hippo (unknown until docs are obtained).

The first three are self-serve API-key SaaS and can be done by one dev in about 1 week each including tests (UNVERIFIED estimate). 4-6 are 1-2 weeks each. SAP and Maximo realistically need a design partner customer.

**Minimum viable connector** (matches the #4732 round trip, implemented as a `CMMSProvider` in mira-hub/src/lib/cmms/registry.ts):
1. Connect/test credentials (`health`).
2. **List/search assets**, mapped to a project/notebook.
3. **Create work order** from a MIRA answer, with a back-link and `externalId` = Hub WO id.
4. **Read WO status**, polled (or webhook where offered), so close-with-evidence can mirror "completed".
5. **Close/complete WO** with a note and evidence link.

Defer parts, PMs, meters, users and full two-way field sync.

**Unified API vs build:** no unified CMMS API exists, so the choice is Nango vs direct.
- Nango buys credential storage, OAuth refresh and a proxy. Our targets are mostly API-key/Basic, and we already self-host Nango, but it's disabled on staging and deferred in prod.
- Cheapest path: build the five operations directly in TS behind the existing `CMMSProvider` interface, with credentials per tenant in `lib/cmms/tenant-config.ts`. Add Nango only when the first OAuth vendor (SAP OAuth CC, possibly Maximo SaaS) arrives.
- Retire the duplicate mira-mcp/Nango MaintainX paths once the Hub provider ships (see inventory: CONSOLIDATE).

**Before we can honestly advertise a connector:**
1. A real vendor sandbox/test account on the tier that has API access (MaintainX Premium+, UpKeep Enterprise, Fracttal Advanced API, MPulse Enterprise add-on). Many require a partner agreement or paid seat. Cost UNVERIFIED.
2. An automated contract test per provider for the five MVC ops against that sandbox, green in CI (nightly), plus one recorded end-to-end proof: MIRA answer → WO created in the vendor → completed in the vendor → reflected in the Hub.
3. Production deploy of the provider path. Today the prod compose defers all CMMS/Nango services (docker-compose.production.yml:16-17), so nothing is live yet.
4. Vendor permission for logo/name use, ideally a technology-partner listing. Formal certification is only needed to say "certified" (SAP, IBM).
5. A security answer: per-tenant secret storage, least-privilege scopes, and a documented data-flow.
6. Honest labeling: "Works with X (create & track work orders)", with the supported operations listed, and "beta" until a paying or design-partner customer has used it.

**For customers with nothing (Mike's first ask):** the Hub's own work orders plus the Atlas-based "FactoryLM Works" are the built-in CMMS. Advertising it needs the #4732 round trip green on prod first; Atlas sync is still off by default.

## Sources
- S1 qyresearch.com/reports/5495999
- S2 businessresearchinsights.com/market-reports/computerized-maintenance-management-system-software-market-102205
- S3 parse.gl/markets/artificial-intelligence/cmms-and-facilities-maintenance-software
- S4 getlatka.com/companies/industries/i-cmms-software
- S5 help.getmaintainx.com/build/authentication (+ OpenAPI mirror github.com/api-evangelist/maintainx)
- S6 help.getmaintainx.com/build/webhooks
- S7 apidocs.limblecmms.com; apis.io/asyncapis/limble-cmms/limble-cmms-webhooks
- S8 developers.onupkeep.com; help.onupkeep.com/en/articles/2477562, /2862329
- S9 fiixlabs.github.io/api-documentation/guide.html
- S10 nango.dev/docs/api-catalog.txt (fetched 2026-10-25)
- S11 ibm-maximo-dev.github.io/maximo-restapi-documentation/authentication/apikey/
- S12 ibm.com/docs/en/app-connect/12.0.x?topic=maximo-configuring-integration-framework-route-outbound-event-messages-app-connect
- S13 api.x4.emaint.com
- S14 api.sap.com/products/SAPS4HANACloud/apis/ODATA; SAP Community API_MAINTENANCEORDER threads
- S15 docs.hexagonppm.com (HxGN EAM REST Web Services)
- S16 api.fracttal.com/v2-En/reference/introduction-to-apis
- S17 help.fracttal.com/hc/en-us/articles/25054645108877
- S18 eptura.com/hippocmms
- S19 mpulsesoftware.com/software/integrations/
- S20 developers.apideck.com/apis
- S21 merge.dev/unified-api
- S22 getmaintainx.com/partnerships
- S23 limble.com/partners
- S24 upkeep.com/partners
- S25 fiixsoftware.com/cmms/integrations
