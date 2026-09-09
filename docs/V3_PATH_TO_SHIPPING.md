# V3 → shipping: what actually remains

**Measured 2026-09-08, not estimated.** Counts read from the tree.

---

## Where V3 stands

| | Hub today | mira-mobile today | **V3** |
|---|---:|---:|---:|
| User-facing routes | **69** | ~14 screens | **1** (`/v3`) |
| API endpoints reachable | **175** | 14 families | **1** (`/api/hub/ask`) |
| Ships to users | yes | sideloaded, v1.1.0 | no |

V3 answers a general question with citations, and does that part well. **It is roughly 1.5% of the Hub's surface.** Every number below follows from that gap.

---

## 1. The three things V3 must gain to be a product, not a demo

Nothing else matters until these exist, because without them a technician cannot do the job the app is for.

### 1a. Scope — ask *about* something
Today V3 says "No machine — general". The whole product claim is a grounded answer about **a specific machine**. Needs:
- a machine picker in the scope badge (`/api/assets`, exists)
- the scoped chat path (`/api/assets/[id]/chat`, exists) instead of `/api/hub/ask`
- the UNS confirmation gate honoured on the way in

**Nothing new server-side. This is wiring.**

### 1b. Attachments — the photo→nameplate spine
The composer has `＋` and `◉` buttons that do nothing. Needs:
- file/photo upload (`/api/documents/upload`, `/api/files`, exist)
- nameplate recognition (`/api/equipment-notebooks/recognize-nameplate`, exists)
- upload progress and a real failure state

**Nothing new server-side.**

### 1c. History — conversations that persist
V3 forgets everything on reload. The sidebar's Recent list is fixture. Needs:
- notebook/turn persistence (`/api/equipment-notebooks/[id]/chat`, exists)
- conversation list + reopen
- scope restored with the conversation

**Nothing new server-side.**

> **The pattern: 1a–1c are all wiring.** The Hub already has the endpoints, and mira-mobile already calls most of them. This is the single most important fact in this document — the backend is not the constraint.

---

## 2. Capability parity with the Hub

The 69 routes are not 69 features. Grouped by what a technician actually reaches for:

| Group | Hub routes | Needed in V3 for parity | Status |
|---|---|---|---|
| **Ask / conversations** | conversations, equipment/[id] | the thread itself | **partly built** |
| **Assets & machines** | assets, assets/[id], equipment, scan, print-qr | machine list, detail, QR/scan entry | wiring |
| **Documents & manuals** | documents, knowledge/manuals, library, equipment/[id]/source/[docId] | upload, browse, open a cited source | wiring |
| **Work orders & PM** | cmms, schedule, work-orders, parts | list, create from an answer | wiring |
| **Namespace & knowledge graph** | namespace, graph, knowledge/map, contextualization, proposals | *inspector only* — do NOT put the graph on the home screen | Phase 7 |
| **Admin & org** | admin/*, team, integrations, channels, event-log, reports | behind More › | Phase 7 |
| **Onboarding & billing** | onboarding, upgrade, signup, quickstart, pending-approval | keep the existing flows intact behind the new shell | Phase 5 |

**The recon's rule applies to all of it:** five primary items plus `More ›`. The other ~60 routes live behind More or inside the inspector — reachable, not on the front page.

⚠️ **The drawer's `More ›` currently goes nowhere.** A row advertising a submenu that does not exist is worse than the thirteen items it replaced. That is the next concrete gap.

---

## 3. What the vision adds beyond parity

From the charter, in its own order. These are *new*, not ports:

- **Phase 3 — the Golden Conversation.** One thread proven end to end: sign in → project → folder → machine → ask → attach → cited answer → inspect source → save finding → reopen on another surface with identical context. **This is the release gate, not a feature.**
- **Phase 6 — projects, folders, Work mode.** Diagnostic Runs as isolated reviewable investigations; findings promoted to machine memory only through explicit review.
- **Phase 7 — enterprise inspector.** Identity, evidence provenance, machine history, namespace, signals, permissions, audit — around the same thread rather than as separate destinations.

---

## 4. Live mobile app

mira-mobile already imports the shared shell (`@factorylm/ui`) through `UnifiedChat`, behind a device-local toggle. So mobile does not need a rebuild — it needs the shell to become V3, then the toggle removed.

| Step | State |
|---|---|
| Shell shared with web | **already true** — tsconfig path alias to `packages/factorylm-ui` |
| V3 design landed in that package | **not started** — V3 lives in `mira-hub/src/app/v3` and a prototype |
| Platform adapters (camera, QR, picker, Back, safe areas, keyboard) | partly built (`capacitor-adapter.ts`) |
| Toggle removed, unified becomes the only surface | not started |
| **OTA delivery** | **broken — #3664 open.** The updater fetches an authenticated manifest without a session. Fixed on #3661, unverified on a handset. |
| Play Store | `applicationId com.factorylm.mira`, versionCode 10, **sideloaded today** |

**The honest blocker for "live mobile app" is not UI — it is delivery.** Until OTA works and a signed build is verified on a handset, every UI change requires a manual install.

---

## 5. Web experience

`/v3` is mounted at a non-default route, which is correct for Phase 2. To become the web experience:

1. Reach parity on the §1 items.
2. Move the shell into `packages/factorylm-ui` so web and mobile share one implementation — otherwise every fix is written twice, which is the divergence we are trying to end.
3. Flip `/` from `/feed` to the new shell. **One line, and the last step, not the first.**
4. Keep the existing commercial/checkout services intact behind it (charter Phase 5).

---

## 6. The order I would build in

1. **`More ›` opens something.** Smallest fix, removes a promise the UI is currently breaking.
2. **Scope picker** (§1a) — turns V3 from a search box into the product.
3. **Attachments** (§1b) — the photo→nameplate spine.
4. **History** (§1c) — conversations persist and reopen.
5. **Move the shell into `packages/factorylm-ui`** — before more surface is built twice.
6. **Machines / Documents / Work orders behind More** — parity for the groups a technician reaches for.
7. **OTA verified on a handset** — unblocks shipping mobile at all.
8. **Golden Conversation end to end** — the release gate.
9. **Flip `/`.**

Steps 1–4 are wiring against endpoints that already exist. Step 5 is the one that stops the work doubling. Step 7 is the only one that is not a UI task and it is on the critical path for mobile.

---

## 7. What I do not know

- **Which surface your phone was showing** when you tested — the unified toggle is device-local, so "the base was built and tested" may describe either shell.
- **Whether the 175 API endpoints are all live** — I counted route files, not working endpoints.
- **Play Store status** — versionCode 10 suggests uploads have happened; I have not verified the listing.
- **Whether `/feed` has users depending on it** — flipping `/` assumes not.
