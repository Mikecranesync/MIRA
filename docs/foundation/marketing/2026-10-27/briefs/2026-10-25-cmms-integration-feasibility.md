# CMMS integration feasibility for a first customer (2026-10-25, internal only)

Positioning: MIRA does not need a CMMS to do its job. Integration is an optional add-on. No competitor names go in marketing copy.

## Bottom line
A one-way push of a MIRA job note into the customer's CMMS (Tier b) takes about **2-6 weeks of calendar time**. Most of that is spent waiting on the customer's IT for credentials, a sandbox and a security review, not on coding. Mid-market cloud CMMSs are near the short end; Maximo, SAP, HxGN/Infor and Oracle are near the long end. Offer Tier (a) on day 1, sell (b) as the paid add-on, offer (c) on request, and don't promise (d) to a first customer.

## What already exists in the repo (snapshot /workspace/mira-main-8ca0b52 + GitHub search)
- `nango-integrations/maintainx/`: Nango actions `create-work-order`, `get-asset` and syncs `assets`, `work-orders`, `parts`, with a MaintainX API-key provider (`providers.yaml` notes the key "requires Business plan or above"). This is the closest thing to a reusable connector pattern. It has not been verified as running in prod.
- `mira-hub/src/lib/cmms/`: provider abstraction (`provider.ts`, `registry.ts`, `tenant-config.ts`, `deep-link.ts`) with slugs atlas|maximo|fiix|maintainx|upkeep. Deep links ("Open in X") exist for all of them; **push/sync is implemented only for Atlas**.
- `mira-cmms/`: self-hosted Atlas CMMS (GPL, REST-only boundary). It's an internal or demo CMMS, not a customer integration.
- `mira-hub/src/app/api/work-orders/export.csv/route.ts`: there's already a **CSV export of work orders**, which is the basis for Tier (a).
- Specs: `docs/specs/hub-cmms-integration-spec.md`, `cmms-deep-link-multi-provider-spec.md`, `mira-cmms-spec.md`.
- Open issues (GitHub search, 256 hits): #827 UpKeep and #828 Limble Nango connectors (not built); #2165 docs call the MaintainX/Limble/Fiix connectors "beta" but they need manual setup; #2184 the Channels page shows connectors that don't exist; #2033 no health or last-sync status; #324 Atlas two-way WO sync (open); #800 CMMS 5-min sync; **#3237 cross-tenant Hub DB write in `_post_cmms_work_order` (security, must fix before any customer push)**; #4434 public site claims "auto write" that the product doesn't do; #3057 Nango image tag not pinned. Known WO gaps: #4731 'closed' errors, #4725 no assignment or notifications, #4726 WO not linked to project.
- No Maximo, SAP, Infor/HxGN, Oracle or eMaint API code exists, only deep-link templates for Maximo.

## Systems (public docs)
| System | API | Auth | Access gate | Read assets / create WO |
|---|---|---|---|---|
| IBM Maximo Manage / MAS | REST/JSON (OSLC), `/api/os/mxapiwo`, `mxapiasset` | API key tied to a Manage user (MAS 9: API key or OIDC/SAML only) | Customer admin creates the integration user and key; often on-prem or VPN | Both [1][2][3] |
| SAP S/4HANA PM/EAM | OData `API_MAINTENANCEORDER`, `API_MAINTNOTIFICATION`, `API_EQUIPMENT`; on ECC, BAPIs/RFC | OAuth2 client credentials or Basic; CSRF token for writes | Basis team activates the services and roles (on-prem) or a communication arrangement (cloud); heavy change control | Both [4][5][6] |
| HxGN EAM (formerly Infor EAM) | OpenAPI 3 REST `/axis/restservices/workorders`, equipment, comments | EAM user credentials / tenant | Customer EAM admin | Both, plus WO comments [7] |
| Oracle Fusion Maintenance | REST Maintenance Work Orders | Oracle Cloud user/OAuth | Customer Oracle admin and roles | Both [8] |
| Fiix | Proprietary JSON-over-HTTP API, key per user | API key + secret | **Enterprise plan only** | Both, but v5/v6 object differences [9][10] |
| MaintainX | REST v1 | Bearer API key | Business plan or above (per repo note; recheck) | Both. Connector skeleton already in repo [11] |
| Limble | REST API v2 | Basic (client id/secret) | **Premium+ or Enterprise** | Both [12][13] |
| UpKeep | REST | Org API token (Bearer) | **Enterprise plan only** | Both [14] |
| eMaint X4 | REST API v2 | Basic or JWT (7-day) | Customer account/admin | Both [15] |

## Tiers for a first customer
| Tier | Calendar time | Need from customer | Main risks |
|---|---|---|---|
| (a) Standalone + CSV/email/PDF job note | 0-1 wk (CSV export exists; fix #4731/#4726) | Nothing | Double entry by the tech; fine for a pilot |
| (b) One-way push of job note → WO comment/work log or new WO/notification | Mid-market: 2-3 wks. Maximo/HxGN/Oracle: 3-6 wks. SAP: 4-8+ wks | API tier on their plan; an integration user with minimal rights; **sandbox/test tenant**; field mapping (site, asset id, WO type); security questionnaire | Customer IT lead time; plan upgrades (Fiix/UpKeep Enterprise, Limble Premium+); the #3237 tenant bug; mapping MIRA machine → their asset id; must never write to prod during testing |
| (c) Read their asset list → auto-create MIRA machines | +1-3 wks on top of (b) credentials (read-only is an easier security approval) | Read-only key, asset hierarchy export, which sites | Dirty or huge asset registries (SAP/Maximo have tens of thousands of rows); dedupe vs existing machines (#3708 KG bridge bypass); keeping it in sync |
| (d) Two-way sync (status, assignment, closure back into MIRA) | 2-4+ months | Everything above, plus webhooks/outbound integration config, an owner on their side, a UAT cycle | Conflict rules and system-of-record confusion; contradicts "not a CMMS" positioning; #324/#800 unfinished; ongoing support load |

Fastest real path: CSV import of their asset list (no API) plus Tier (b) push of a comment onto an existing WO. "Add a note to WO #123" is the lowest-risk write, and IT approves it more readily than "create WOs".

## Security/data rules for any integration
- Test only against the customer's sandbox or a trial tenant. No writes to their prod until they sign off in writing.
- Use least-privilege integration users and store keys per tenant in Nango/vault, never in code or chat. Fix #3237 first.
- Customer CMMS data and asset lists must not go to free or third-party-training LLM endpoints. Use only the approved, contracted model path.
- Expect a security questionnaire (SOC2-type questions, data residency, retention: see #2160).

## Sources
1. https://www.ibm.com/docs/en/maximo-manage/cd?topic=reference-maximo-manage-rest-apis
2. https://www.ibm.com/docs/en/maximo-manage/cd?topic=module-api-keys-application
3. https://community.ibm.com/community/user/question/how-to-generate-maximo-manage-api-key-programmatically-in-mas-91-using-api
4. https://api.sap.com/products/SAPS4HANACloud/apis/ODATA
5. https://javadoc.io/static/com.sap.cloud.sdk.s4hana/s4hana-api-odata/3.73.0/com/sap/cloud/sdk/s4hana/datamodel/odata/namespaces/maintenanceorder/package-summary.html
6. https://netray.co/erp-help/sap-pp-pm-mm-api-odata-production-order-material-master
7. https://docs.hexagonppm.com/api/khub/documents/MmP3HEXid3DhIBwLBvsZXg/content
8. https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26d/faumm/how-you-manage-maintenance-work-orders-using-rest-api.html
9. https://helpdesk.fiixsoftware.com/hc/en-us/articles/360018524352-Fiix-API-FAQ
10. https://fiixsoftware.com/cmms/pricing/
11. https://api.getmaintainx.com/v1/docs (and repo nango-integrations/providers.yaml)
12. https://limble.com/pricing
13. https://apidocs.limblecmms.com/
14. https://developers.onupkeep.com/
15. https://api.x4.emaint.com/
