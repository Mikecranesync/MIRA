# General Intelligence Parity — current-state architecture map (Phase 0)

**Program:** MIRA General Intelligence Parity (build plan, 2026-08-30) · **Milestone:** GI-1 "MIRA must not be worse than the model"
**Base audited:** `origin/main` @ `6250dd442` (+ PR #3486 Workstream C contracts, not yet merged)
**Doctrine:** `.claude/rules/general-intelligence-preservation.md`
**Benchmark:** `evals/general-intelligence/` (this PR establishes the harness + corpus; no orchestration change ships until baselines exist)

This is the audit the plan requires *before* code changes (§21). It maps every answer path, every gate that can suppress an answer, the image/nameplate pipelines, web-search support, citation persistence, provider abstraction, and the private-data capabilities that can become tools. No speculative deletions.

## 1. Answer paths (every route that generates an answer)

| Path | Surface | Input | Model access | Gates that can suppress | Notes |
|---|---|---|---|---|---|
| `POST /api/equipment-notebooks/[id]/chat` (`mira-hub`) | phone + Hub web notebook | text, `sourceDocIds`, `history`, `machineEvidence` (window ids), `visualEvidence` (`fileId` only), `mode:"general"` | canonical seam (`inference/canonical-cascade.ts`: Groq → Cerebras → Together, text only) | `no_sources_selected` 422 unless `mode:"general"`; Gate G `insufficient_evidence` (0 chunks, no machine window); approved-context 412 (machine-evidence turns only); WSC 422 `machine_window_empty` / `machine_history_unavailable` (only when a replay window is explicitly requested); safety stop | **The primary conversation engine.** General mode exists (text-only, no retrieval, bracket-stripped). The model never sees image pixels here — a photo becomes a `visual_observation` entry whose text came from the LOOK route. |
| `POST /api/equipment-notebooks/[id]/look` | phone LOOK | one image | `togetherVisionCall` (MiniMax-M3 by default; Groq iff `GROQ_VISION_MODEL`) — **direct**, outside the seam | image MIME/size | Fixed inspection prompt; returns an observation string. Vision is a sidecar, not a conversation. |
| `POST /api/equipment-notebooks/[id]/nameplate/recognize` + `/confirm`, `POST /api/equipment-notebooks/recognize-nameplate` | phone READ | image | same vision recognizer (`lib/nameplate/`) | field-validation invariants | Structured identity extraction; then manual discovery. Good future **tool** (`extract_nameplate`). |
| `POST /api/assets/[id]/chat` | Hub asset page | text | canonical seam | approved-context 412; `verified=true` on attached docs under the gate | Asset-bound; machine packet + docs. |
| `POST /api/namespace/node/[id]/chat` | Hub folder chat / legacy beta gate | text | canonical seam | subtree retrieval only; `verified===true` filter under the gate | No general fallback. |
| `POST /api/mira/ask` (`mira-hub`) + `mira-bots/ask_api` (`mira-ask`) | kiosk / AskMira / Ignition | text | engine cascade | namespace gate 412 (`session.status != confirmed`), approved-context 412, provider-outage gate | Direct-connection surface by design (UNS-certified). |
| Telegram / Slack (`mira-bots/shared/engine.py` Supervisor) | chat adapters | text, photos | `InferenceRouter` cascade; vision via `qwen2.5vl` / print-translator fast-paths | UNS location-confirmation gate (chat surfaces); citation compliance; safety | Separate reasoning stack from the Hub (the "duplicate stack" the plan flags). |
| `mira-pipeline /api/v1/ignition/chat` | Ignition cloud chat | text + asset context | Supervisor | `uns_required` rejection | Direct connection. |

**Where MIRA becomes less capable than the model today**

1. **Images never reach the conversation model.** Only LOOK/READ see pixels, through a fixed prompt; the chat model receives a one-paragraph observation. "What is this?" with a photo of a beetle → the observation prompt describes it as a field observation and the chat model reasons from text.
2. **General mode is a per-turn opt-in with a restricted persona** ("no manual loaded… reasoning from general knowledge") — the client only sends it when the notebook has *zero* sources. A notebook with one manual attached cannot ask a general question without hitting Gate G (0 chunks → `insufficient_evidence`).
3. **No web research anywhere in the conversation engine.** Serper exists only in `mira-ask` manual discovery (ADR-0036, owner-accepted A/C) and `lib/agents/asset-intelligence.ts`; no inline public citations exist in any answer contract.
4. **Approved-context 412 on `mira/ask`, asset chat, node chat** refuses the whole turn when no approved evidence exists — the plan's canonical failure (§9).
5. **Engine (Telegram/Slack) chat-gate** asks for asset confirmation before *asset-specific* troubleshooting; general/educational questions are exempt by rule, but intent classification decides which is which.
6. **Provider ceiling:** the seam is text-only Groq/Cerebras/Together (`gpt-oss-120b`, Llama 3.3 70B). Owner decision 2026-08-26 permits OpenAI models *behind the seam* (text, vision, judging) when evals justify; Anthropic remains excluded from diagnosis. No frontier alias exists yet — `GROQ_MODEL`/`CEREBRAS_MODEL`/`TOGETHERAI_MODEL` are per-provider.

## 2. Gates inventory (what can suppress an answer)

| Gate | Where | Suppresses | Keep? | GI-1 disposition |
|---|---|---|---|---|
| UNS location-confirmation (chat surfaces) | `mira-bots/shared/engine.py`, `.claude/rules/uns-confirmation-gate.md` | asset-specific troubleshooting until confirmed | keep for asset-specific claims (owner narrowed it 2026-08-26) | claim-aware, not turn-wide (Phase 6) |
| `no_sources_selected` 422 | notebook chat | any grounded turn with no sources | keep as *default off*; general must be the default when nothing is selected | client already sends `general` at zero sources; extend to "general portions" later |
| Gate G `insufficient_evidence` | notebook / node / asset chat | whole turn when retrieval empty | keep for **document claims**; must not suppress general answer | Phase 6 claim-aware |
| approved-context 412 | asset chat, node chat, `mira/ask`, notebook (machine turns) | whole turn | keep for asset-specific **evidence** claims | Phase 6 |
| WSC replay 422/503 | notebook chat | an *explicit* machine-history request with no admissible window | **keep verbatim** (plan §20) | the general part of a combined question must still be answered — Phase 6 test |
| Safety hard-stop | all chat routes | replaces the answer | keep | unchanged |
| Bracket stripper (general mode) | notebook chat | `[n]` markers with no source | keep — becomes "no fake citation" (§10.A) | web citations get their own marker class |

## 3. Image / nameplate pipelines

- `lib/nameplate/passes.ts` (`togetherVisionCall`, transcription vs identity passes, invariants), `lib/nameplate/index.ts` (`defaultRecognizer`, fallback models), `nameplate/image-mime.ts`, PaddleOCR det-only region finding in `mira-ask` (`/nameplate/detect`, flag-off), Tesseract photo OCR (`PHOTO_OCR_ENABLED`, PR #3430).
- Engine side: `qwen2.5vl:7b` via Open WebUI (local), print-translator (`_try_print_translator_reply`), PrintSense (paid vision, validation-only per zero-token law).
- **Disposition:** keep all as **tools** (`extract_nameplate`, `inspect_image`, `ocr_region`); the general multimodal path must send pixels to the conversation model first (§6.1) and call these when the model decides.

## 4. Web search / public evidence

- Serper via `mira-ask` `/manual-discovery/search` + judge (`manual_search/judge.py`, `MANUAL_JUDGE_*`), SSRF-guarded fetch; `lib/agents/asset-intelligence.ts` (Hub-side use); `crawler_bridge.py`. Owner-accepted egress (ADR-0036 A/C).
- **No** general web-search tool, **no** public citation type in `notebook-chat-types.ts` (`EvidenceCitation` is document-shaped: `docId/page/fileId/quote`).
- **Disposition:** add `search_web` / `open_url` tools behind `MIRA_GENERAL_INTELLIGENCE_ENABLED` (Phase 3), an `EvidenceCitation` variant `{kind:"web", url, title, domain, snippet}` that persists in `equipment_notebook_turns.evidence[]` (one evidence model, §2.4), rendered as tappable links on phone (`AnswerMarkdown`) and Hub.

## 5. Citations: rendering + persistence

- Contract: `mira-hub/src/lib/notebook-chat-types.ts` (frames `content/sources/evidence/usage/status/followups`), `equipment_notebook_turns.evidence` JSONB (mig 073/084/085), readers `machineEvidenceEntries`, `normalizeCitations` (phone), `splitEvidence` (Hub). Citation → passage (`/sources/[docId]/passage`) and viewer (`fileId`/`originFileId`).
- **Disposition:** extend, don't fork — add web + machine-history citation kinds to the same `evidence[]`; keep `citationsUsedInAnswer` entailment.

## 6. Provider / model abstraction

- Hub: `inference/canonical-cascade.ts` (`canonicalProviders`, `buildRequestBody`, `usageFromRaw`, cost telemetry into `decision_traces`, `MIRA_CANONICAL_SEAM=1` live). Engine: `mira-bots/shared/inference/router.py` (same names). Vision is outside both.
- **Disposition:** introduce one configurable frontier alias (`MIRA_FRONTIER_MODEL` + `MIRA_FRONTIER_PROVIDER`) resolved *inside* the seam, multimodal-capable; OpenAI permitted behind the seam per owner decision; Anthropic excluded. Benchmark runner must accept the same alias so a model upgrade is a config change.

## 7. Private-data capabilities → tools (Phase 5 candidates)

| Capability | Where today | Tool name | Read/write |
|---|---|---|---|
| asset identity / context | `resolveBoundAsset`, `/api/assets/[id]/context`, `by-tag`, QR | `identify_asset`, `get_asset_context` | read |
| asset documents / RAG | `retrieveNodeChunks` + `validateChatSources` (admission authority) | `search_asset_documents` | read |
| company knowledge | `knowledge_entries` hybrid law (`/api/knowledge`, `/api/documents`) | `search_company_knowledge` | read |
| live signals | `buildMachineMemoryResponse` (`live_signal_cache`) | `get_live_machine_signals` | read |
| machine history (window + coverage) | `fetchMachineHistory` (WSC coverage, provenance rows) | `get_machine_history` | read |
| anomalies / conditions | `deriveContextIntelligence` + `run_diff` (canonical titles) | `get_machine_anomalies` | read |
| work orders | Atlas CMMS via `mira-mcp` tools / `mira-cmms-sync` | `search_work_orders`, `create_work_order` | read / **write (confirm)** |
| technician observations | LOOK observations, `equipment_notebook_turns` | `search_technician_observations` | read |
| relationships | `kg_relationships` (verified only) | `get_related_equipment` | read |

## 8. Component disposition table (plan §21)

| Component | Current responsibility | Keep | Convert to tool | Remove later | Risk |
|---|---|---:|---:|---:|---|
| notebook chat route | primary conversation engine | ✔ | — | — | becomes the one multimodal path; must not fork |
| general mode (`mode:"general"`) | text-only unsourced answers | ✔ | — | persona narrowing | restricted persona limits capability (§2.1) |
| LOOK route | fixed-prompt vision observation | ✔ | ✔ (`inspect_image`) | — | direct Together call outside the seam (ADR-0036) |
| nameplate recognize/confirm | structured identity | ✔ | ✔ (`extract_nameplate`) | — | invariants must stay deterministic |
| manual discovery (Serper + judge) | OEM manual lookup | ✔ | ✔ (`find_oem_manual`) | — | egress policy (accepted A/C) |
| approved-context gate | evidence readiness for machine claims | ✔ (claims) | — | turn-wide use | must become claim-scoped (Phase 6) |
| Gate G | document-claim refusal | ✔ (claims) | — | turn-wide use | same |
| WSC replay refusals + coverage | machine-history truth | ✔ | ✔ (`get_machine_history`) | — | **invariant — do not regress** |
| asset chat / node chat routes | Hub-only answer stacks | ✔ | — | consolidate after parity | duplicate reasoning stacks |
| engine Supervisor (Telegram/Slack) | adapter reasoning stack | ✔ | — | consolidate after parity | second stack; separate benchmark lane |
| `mira/ask` kiosk | direct-connection Q&A | ✔ | — | — | direct-connection doctrine |
| canonical seam | provider cascade + telemetry | ✔ | — | — | needs multimodal + frontier alias |
| vision sidecars (Paddle/Tesseract/PrintSense) | OCR/detection | ✔ | ✔ | — | paid = validation only (zero-token law) |
| `EvidenceCitation` doc-shaped contract | citations | ✔ | — | — | extend with web/machine kinds, never a second store |

## 9. GI-1 sequencing (held PRs)

1. **This PR** — Phase 0 map, doctrine rules, arena harness + corpus + tests, raw/MIRA runners (dry-run reproducible; live runs are budget-declared validation per the zero-token law). No answer-path changes.
2. Baseline run (Mike-authorized budget): raw frontier vs current MIRA general mode on the corpus → `reports/`.
3. Frontier alias + multimodal seam behind `MIRA_GENERAL_INTELLIGENCE_ENABLED` (Phase 2), images into the conversation model (Phase 4), `search_web`/`open_url` + web citations (Phase 3).
4. Claim-aware gating (Phase 6) with the WSC combined-question test ("what normally causes this, and did it happen on CV-101 last night?").
5. Re-run arena; fix the top-five wrapper-induced losses; only then expand scope (GI-2 tools).
