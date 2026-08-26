# Technician Copilot PRD — Phase 0 Audit (repository truth + current-to-target)

**Date:** 2026-08-26 · **Repo truth:** origin/main `17fddd20d` (read at `C:/wt-pick`) · **Scope:** PRD §19 items 1–8 · **Mode:** read-only audit, no code changes.
**PRD under audit:** "MIRA ChatGPT-Quality Technician Copilot PRD" (uploaded 2026-08-25, §0–§20).
**Status legend:** ALREADY SATISFIED / PARTIAL / GAP / CONFLICT / BLOCKED / NOT APPLICABLE.

---

## 1. Repository truth

| Item | Truth |
|---|---|
| origin/main | `17fddd20d` — prod `mira-hub`, `mira-bot-telegram`, `mira-ask`, `mira-pipeline` redeployed 01:04Z on this SHA |
| Audit checkout | `C:/wt-pick` @ `301fa71b5` = `17fddd20d` + docs-only #3408 branch commit |
| Main checkout | `C:/Users/hharp/Documents/GitHub/MIRA` sits on stale `codex/dogfood-useful-work` and does **not** contain `mira-mobile/` — do not audit or build there |
| Worktrees | 47 total (noise). `C:/wt-ota` and `C:/wt-pick` are removable after this audit lands; `C:/wt-copilot-prd` holds #3406 |
| Merged tonight | #3404 OTA manifest · #3405 blank-screen recovery (`mira-mobile/src/lib/resume-guard.ts`, `MainActivity.java`) · #3407 nameplate vision default → `MiniMaxAI/MiniMax-M3` + `NAMEPLATE_VISION_FALLBACK_MODELS` |
| Open, HELD | #3406 Technician Copilot PRD (narrow, P1–P7) + Phase 1 MIME/415 fix · #3408 feasibility doc (photo→manual vs ChatGPT) |
| Open, related | #3300 channel-neutral manual workflow (draft) · #3340/#3341/#3342 MIRA-1000 provider seam + cost telemetry · #3327 Gemini cascade · #3337 retrieval |
| Remaining OTA gate | DNS + nginx for `updates.factorylm.com` — Mike-only |
| Unratified but deployed-against | ADR-0033 (one brain) Proposed; ADR-0036 (nameplate vision + discovery egress) Proposed/NOT accepted yet the arc runs in prod via #3407; ADR-0034 Proposed but shipped |

PR relationships: #3406 ⊂ this PRD (Phase 1↔P1/PLAT-4, Phase 2↔CONV-1..3, Phase 3↔EVID/GRND/DOC, Phase 4↔IDNT/MEM, Phase 5↔LIVE). #3408 is a decision memo, not a spec. Neither is ratified; neither may be cited as authorization.

---

## 2. Authoritative doctrine + conflicts with this PRD

**Supersession, stated plainly:** neither PRD supersedes the other today. #3406's PRD is the lower-altitude *executable phase contract* (self-declared "supersedes nothing"); this PRD is the *strategy layer* (competitive gate, service, CMMS, live, pilot). Recommended: this PRD sits above #3406; #3406 stays the phase plan; both are subordinate to the dogfood constitution (`docs/specs/mira-technician-app-dogfood-system.md`) and root `CLAUDE.md` Hard Constraints until Mike amends those.

| Doctrine | Status | Evidence | Gap / conflict |
|---|---|---|---|
| `NORTH_STAR.md` | PARTIAL | "Lead with the context platform, never with the copilot"; Phase-1 wedge = Drive Commander | PRD §1/§2 lead with the conversational client; Drive Commander/PrintSense pushed to Phase 5+. Aligned on context layer, read-only OT, cited answers |
| Dogfood spec §1.1–1.4 | PARTIAL | Universal Technician, L0–L3 ladder, grounding-not-relaxed | Faithfully restated in PRD §5/§6. Divergence: naming (spec: product=FactoryLM, MIRA=intelligence inside); spec §3 frozen 5-tab shell + door INSIDE Notebook tab vs PRD §8.1 conversation-first launch (`mira-mobile/src/nav.ts:19-23`) |
| `docs/specs/mira-answer-quality-standard.md` | CONFLICT | dim.2 "Hard fail if the reply launches into a fix without naming the asset" | Rubric hard-fails the exact L0 behavior PRD §5 mandates. PRD Phase 2 gate ("general works without setup" AND "15/15 stays green") is impossible under rubric v1.0 unrevised |
| `docs/specs/staging-environment-spec.md` | PARTIAL | Non-goal: no staging UI; gate = `tools/staging_test.py` over Python engine (15 q) | PRD Phases 1–4 are Hub/mobile client work with no staging surface; "canonical 15/15" mapping undefined for the Hub route |
| `docs/specs/hub-mobile-spec.md` | PARTIAL | Partially superseded by ADR-0034; responsive contract still authoritative for Hub web | PRD §8 never references it; must state whether it amends Hub-web IA |
| ADR-0033 one-technician-brain | CONFLICT | "one base model (Qwen3.5-9B) + one adapter"; Proposed | PRD §1 "OpenAI or another frontier model supplies intelligence" silently decides an open ADR and voids WS1–WS6 training program. Compatible: one policy, typed evidence producers, read-only |
| ADR-0034 static Capacitor client | ALREADY SATISFIED | option B shipped (`mira-mobile/`) | — |
| ADR-0036 nameplate vision + egress | CONFLICT | "PROPOSED — NOT accepted"; detector ships DARK; Together vision + Serper egress outside AGENTS.md §2 / PRD §4 | PRD §3.2, INTAKE-003, DOC-001..005 treat the arc as required; PRD adds a third unapproved egress (frontier). Arc is live in prod ahead of the decision |
| `.claude/rules/train-before-deploy.md` | PARTIAL | no HMI deployment without approved asset agent | PRD Phase 5 never requires `asset_agent_status='approved'` |
| `.claude/rules/uns-confirmation-gate.md` | CONFLICT | "No confirmed namespace context, no troubleshooting" | See hard conflict (a) |
| `.claude/rules/direct-connection-uns-certified.md` | ALREADY SATISFIED | QR deep-link certified; reject if id missing | PRD §5.1/INTAKE-004/005 consistent |
| `.claude/rules/fieldbus-readonly.md` | ALREADY SATISFIED | no shipped module opens a fieldbus socket | PRD §0 restates; silent on ADR-0025 desktop carve-out (no contradiction) |

**Hard conflict (a) — "ask without setup" (PRD §0, §5 L0, Journey 1) vs UNS confirmation gate.** Rule: gate applies to *any* question referencing a specific asset/component/fault/tag; resolve → propose → WAIT. PRD: asset selection must never be a prerequisite; L0 may give "safe diagnostic sequences". Also hits the answer-quality rubric dim.2. Reconciliation options: narrow the gate to asset-*specific claims* (matches dogfood §1.1–1.2 + PRD §2.2) and amend rubric dim.2 to score labelled general guidance as correct; or shrink PRD L0 to the rule's educational carve-out. PRD acknowledges neither document.

**Hard conflict (b) — "frontier model as intelligence" (PRD §1, §11.2) vs `CLAUDE.md` Hard Constraint #2.** Allowed: Groq → Cerebras → Together, free-tier, no Anthropic (PR #610). OpenAI is not in the cascade at all; paid frontier spend is excluded. §11.2's *mechanism* (one server-side seam, controlled fallback, no client model names) is already doctrine (`mira-bots/shared/inference/router.py`, `mira-hub/src/lib/inference/canonical-cascade.ts`, #3407); only the provider identity conflicts. Only Mike can change this; #3408 §4.1 says the same.

**Secondary — PRD §3.3 vs #3408.** Same option letters (A/C/D adopted), but the PRD ranks nameplate→manual as MIRA's #2 unique capability while #3408 measures it failing and concludes the heuristic design cannot match a browsing reasoning agent. #3408's option B (frontier engine) is absent from PRD §3.3 yet assumed by PRD §1.

---

## 3. Current-to-target matrix — §8, §9, §10

| Req | Status | Evidence | Gap |
|---|---|---|---|
| 8.1 IA | GAP | `nav.ts:18-24` 5 tabs; `App.tsx:37` default `workorders`; chat = 3rd-level panel `NotebookScreen.tsx:120,214-224` | Not conversation-first; no context chip, history drawer, or context sheet |
| UX-001 composer | GAP | `App.tsx:37,26,52`; composer only at `NotebookScreen.tsx:485-520` | Launch lands on Workorders; no start-time instrumentation; `notebookRoute` not persisted |
| UX-002 messages | GAP | `resources.ts:1021-1025` parses whole body; `sse.ts:51`; `NotebookScreen.tsx:170-172` force-scroll; `app.css:375` pre-wrap | No streaming, no scroll preservation, no Markdown renderer |
| UX-003 send/stop/retry/copy | GAP | 0 `AbortController`/clipboard hits; `NotebookScreen.tsx:483` ErrorState no onRetry; `:501` `setQ("")` before await | No stop/retry/copy; draft destroyed on failure; chat POST has no idempotency key |
| UX-004 attachments | PARTIAL | `native-pick.ts` (#3403); `nameplate-flow.ts:28-304` state machine; PDF door `NotebookScreen.tsx:855,883-900` | Attach not in composer; PDF/paste have boolean busy only; no progress/cancel; MIME/415 fix on #3406 not main |
| UX-005 voice | GAP | 0 speech/voice hits; bare `<input>` | Unverified on device |
| UX-006 citations | PARTIAL | chips `NotebookScreen.tsx:440-479`; sheet `:533-638`; `client.ts:273` requestBinary; screenshots 08-21/08-24 | `FilePreview.tsx:118-120,181-182` cannot render PDF at page; inline `[1]` inert; no revision |
| UX-007 history | PARTIAL | `resources.ts:374-387` server turns; `App.tsx:26,52` tab persisted | `liveTurns` in-memory; `notebookRoute` not persisted → resume/reload lands on list |
| UX-008 errors | PARTIAL | `client.ts:18-53` typed errors; `chat-copy.ts:5-14`; nameplate reasons | No offline state in chat, raw `e.message` on PDF path, no retry action, timeouts collapse to "Network problem" |
| UX-009 no blank states | PARTIAL | `common.tsx` Loadable; `resume-guard.ts` + `MainActivity.java:71-166` (#3405) | No render-level route tests (pure-logic vitest only); disabled buttons w/ tooltip-only explanation `NotebookScreen.tsx:373-388` |
| UX-010 accessibility | PARTIAL | `app.css` 44px targets, tab 56px | 4 aria attrs total; fixed px fonts; no 200% test; contrast unmeasured |
| UX-011 perf/resilience | GAP | single blocking await `NotebookScreen.tsx:499-516`; `timeoutMs 120_000` | No progress, no cancel, Send disabled whole turn |
| UX-012 technician superiority | PARTIAL | evidence badge `NotebookScreen.tsx:462-466`; `N sources` counter; 08-24 L0 screenshots | No persistent machine chip, identity confidence, freshness; no untrained-tech usability result |
| CHAT-001 assetless chat | PARTIAL | `chat/route.ts:392` mode general; `general-mode.test.ts:117`; `NotebookScreen.tsx:509` | Needs a notebook row; no notebook-less door; general derived from `scope.length===0` |
| CHAT-002 one runtime | CONFLICT | `canonical-cascade.ts:93` flag OFF; `assets/[id]/chat/route.ts:56-69`, `namespace/node/[id]/chat/route.ts:58-71` inline Gemini cascades; `router.py` | Four cascades/policies; seam covers provider only |
| CHAT-003 continuity | PARTIAL | `route.ts:402` sanitizeHistory; `resources.ts:1023` sends no history | Mobile follow-ups have zero thread memory; no session tests |
| CHAT-004 context progression | PARTIAL | `[id]/asset/route.ts:48,108`; `chat-asset-context.test.ts` | Only `general_reasoning`/`oem_documentation` bases emitted; no L0→L3 thread test |
| INTAKE-001 doors | PARTIAL | recognize route; `native-pick.ts:101` PDF; `ScanView.tsx` QR | No fault-screen/diagram image path; #3353 picker-not-camera |
| INTAKE-002 QR-optional | PARTIAL | `asset-binding.test.ts:145`; `scan-landing.ts` | No E2E journey per door |
| INTAKE-003 honest failures | PARTIAL | `recognize.test.ts:124-204`; `nameplate/index.ts:73` + `together-fallback.test.ts:40` (#3407) | No quality gate on four named cases; ambiguous identity untested |
| INTAKE-004 confirm identity | ALREADY SATISFIED | `ComponentNameplateFlow.tsx:178-193`; `evidence.ts:428,459`; mig 073 | — |
| INTAKE-005 server-side binding | ALREADY SATISFIED | mig 081; `asset-binding.test.ts:71-205` (15 cases) | legacy null-entity case implied only |
| DOC-001 discovery ranking | PARTIAL | `manual-discovery.ts:23-46`; `manual_search/search.py:250 _score`, `:64 OEM_DOMAINS` | No revision/date; URL/title heuristic; no PDF read; Harrington mis-pick measured (#3408 doc) |
| DOC-002 safe download | ALREADY SATISFIED | `safe-download.ts` + tests `:39-370` | DNS rebinding out of scope; policy duplicated in `search.py:382-437` |
| DOC-003 no silent promotion | ALREADY SATISFIED | `confirm/route.ts:384,408,424`; `confirm.test.ts` | #3390 is UX extension only |
| DOC-004 canonical file | PARTIAL | mig 075 sha256 + links; `confirm/route.ts:439,463` | #3398 listing asymmetry (`display_label` never read) |
| DOC-005 provenance | PARTIAL | mig 075/076; `manual-applicability.ts:27` | No document revision/date; approval inferred from `match_state` |
| NOTE-001 durable notebook | PARTIAL | migs 073/075/081 | No observations/hypotheses/measurements/decisions/outcomes schema |
| NOTE-002 isolation | PARTIAL | mig 073:109-127 RLS; isolation/boundary/passage tests | Mock-level; real-Postgres suite not in CI (#3399) |
| NOTE-003 evidence states | PARTIAL | `notebook-chat-types.ts` 6-value basis; `route.ts:843` | Only 2 bases produced; per-answer not per-claim; shared `parseFrame` drops evidence/safety/usage |
| NOTE-004 citation validity | PARTIAL | `route.ts:326 citationsUsedInAnswer`; passage route gated | No entailment check; beta gate ignores notebook route |
| NOTE-005 abstention | PARTIAL | `route.ts:534`; `manual-rag.ts:291`; boundary tests | No fixed eval for five named cases |
| MEM-001 continuity | PARTIAL | mig 073 turns; `equipment-notebooks.ts:929,1048` | Client-supplied history; mobile omits it |
| MEM-002 attribution | GAP | mig 073:89-101 no author col | No observations table |
| MEM-003 outcomes | PARTIAL | mig 032:92 free-form outcome | No structured symptom/cause/action/parts/result |
| MEM-004 corrections | PARTIAL | `proposal-transition.ts:45`; ADR-0017; mig 073:53 | No turn-level correction/supersedes |
| MEM-005 prior incidents | PARTIAL | `prior_decisions.py`; `engine.py:5140-5615` | Python-only; absent from Hub/mobile; no applicability check |
| SERVICE-001 commissioning capture | PARTIAL | qr-onboarding skill; migs 055/056/081 | No criticality/ownership/scope; no single workflow doc |
| SERVICE-002 doc validation | PARTIAL | mig 056/067/072 hashes + HITL | No commissioning report (accepted/rejected/missing) |
| SERVICE-003 maturity report | PARTIAL | migs 004/061/047/018 | No customer-facing report route |
| SERVICE-004 export | PARTIAL | `/api/contextualization/[id]/export` uns/i3x; CSVs | No sanitized source bundle |
| SERVICE-005 data checklist | GAP | only CLF training-provider docs | No pre-upload classification/retention/destination checklist |
| CHANNEL-001 thin adapters | CONFLICT | `telegram/bot.py:46,149`, `slack/bot.py:315-318` → `engine.py:1414`; hub 929-line TS route | Two brains; ADR-0033 Proposed |
| CHANNEL-002 portable threads | PARTIAL | mig 073/081; both TS clients hit one route | 0 `notebook` hits in `mira-bots` |
| CHANNEL-003 no privileged bypass | CONFLICT | `mira-mcp/server.py:331,361,682,721,804,911-931` | Caller-supplied tenant_id, shared key, ungated CMMS writes |
| LIVE-001 no cloud→PLC | PARTIAL | `relay_server.py:723-733` inbound only; bench writes fenced | No repo-wide architecture test for fieldbus clients |
| LIVE-002 allowlist | PARTIAL | mig 035; `tag_ingest.py:390`; 3 fail-closed tests | No units/classification columns |
| LIVE-003 freshness | PARTIAL | `tag_ingest.py:68`; migs 033/036 | No units on `tag_events`/cache |
| LIVE-004 canonical ingest | ALREADY SATISFIED | `tag-stream.py` read-only; HMAC `auth.py`; ~30 relay tests | — |
| LIVE-005 replay | PARTIAL | `simlab/api.py:245` seeded replay | No file/CSV value replay |
| LIVE-006 tool-grounded traces | PARTIAL | `decision_trace.py:147`; mig 032; `live_snapshot.py:365` STALE | No per-tool-call hashes |
| CMMS-001 read-only packs | ALREADY SATISFIED | `test_drive_packs_readonly.py` AST gate | Gate scopes packs only |
| CMMS-002 draft-before-write | PARTIAL | `engine.py:4506,4755,4762`; `wo_outbox.py` | Free-text yes/no; no field preview, audit row, or idempotency on adapter POST |
| CMMS-003 no silent side effects | GAP | `server.py:331,361,950` ungated tools | No negative test proving model text cannot reach write |
| 10.1 safety | PARTIAL | `chat/route.ts:404-431,497-507`; `safety-classifier.ts`; 7 tests | Fail-closed on exceptions unproven; TS/Py lists duplicated, parity-test only |
| 10.2 authorization | PARTIAL | `session.ts:76-115` UUID-only; RLS 073/056 | No role/site/asset layer; MCP tenant caller-supplied |
| 10.3 data handling | PARTIAL | migs 067/072/073; CLF docs; delete `equipment-notebooks.ts:752` | Retention "keep-forever open question" (mig 032); no residency |
| 10.4 input/download | PARTIAL | `safe-download.ts:269-360`; `route.ts:394` 4000-char cap | Nameplate trusts client MIME (`recognize/route.ts:72-73`, fix on #3406); MCP leaks raw exceptions (`server.py:670`) |
| 10.5 auditability | PARTIAL | migs 032/070/071/080; `persist-usage.ts:60` | No prompt/policy version, user id, approval, side-effect id, or correction; spend rows only when seam flag ON |

---

## 4. Verified map — mobile ask / upload / nameplate / manual / notebook / citation

All paths `C:/wt-pick/mira-mobile/src/...` (client) and `C:/wt-pick/mira-hub/src/...` (server).

| Step | Client | Server / downstream | Risk |
|---|---|---|---|
| Launch → auth → composer | `main.tsx:16` confirmBundleReady → `:25` resume guard; `App.tsx:46-104` boot/Login; `nav.ts:21-27` frozen tabs | `GET /api/me/`; NextAuth credentials | No composer at launch (UX-001); no boot/auth test |
| General ask | `NotebookScreen.tsx:509` mode=general iff scope empty | `chat/route.ts:392,825-858` | No deliberate general mode; needs notebook row |
| Chat → SSE | `client.ts:158-178` buffers full body → `sse.ts:51-76` | `route.ts` frames sources/evidence/status/content/safety/usage | Not streaming; **`kind:"safety"` frame dropped by `sse.ts:64-71`** (amber banner never renders); no followups frame exists anywhere |
| Upload/attach | `native-pick.ts:100` pickPdf; `resources.ts:466-492,627-649`; `attach-selection.ts:81-92` idempotent | `/api/files`, `/api/namespace/node/[id]/files`, `/sources`; `node-knowledge-ingest.ts` BM25-first, embed best-effort | No progress/cancel (`client.ts:216-247`); "indexed" may be BM25-only |
| Nameplate → manual → bind | `NotebooksTab.tsx:126`, `ComponentNameplateFlow.tsx:67-117`; `nameplate-flow.ts:131-257` reducer w/ honesty gate `:202` | recognize (parks photo first, MIME allowlist `:33`) → confirm (`:243,282,336-344,361,384,425`) → `manual-discovery.ts:99` → `mira-ask /manual-discovery/search` → `safe-download.ts` → ingest → `manual-applicability.ts` | **Risk A (fixed): 502 all evening 2026-08-25** — `google/gemma-3n-E4B-it` retired to dedicated-only; #3407 default `MiniMaxAI/MiniMax-M3` + fallback list, deployed 01:04Z. **Risk B (open): wrong manual** — Harrington UMS3-0335 end truck → lever-hoist brochure; `search.py:250 _score` URL/title heuristic, `harrington` absent from `OEM_DOMAINS`, no candidate PDF read (`docs/discovery/2026-08-26-feasibility-photo-to-manual-vs-chatgpt.md:17-37`) |
| Citation tap | `NotebookScreen.tsx:440-478,533-635`; `client.ts:273-326` requestBinary | passage route; `/api/namespace/files/{id}` | `FilePreview.tsx:118-120,181-182` cannot open at page; no revision |
| Offline / WO | `offline-queue.ts`; `Workorders.tsx:118,429`; `App.tsx:145-157` | `/api/work-orders` client_key | Chat not offline-capable; draft cleared before send (`NotebookScreen.tsx:501`) |
| Resume / OTA | `resume-guard.ts:24-65`; `live-update.ts:31-203`; `MainActivity.java:71-77` | `/api/mobile/live-update/manifest` | Recovery = reload → `liveTurns` + draft lost; native half untested by CI |

Strong and not to be relitigated: nameplate honesty gate (`nameplate-flow.ts:202`, tests `:288,:374`), deterministic attach request, fail-closed cookie/auth, park-photo-before-recognize (why the 502 cost no photos).

---

## 5. Verified map — provider / safety / retrieval / telemetry seams + connectors

**One runtime or two? TWO.** Telegram/Slack → Python `shared/engine.py` Supervisor (`telegram/bot.py:46,149`, `slack/bot.py:315-318`). Mobile + Hub web → TypeScript `equipment-notebooks/[id]/chat/route.ts` (own prompt, retrieval, safety port, cascade). `canonical-cascade.ts` header states this itself. ADR-0033 Proposed, not enforced.

| Seam | Where | Status |
|---|---|---|
| Text providers | Hub `canonical-cascade.ts:93-104` (flag `MIRA_CANONICAL_SEAM=1`, default OFF); legacy inline `route.ts:140` with Gemini 3rd slot; Py `router.py:253,460`; registry `factorylm_ai/provider_registry.py:100` | Seam exists, default OFF in repo (Doppler value UNKNOWN); legacy path violates Hard Constraint #2; `router.py` never imports registry |
| Vision | `nameplate/index.ts:64-241` Together only; fallback list opt-in, empty by default (`:80-85`); `router.py:324` single model, no fallback loop | Single-provider fragility proven tonight |
| Safety stop | `safety-classifier.ts:26-99` (hand transcription of `guardrails.py:11,88`); fires `route.ts:419/497` before provider | Duplicated policy; no CI diff; exception path unproven |
| Retrieval | Hub `manual-rag.ts:20,296,396` BM25-only (no pgvector); Py `neon_recall.py:934` hybrid vector+BM25; citations `citationsUsedInAnswer` ([n] filter) vs Py `citation_compliance.py` (vendor/attribution, fail-open) | Split retrieval brain; paraphrase → insufficient_evidence on mobile |
| Telemetry | `persist-usage.ts` → `decision_traces` (migs 032/055/070/071/080), gated by same OFF flag (`route.ts:672`); Py → SQLite `api_usage` (`router.py:686-698`), `est_cost` hardcoded $0 | Zero token/cost telemetry on technician path with flag off; two sinks |
| Quality gate | `tools/staging_test.py` (15 q, hard_fails==0, LLM judge, 2 attempts) over Python Supervisor | Does **not** grade the Hub notebook route the phone uses |

**Connectors — is there any cloud-to-PLC write path? NO, in shipped code.** `mira-relay/relay_server.py:723-733` inbound + read routes only; Sparkplug consumer subscribe-only; `ignition/gateway-scripts/tag-stream.py` browse/read only; Ignition writes only to `Mira_Alerts/*` memory tags. Modbus writes exist only in bench-fenced `plc/live_monitor.py:234,247` and `plc/vfd_fix_attempts.py:157-253` (`docker-compose.fault-detective.yml`). `mira-connect` ModbusDriver read-only by absence, in no compose. Static enforcement exists only for `drive_packs/` (`test_drive_packs_readonly.py`); `tests/test_architecture.py` has no fieldbus assertion → LIVE-001 acceptance unmet *as written*.

**CMMS writes DO exist:** `create_work_order` on Atlas/MaintainX/Limble/Fiix (`mira-mcp/cmms/*.py`), `atlas_cmms.py:62` + `wo_outbox.py`, Nango `create-work-order` action, and ungated MCP tools `server.py:331,361,950` with caller-supplied `tenant_id` and one shared `MCP_REST_API_KEY` — the "privileged bypass" PRD §9.9/§10.2 forbid. Engine FSM gate (`cmms_pending`) is bypassable by any MCP holder.

Foundations to keep: one-pipeline ingest contract (`mira-relay/ingest_contract.py`, `test_architecture.py:261`), fail-closed allowlist, freshness that cannot cache bad/stale as live (`tag_ingest.py:68`), append-only `tag_events`.

---

## 6. Smallest blocker set — physical Pixel full core loop (§13.2 steps 1–15)

Ranked. "Blocks" = steps that cannot be recorded as PASS today.

| # | Blocker | Blocks | Evidence |
|---|---|---|---|
| 1 | **Manual discovery picks the wrong document** (heuristic `_score`, no PDF read, `harrington` not in OEM_DOMAINS) | 6, 7, 8, 9 (Journey 2 fails on the Harrington case) | `search.py:250,64`; feasibility doc §2 table |
| 2 | **Citation cannot open at the cited page** in-app | 9 | `FilePreview.tsx:118-120,181-182` |
| 3 | **No thread memory on mobile** — `history` never sent | 10 | `resources.ts:1023` vs `NotebookChat.tsx:220` |
| 4 | **Provider/timeout failure destroys the draft and offers no retry**; safety frame dropped | 13 | `NotebookScreen.tsx:501,483`; `sse.ts:64-71` |
| 5 | **Resume reload loses live turns + open conversation** (lands on list) | 11 | `resume-guard.ts:61`; `App.tsx:42` not persisted |
| 6 | **Nameplate MIME/415 fix not on main** (JPEG from picker → octet-stream → 415) | 4 | `native-pick.ts:57,88-91`; fix on #3406 |
| 7 | **No assetless door** — general ask needs a notebook row; no composer at launch | 3 (passes only via "create empty notebook" workaround) | `App.tsx:37`; `NotebookScreen.tsx:509` |
| 8 | **OTA host not live** (`updates.factorylm.com` DNS+nginx) | 1, 15 | Mike-only gate |
| 9 | Chat POST has no idempotency key | 14 (message half) | `resources.ts:1021-1024`; `client.ts:333` |

Steps 2 (#3405), 5 (INTAKE-004), 12 (mig 081 bind/unbind) are believed passable but **no recorded Pixel run exists** for them at `17fddd20d`; the vision 502 (step 4) is fixed by #3407 and needs a fresh device run to confirm.

---

## 7. Bounded PR plan

Ordering = user value ÷ risk. Every slice: read-only toward OT, no second runtime/notebook/ingest door, no merge/deploy without Mike, §0 "required output" in the PR body. Device gate = a recorded Pixel 9a run per §13.2.

| # | Slice | Scope | Files | Acceptance tests | Device gate | Must NOT |
|---|---|---|---|---|---|---|
| 1 | **Journey 2 passes on Harrington: model-judged candidate reading** | Before selecting, fetch top-N candidates via existing `safe-download`, extract first pages, ask the *existing text cascade* to judge "is this the manual for `{mfr} {model}`?"; add `harrington`/`aceindustries` to OEM_DOMAINS as mitigation; return `reason` naming the judged evidence | `mira-bots/shared/manual_search/search.py` (+ `judge.py`), `mira-hub/src/lib/manual-discovery.ts` (reason passthrough), tests `mira-bots/tests/test_manual_search_*.py` | Offline fixture: UMS3-0335 candidate set from the feasibility doc → correct Series 3 End Trucks manual ranked #1, brochure rejected with reason; no-manual case returns `candidate_review` not a guess; safe-download tests unchanged | **Yes** — nameplate→manual→cited answer on the real Harrington plate | Does **not** require relaxing Hard Constraint #2: judging runs on Groq/Cerebras/Together text models. Must not add browsing/Serper beyond current egress, must not auto-attach unvalidated candidates (DOC-003 stays), must not touch Supervisor |
| 2 | Mobile turn resilience | Send `history`; keep draft until success; per-turn retry; handle `kind:"safety"` frame with amber banner; idempotency key on chat POST | `mira-mobile/src/api/resources.ts`, `lib/sse.ts`, `screens/NotebookScreen.tsx`, `app.css`; hub route accept `clientKey` | vitest: parseChatSse safety frame; draft-preserved-on-error; history payload shape; hub test: duplicate clientKey returns same turn | Yes (steps 10, 13, 14) | No new route; no client-side model names |
| 3 | Nameplate MIME truth (land #3406 Phase 1) | Picker MIME + server byte sniffing → 415 only for real non-images | `native-pick.ts`, `mira-hub/src/lib/nameplate/image-mime.ts`, recognize route | existing #3406 tests | Yes (step 4) | Do not merge #3406's PRD text with it — split docs from code |
| 4 | Conversation resume + persisted route | Persist `notebookRoute`; rehydrate turns after reload; instrument cold/warm start to composer | `App.tsx`, `NotebookScreen.tsx`, `lib/resume-guard.ts` | vitest for route persistence; timing log frame | Yes (steps 2, 11) | No 6th tab; door stays inside Notebook tab (`nav.ts` frozen) |
| 5 | Citation opens at page | Render PDF page in-app (pdf.js bundled, no CDN) at cited page; show revision if present | `screens/FilePreview.tsx`, `NotebookScreen.tsx` | vitest page-arg plumbing; screenshot at p.N archived | Yes (step 9) | No external viewer hand-off of session cookie |
| 6 | Assetless door inside Notebook tab | "Ask MIRA" composer on `NotebooksTab` home that creates/uses a tenant "General" notebook; explicit general/grounded toggle | `NotebooksTab.tsx`, `NotebookScreen.tsx`, hub: reuse existing route | vitest; hub general-mode tests extended | Yes (step 3) | Must not bypass UNS gate for asset-specific *claims*; must not add a notebook-less server route |
| 7 | Streaming + Markdown | Incremental SSE via CapacitorHttp stream or fetch; scroll-guard; bundled Markdown renderer + sanitizer | `client.ts`, `sse.ts`, `NotebookScreen.tsx` | vitest incremental parser; render snapshot | Yes (UX-002/011) | No change to server frame grammar |
| 8 | Flip `MIRA_CANONICAL_SEAM=1` + remove legacy Gemini cascades | Delete inline `providers()` in 3 hub routes; spend telemetry on | `canonical-cascade.ts`, 3 chat routes, compose env | existing seam tests; Gemini absent grep-gate | No (staging gate) | No provider identity change; no Anthropic/OpenAI |
| 9 | CMMS-003 negative gate + MCP tenant fix | Confirmation token + idempotency on `cmms_*_work_order`; tenant from auth not arg | `mira-mcp/server.py`, tests | negative test: model text cannot create WO without token | No | No new write capability |

Slices 1–6 are the Phase 1/3 minimum for §13.2; 7–9 are Phase 1 polish and §10 hardening. Slice 1 explicitly does **not** need the provider constraint relaxed; whether the *quality* ceiling of a free-tier judge is acceptable is Open Question 1.

---

## 8. Recommendation on #3408 and #3406

**#3408 → LINK, don't merge as-is; amend to become §3.3's missing row.** It is a measured decision memo (Harrington evidence, option B) that contradicts PRD §3.2's ranking of nameplate→manual. Keep it as `docs/discovery/`, add a header "Input to the Technician Copilot PRD; not ratified", and amend the PRD: add option B to §3.3, restate DOC-001 as "model-judged candidate reading", and cite #3408's table as the baseline slice 1 must beat. Do not let it replace the PRD — it has no requirements, journeys, or gates.

**#3406 → split.** Merge its Phase 1 code (MIME/415, slice 3) after a fresh device run; move its PRD text to `docs/prd/` as the *executable phase plan* explicitly subordinate to this PRD, with conflicts (a)/(b) and the 5-tab vs conversation-first divergence written into both documents rather than silently resolved. Neither PRD is authorization; this audit is the reconciliation layer between them.

---

## 9. Open questions for Mike

1. **Provider constraint:** keep Hard Constraint #2 (free-tier Groq/Cerebras/Together, no Anthropic, no OpenAI) as-is, or amend `CLAUDE.md` + AGENTS.md §2 to permit a paid frontier provider behind the single seam? Slice 1 works either way; PRD §1 as written does not.
2. **UNS gate scope:** narrow `.claude/rules/uns-confirmation-gate.md` + rubric dim.2 to asset-specific *claims* (enables L0), or shrink PRD L0 to educational-only?
3. **ADR-0036:** accept option A/C or B/D for Together vision + Serper egress — the arc is already live in prod ahead of the decision.
4. **Merge authorizations:** slice 3 (#3406 Phase 1 code) and slice 1 after device proof — yes/no, and are the docs halves of #3406/#3408 to land separately?
5. **IA:** does the frozen 5-tab shell stand (door inside Notebook), or does PRD §8.1 conversation-first launch amend the dogfood spec §3?
6. **Service-vs-app:** is the standalone client still the lead artifact through the §14 pilot, or do we sequence C (commissioning) → D (Drive Commander) first per NORTH_STAR and treat the app as one surface?
7. **Pilot scope:** which real technician(s), which tenant fixture, and is a personal ChatGPT Projects side-by-side with customer documents authorized (SERVICE-005 checklist does not exist yet)?
8. **OTA gate:** when can `updates.factorylm.com` DNS + nginx be done so §13.2 steps 1/15 can be recorded?

Nothing was merged or deployed by this audit.
