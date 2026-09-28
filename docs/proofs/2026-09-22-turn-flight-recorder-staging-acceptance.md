# Turn Flight Recorder — staging acceptance (2026-09-22 02:59Z)

**Deployed:** main `e73045bce6b4c68615250ab7bfa6e61ae3919366` (v3.353.0, PR #3940) on `app-staging.factorylm.com`, deploy run 35681143440 (receipt verified). Migration 090 applied to staging Neon (run 35681008343). Doppler `factorylm/stg` carries the six `OTEL_*` vars; `factorylm/prd` carries none. Production `app.factorylm.com` unchanged (`recovery-0178b1b07`, no `telemetry` key on health).

**How the turn was driven:** the exact mobile request sequence, over HTTPS with a staging session cookie, from CHARLIE — no SSH, no docker, no psql. (The Pixel was unplugged; the device leg is Mike's step, below.) Input photo: the Siemens TP700 Comfort nameplate from the first session (`docs/proofs/2026-09-22-pixel9a-staging-session/turn2-photo-siemens-tp700-nameplate.jpg`). Question: Mike's own turn-2 question, "Can you help me replace this screen".

## The 14 points

| # | Proof | Result |
|---|---|---|
| 1 | User sends turn | `POST /api/equipment-notebooks/8c0f5a94-…/look/` (photo) then `POST …/chat/` with `visualEvidence:{fileId,capturedAt}`, `mode:"general"`, `clientRequestId` — HTTP 200 both |
| 2 | Trace automatically exists | look `x-mira-trace-id: 14ba2cb381c7377ae8c9e6fb2b9a1085`; chat `x-mira-trace-id: b0b4ec4d4f02548c53d62758ec5b6de1`; chat's first SSE frame `{"kind":"trace","traceId":"b0b4ec4d…","turnId":"07fd98da-2caa-4f94-b6a9-974f65e20e99"}` |
| 3 | Trace found without SSH | `GET https://us.cloud.langfuse.com/api/public/traces/b0b4ec4d4f02548c53d62758ec5b6de1` → 200; viewer `https://us.cloud.langfuse.com/project/cmmxymjnc032zad07j35swt3h/traces/b0b4ec4d4f02548c53d62758ec5b6de1`; environment `staging` |
| 4 | Major spans present | chat: `mira.turn` → `evidence.materialize` → `identity.resolve` → `retrieval.execute` → `context.assemble` → **GENERATION** `chat openai/gpt-oss-120b` → `answer_gate.evaluate` → `turn.persist` (87 observations incl. pg/fetch auto-spans). look: `mira.turn` → `attachment.persist` → **GENERATION** `chat MiniMaxAI/MiniMax-M3` (55). See `…-staging/langfuse-*-trace-spans.json` |
| 5 | Photo/file id as reference | `mira.visual.file_id` / packet `visual_evidence.file_id` = `184da9ed-dd0d-444c-b2ba-e6f37b9c59d3`; no bytes anywhere |
| 6 | Vision operation visible | look GENERATION span, 6.17 s, `gen_ai.provider.name=together`, `mira.vision.observation_chars=1297`, `ok=true` |
| 7 | Observations/evidence visible | chat packet `visual_evidence`: `link_verified=true`, `observation_available=true`, `observation_in_context=true`, `evidence_entries` on persist |
| 8 | Retrieval decision visible | `retrieval.strategy=skipped_general_mode`, `executed=false`, `oem_corpus_searched=false` |
| 9 | Context evidence ids visible | `context.evidence_doc_ids=[]`, `chunk_count=0`, `visual_evidence_count=1`, `identity_included=false`, `prompt_chars=4321` |
| 10 | Provider/model/timing | `served_provider=Groq`, `served_model=openai/gpt-oss-120b`, generation span 0.957 s, total 5257 ms |
| 11 | Answer-gate decision | `decision=answered`, `reason=served`, `answer_chars=1148`, `refusal_phrase_matched=false`, `safety_classification=none` |
| 12 | Persistence visible | `persistence.outcome=ok`, `turn_row_id=7594b249-36f3-4739-bed3-fc0a9f6b8733`; `turn.persist` span 0.912 s |
| 13 | Packet links to the same trace | `GET …/turns/7594b249-…/diagnostics/` → `traceId: b0b4ec4d4f02548c53d62758ec5b6de1` = the response header = the Langfuse trace (`…-staging/chat-turn-diagnostics.json`) |
| 14 | No credentials/secrets | Leak check over both Langfuse trace JSONs and the diagnostics response: no `pk-lf-`, `sk-lf-`, `Basic `, `Bearer `, cookie, or question/answer text |

## What the first live turn taught us (fixed in #3941)

- **`STAGING_TO_PROD_ROUTE` fired** on `NEXT_PUBLIC_PIPELINE_API_URL=http://40.160.141.61:4099`. Staging is co-hosted on the production VPS, so the bare IP is not a production signal; the detector is now port-aware (staging owns 4xxx). Correct behaviour of the check, wrong rule for a shared host.
- **`timings_ms` were null** — the recorder's `timing()` had no caller. Stage durations were only in the trace. Now copied into the packet.
- **`viewerUrl` was null** — template now set in staging Doppler and wired.

## Interesting: this turn behaved better than the Pixel session

The vision pass read `1P 6AV2124-0GC01-0AX0`, `Ta 0°C…+50°C`, `F-State: 41` correctly, and the observation **was** projected into the prompt (`observation_in_context=true`). What it still did not do — and what the packet now makes obvious in one read — is turn that order number into an identity (`identity.state=unknown`, `unresolved_reason=not_bound`, `manufacturer_present=false`) or search any manual (`retrieval.executed=false`). That is the product work; the recorder is doing its job.

## Mike's Pixel leg (the part only a phone can prove)

1. Open **MIRA Staging** on the Pixel (already installed beside production MIRA).
2. Take a photo of any nameplate and ask one question.
3. Then, on any machine: `GET https://app-staging.factorylm.com/api/equipment-notebooks/<notebookId>/turns/diagnostics/?limit=5` with the staging session → copy `traceId` → open the Langfuse project above → search that trace id. Or click `viewerUrl` from `…/turns/<turnId>/diagnostics/` once #3941 is deployed.
