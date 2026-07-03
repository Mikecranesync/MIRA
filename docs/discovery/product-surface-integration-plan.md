# Product Surface Integration Plan — the smallest cohesive beta flow

**Agent D — Product Surface Integrator.** Read-only audit of `mira-hub` (+ `ignition/`) at
main `9a3c6f80` (worktree `mira-integration`, includes #2406 machine-memory card). Code-level
evidence only — no deploy access, so anything about live data/tenant rows is marked
**runtime-unverified**. All paths below are repo-relative unless noted.

---

## 1. Capability table — where can a user actually see/use this today?

| # | Capability | Surface (route → component → API) | Reality | Evidence |
|---|---|---|---|---|
| 1 | Live ingest status (freshness) | `/command-center` → `CommandCenterPage` tree (`tagFreshness` dot per node) + `FreshnessSummary` header + `HubStatusBoard` + `CommissioningPanel` "Live data flowing" item | **REAL**, but split across 3 partial views | Tree: `mira-hub/src/app/(hub)/command-center/page.tsx:227-228,464-465,499-534`; freshness computed from `live_signal_cache` in `mira-hub/src/app/api/command-center/tree/route.ts:141-160` via `mira-hub/src/lib/command-center-freshness.ts`. `HubStatusBoard` (`mira-hub/src/components/hub/HubStatusBoard.tsx`) reads `/api/hub/status` → `mira-hub/src/app/api/hub/status/route.ts:42-52`, but the query **hardcodes** `plc_tag LIKE 'conv_simple.%' OR 'stardust.%'` — it only ever shows the two demo namespaces, not a tenant's real equipment. `CommissioningPanel` (`mira-hub/src/components/command-center/commissioning-panel.tsx`) shows the same freshness rolled into one checklist line via `/api/command-center/commissioning`. **Gap:** no per-asset freshness indicator on the Asset Detail page itself — a user on `/assets/[id]` cannot see "is this asset's telemetry live" without leaving to Command Center. |
| 2 | Approved tags | `CommissioningPanel` checklist item "Approved tags present" (count only) on `/command-center` | **REAL but count-only, no list/browse/approve UI** | `mira-hub/src/lib/commissioning.ts:34,124-125` (`approvedTagCount`), route `mira-hub/src/app/api/command-center/commissioning/route.ts:93-94` (`SELECT COUNT(*) FROM approved_tags WHERE enabled = true`). `approved_tags` is also read server-side (gate, not UI) by `/api/mira/ask/route.ts:219,247,290` and `mira-hub/src/lib/i3x/data-access.ts:110,157`. **No page lists individual `approved_tags` rows** — `commissioning.ts:19` explicitly defers this: *"Remote tag approval (discovered/rejected tags, approve-to-UNS) is deliberately out of scope here — see feat/remote-tag-approval."* Confirmed still absent on main. |
| 3 | Machine memory | Asset Detail → **Overview tab** → `MachineMemoryCard` | **REAL** | Mounted once: `mira-hub/src/app/(hub)/assets/[id]/page.tsx:304` (`<MachineMemoryCard assetId={assetId} />`, inside `OverviewTab`). Component: `mira-hub/src/components/MachineMemoryCard.tsx`. API: `mira-hub/src/app/api/assets/[id]/machine-memory/route.ts` — reads `machine_run` (038), tolerantly reads `machine_state_window`/`run_diff` typed columns (040, may not be applied — falls back). **No other mount point** — not on Command Center, not on the namespace node view, not on `/workorders`. |
| 4 | Latest anomaly / run_diff | Same `MachineMemoryCard`, `latest_diffs` list (severity dot, `tag_path`, `diff_type`, `next_check`) | **REAL**, same single surface as #3 | `MachineMemoryCard.tsx:123-144`. `next_check` is pulled from `run_diff.metadata.next_check` (`machine-memory/route.ts:149-152`). **Nowhere else** — not surfaced in the chat evidence panel (see #6). |
| 5 | Cited answer | (a) Asset Detail → **Ask tab** → `AssetChat` → `POST /api/assets/[id]/chat`; (b) `/namespace` page + Onboarding "upload→ready" step → `NodeChat` → `POST /api/namespace/node/[id]/chat`; (c) public `/quickstart` → `POST /api/quickstart/ask`; (d) `/demo/conveyor/[tag]` → `POST /api/mira/ask` | **REAL, but 4 independent implementations** | (a) `mira-hub/src/components/AssetChat.tsx:143`, tab wired at `assets/[id]/page.tsx:240-242`. (b) `mira-hub/src/components/namespace/NodeChat.tsx` (explicit header comment: "Cloned from components/AssetChat.tsx"), mounted at `mira-hub/src/app/(hub)/namespace/page.tsx` and `onboarding/page.tsx:763-767`. (c) `mira-hub/src/app/quickstart/page.tsx:40` — public, no-auth, OEM-corpus only (ADR-0014), not UNS/asset scoped. (d) `mira-hub/src/app/demo/conveyor/[tag]/page.tsx` + `mira-hub/src/app/api/mira/ask/route.ts` — session-gated live-signal + chat demo view, keyed by asset **tag** not asset id. None of the four share a chat component; (a) and (b) are near-duplicates with diverging evidence rendering (next row). |
| 6 | Evidence source + next check | (a) `WhyMiraThinksThis` (asset chat only) — manual/tag/kg evidence + confidence pill + good/bad/missing-context/needs-review feedback, via `GET /api/decision-trace/[id]`; (b) `SourceChips` (node chat only) — just title/page/url chips from the SSE `sources` event, no confidence, no feedback | **REAL but forked, and inconsistent** | (a) `mira-hub/src/components/WhyMiraThinksThis.tsx`, rendered from `AssetChat.tsx:73` when a `traceId` streams back. Explicit code comment at `WhyMiraThinksThis.tsx:20-22`: PRD §11 fields `decision_path`, `context_ignored`, **`next_check` are intentionally NOT rendered** in this view. (b) `NodeChat.tsx:17-22,45-60` — grepped the node-chat route (`mira-hub/src/app/api/namespace/node/[id]/chat/route.ts`) for `decision_trace`/`traceId`/`trace_id`: **zero matches** — node chat never writes or returns a trace id, so it structurally cannot show confidence/feedback/next-check. **Gap:** the one place "next check" *is* captured (`run_diff.metadata.next_check` on `MachineMemoryCard`, #4) is never cross-linked into the chat evidence view that answers "what should I do next" (a). |
| 7 | Work order action | Asset Detail → Overview → `MachineMemoryCard`'s **"Create work order (soon)" button is `disabled`** (line 154-158); the real flow is Asset Detail → Work Orders tab → `/workorders/new` (3-step wizard) → `POST /api/work-orders` → optional `OpenInCMMSButton` → Atlas SSO | **REAL end-to-end (except the card's own CTA, which is a disabled stub)** | Disabled button: `MachineMemoryCard.tsx:154-158`. Real wizard: `mira-hub/src/app/(hub)/workorders/new/page.tsx` (asset picker hits real `/api/assets/`, photo upload real, submits to real `/api/work-orders/` at line 160-170, success screen offers `OpenInCMMSButton`). Atlas SSO handoff: `mira-hub/src/app/api/cmms/sso/route.ts` — signs a JWT (`HUB_SSO_SECRET`) and redirects to `cmms.factorylm.com/oauth2/success` (**runtime-unverified**: requires `HUB_SSO_SECRET`/`HUB_CMMS_API_URL` configured; 503s cleanly if not). The Asset Detail page's own mock `WorkOrdersTab` (`assets/[id]/page.tsx:351-388`) still renders hardcoded `WO_LIST` — it does **not** hit `/api/work-orders`, unlike `/workorders/new` and the top-level `/workorders` list (unverified whether that list is real — not read in this pass). |
| 8 | Graph/proposal review | `/proposals` and `/graph` are now **permanent redirects** into `/knowledge` — `/knowledge/suggestions` ("Suggestions" tab) and `/knowledge/map` ("Map" tab) | **REAL, consolidated (not absent, just moved)** | `mira-hub/src/app/(hub)/proposals/page.tsx` → `redirect("/knowledge/suggestions")`. `mira-hub/src/app/(hub)/graph/page.tsx` → `redirect(/knowledge/map...)`, preserving `?session=` deep links used by the Ask-MIRA reasoning-trace flow. Actual pages: `mira-hub/src/app/(hub)/knowledge/suggestions/page.tsx`, `.../knowledge/map/page.tsx`, tabs wired by `mira-hub/src/app/(hub)/knowledge/KnowledgeTabs.tsx`. |
| 9 | Onboarding progress | `/onboarding` wizard: company → site → line → **tag-import** → review → upload → try → validate | **REAL and substantially more complete than the task's stated premise — verified stale claim** | Full 8-step flow in `mira-hub/src/app/(hub)/onboarding/page.tsx`. **Correction to the audit brief:** the "known dead-end (no add-equipment step, mock tag import)" is **partially stale on main**. Tag-import (`TagImportStep`, lines 896-1009) still calls `connector_type: "mock"` against `/api/connectors/ignition/import/` and is **honestly labeled**: *"Click to classify the demo Ignition tag set… File import from a live Ignition gateway is coming in a future release"* — so it's an intentionally-marked demo step, not a silent fake. What genuinely IS still missing: **no "add equipment/asset" step** — the wizard creates only `site` + `line` `kg_entities` rows (`finish()` → `/api/wizard/finish`); an actual `Equipment`/asset row (the thing `/assets/[id]` and `MachineMemoryCard` key off) is created separately via the Assets tab's real "New Asset" button (`grep` hit at `assets/page.tsx:482`), which the wizard never links to. The wizard's "try MIRA" step uses `NodeChat` bound to the **namespace line node**, not an asset id — so a user can finish onboarding and chat successfully without ever creating an `Equipment` row, meaning `MachineMemoryCard`/`AssetChat`/work-order-from-asset (#3,#4,#5a,#7) stay unreachable until they separately visit Assets → New Asset. |
| 10 | Ignition Perspective/WebDev + Telegram/Slack | Perspective views: `ConveyorStatus`, `FaultLog`, `NavBar`, `Trends/TrendPanel`, and `Mira/{ConnectSetup, MiraAlertHistory, MiraPanel, MiraSettings}`. WebDev endpoints: `ignition/webdev/FactoryLM/api/{alerts,chat,connect,diagnose,ingest,status,tags}`. Hub side: `/channels` page + `/api/auth/{telegram,slack}` | **REAL, already wired (code-level) — this is the pre-existing deployment surface** | View inventory: `find ignition/project/.../views` (listed above). `MiraPanel` (`ignition/.../views/Mira/MiraPanel/resource.json`) is a Perspective view keyed on `params.assetId` (default `"conveyor_demo"`) with an `AlertBadge` bound to a `Mira_Alerts/{assetId}/Latest` tag expression; its chat affordance calls the WebDev `api/chat` endpoint (`ignition/webdev/FactoryLM/api/chat/doPost.py` + `signing.py`). Hub `/channels` (`mira-hub/src/app/(hub)/channels/page.tsx`) surfaces Telegram/Slack/Google/Microsoft/Dropbox/Confluence connect state via `GET /api/auth/status`; Telegram/Slack each have a real OAuth/webhook route (`api/auth/telegram/route.ts`, `api/auth/slack/{route,callback}.ts`). **This capability needs no new work for the beta flow** — it's a downstream *consumer* per `.claude/rules/train-before-deploy.md`, not something to build toward; the beta flow (below) stops at "approved in the Hub," matching that doctrine. |

---

## 2. The minimal cohesive beta-flow walkthrough

Given the above, here is the **smallest sequence of existing pages** a beta customer needs to
touch for the full "upload → context → cited answer → evidence → work order" loop, and what
each hop actually is today:

1. **`/onboarding`** — company → site → line → skip tag-import (it's demo-only) → review →
   finish. *(Real: creates `kg_entities` site+line rows.)*
2. **`/onboarding` upload step** — upload one PDF manual for the line. *(Real: `/api/uploads/local` → ingest pipeline, polls `/api/uploads/[id]` until `knowledge_chunks_count` > 0.)*
3. **`/onboarding` try step → `NodeChat`** — ask a real question, get a cited answer with
   `SourceChips`. *(Real, but this is the **simple** evidence UI — no confidence pill, no
   feedback capture, because node chat has no decision-trace wiring, #6 above.)*
4. **Detour the customer never takes today: create an actual Equipment/asset row.** The
   wizard's "validate" step (`ValidateStep`, `onboarding/page.tsx:571-672`) already expects one
   — it fetches `/api/assets/` and shows *"No assets yet. Add one from the Assets tab…"* if
   none exist. **This is the seam** — see Smallest Change #1 below.
5. **`/assets/[id]` Overview tab** — see `MachineMemoryCard` (machine memory + latest
   run/window/diffs/next-check, #3+#4) once real `tag_events` exist for that asset's UNS path
   (**runtime-unverified**: needs the machine-memory worker actually running against live tag
   data — per `docs/discovery/2026-07-03-machine-memory-buildout.md`, the worker exists in
   `mira-crawler/run_engine/` but defaults **OFF** unless `MIRA_RUN_DIFF_ENABLED=1`).
6. **`/assets/[id]` Ask tab → `AssetChat`** — cited answer with the **rich** evidence view
   (`WhyMiraThinksThis`: confidence, citations-present, feedback buttons). This is the surface
   that should feel like "the same product" as step 3, but today is a structurally different
   component/endpoint (#5 above).
7. **`/assets/[id]` Work Orders tab → "New" → `/workorders/new`** — create a real work order
   against the asset (photo upload real, submits real). *Note: the tab's own list is mock
   (`WO_LIST`) and never refreshes with the WO just created — a user who creates a WO from
   step 7 does not see it appear in the tab they came from.*
8. **`/command-center`** — the "is my factory actually talking to MIRA" board: freshness dots,
   commissioning checklist (incl. approved-tags count), live-view launcher. This is the
   correct place for a customer to trust step 5's data is real, but nothing on `/assets/[id]`
   links here — a user has to already know `/command-center` exists.
9. **`/knowledge/suggestions` + `/knowledge/map`** — review/accept the KG proposals the
   ingestion in steps 2–3 generated. Reachable from top nav; not referenced from the asset page
   or onboarding "try" step.

**Net observation:** every individual link in this chain is real (not mock) code today. The
gaps are **not missing features** — they are **missing connective tissue** between surfaces
that were each built correctly in isolation (asset-scoped vs. namespace-scoped chat, onboarding
vs. Assets-tab equipment creation, Command Center freshness vs. asset-page freshness, disabled
work-order CTA vs. the real work-order wizard).

---

## 3. Smallest surface changes (≤1 component/route each) to make it feel like one product

Ranked by leverage (biggest coherence gain for least surface area). None require a new
dashboard; all reuse code that already exists.

1. **Add an "add equipment" hop from onboarding's `try`/`validate` step into `/assets` "New
   Asset."** Today `ValidateStep` (`onboarding/page.tsx:630-636`) shows a dead-end message
   ("No assets yet. Add one from the Assets tab…") as plain text with a link to `/assets` —
   not even a button. **Change:** turn that into a real CTA button that deep-links to
   `/assets?new=1&namespacePath={lineNode.unsPath}` (or equivalent), and have the Assets "New
   Asset" form (already found, `assets/page.tsx:482`) pre-fill/pre-bind to that namespace path
   when the query param is present. One route (`/assets`), no new component.

2. **Un-disable `MachineMemoryCard`'s "Create work order" button.** It already has the asset id
   in scope (`assetId` prop) and `/workorders/new` already accepts pre-selection via
   `selectedAsset` state — wire the button to `Link href={/workorders/new?assetId=${assetId}}`
   and have `NewWorkOrderPage` read that query param to pre-select the asset and skip straight
   to step 2. Touches exactly `MachineMemoryCard.tsx` (remove `disabled`, add href) +
   `workorders/new/page.tsx` (read one query param). This directly closes the "disabled stub
   next to a working wizard" incoherence (#7 above).

3. **Surface `run_diff.next_check` inside `WhyMiraThinksThis` when the asset has a recent
   diff.** `WhyMiraThinksThis` already fetches by `traceId`; it doesn't need machine-memory
   data plumbed through the trace — instead, `AssetChat` already knows `assetId`, so pass it
   into `WhyMiraThinksThis` and have it opportunistically call the *already-existing*
   `/api/assets/[id]/machine-memory` endpoint to append a "Related: {next_check}" line when a
   `latest_diffs[0].next_check` exists and postdates the chat message. Reuses two existing
   endpoints; no new API route, no new table read pattern — just one more `fetch` in one
   component.

4. **Make `AssetChat`'s evidence view the ONE evidence component; have `NodeChat` reuse it
   instead of `SourceChips`.** Both already POST to a chat endpoint and both already stream
   SSE. The minimal move is not "unify the two chat components" (out of scope, too big) but:
   have the node-chat route additionally return a `traceId` (write to `decision_trace` the same
   way the asset-chat route already does — that data shape already exists, per
   `WhyMiraThinksThis`'s `Trace` interface) and swap `NodeChat`'s `SourceChips` render for
   `<WhyMiraThinksThis traceId={...} />`. Touches `namespace/node/[id]/chat/route.ts` (add the
   trace write — copy the pattern from the asset-chat route) + one render line in `NodeChat.tsx`.
   This is the single highest-leverage "feels like one product" change: the onboarding "try"
   step and the asset "Ask" tab would show byte-identical evidence UI.

5. **Add a one-line freshness pill to the Asset Detail header, sourced from the Command Center
   tree endpoint.** `/api/command-center/tree` already computes `tagFreshness` per UNS node
   (`rollupFreshness`); the Asset Detail page already fetches `apiAsset` on mount and has no
   equivalent signal. Cheapest fix: extend `GET /api/assets/[id]` (not read in this pass, but
   it already resolves the asset's `uns_path` per the machine-memory route's pattern) to
   include a `tagFreshness` field computed the same way, and render one `FreshnessDot`-style
   badge (the color/label mapping in `command-center/page.tsx:499-518` is already a candidate
   for extraction into a shared `lib/` module rather than copy-pasting the object literal) next
   to the asset status badge in the sticky header (`assets/[id]/page.tsx:181-185`). This closes
   the "customer has to already know `/command-center` exists" gap in the walkthrough (step 8)
   without adding a link-out — the trust signal travels with the asset.

Not recommended for this pass (bigger than "smallest"): merging the 4 cited-answer
implementations into one component/endpoint, building an approved-tags browse/approve UI (it's
explicitly deferred to `feat/remote-tag-approval`), or making the Asset Detail Activity/Parts
tabs real (still 100% hardcoded `ACTIVITY_EVENTS`/`PARTS_LIST` — out of scope for the CV-101
physical-proof milestone, which is about machine memory + cited answers, not parts/PM).

---

## Files read (for reproducibility)

`mira-hub/src/app/(hub)/assets/[id]/page.tsx`, `mira-hub/src/components/MachineMemoryCard.tsx`,
`mira-hub/src/app/api/assets/[id]/machine-memory/route.ts`,
`mira-hub/src/app/api/command-center/tree/route.ts`,
`mira-hub/src/app/(hub)/command-center/page.tsx`,
`mira-hub/src/components/hub/HubStatusBoard.tsx`, `mira-hub/src/app/api/hub/status/route.ts`,
`mira-hub/src/components/command-center/commissioning-panel.tsx`, `mira-hub/src/lib/commissioning.ts`,
`mira-hub/src/app/api/command-center/commissioning/route.ts`,
`mira-hub/src/components/AssetChat.tsx`, `mira-hub/src/components/WhyMiraThinksThis.tsx`,
`mira-hub/src/components/namespace/NodeChat.tsx`,
`mira-hub/src/app/api/namespace/node/[id]/chat/route.ts`,
`mira-hub/src/app/(hub)/workorders/new/page.tsx`, `mira-hub/src/app/api/cmms/sso/route.ts`,
`mira-hub/src/app/(hub)/onboarding/page.tsx`, `mira-hub/src/app/(hub)/proposals/page.tsx`,
`mira-hub/src/app/(hub)/graph/page.tsx`, `mira-hub/src/app/quickstart/page.tsx`,
`mira-hub/src/app/demo/conveyor/[tag]/page.tsx`, `mira-hub/src/app/(hub)/channels/page.tsx`,
`ignition/project/com.inductiveautomation.perspective/views/**` (directory listing),
`ignition/project/.../Mira/MiraPanel/resource.json`,
`docs/discovery/2026-07-03-machine-memory-buildout.md` (prior-agent evidence on `approved_tags`
counts, machine-memory worker default-off state).
