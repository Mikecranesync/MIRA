# C4 Dynamic Diagram — Fault Diagnosis Flow

End-to-end sequence: technician sends a photo, MIRA responds with a diagnostic question.

```mermaid
sequenceDiagram
    participant Tech as Technician
    participant Adapter as Platform Adapter<br/>(Telegram/Slack/Teams/WA)
    participant Guard as Guardrails
    participant Engine as Supervisor FSM<br/>(engine.py)
    participant SQLite as mira.db
    participant Vision as VisionWorker
    participant Ollama as Ollama (host)
    participant RAG as RAGWorker
    participant NeonDB as NeonDB + pgvector
    participant Router as InferenceRouter
    participant Claude as Claude API

    Tech->>Adapter: 1. Photo + caption ("motor won't start")
    Adapter->>Adapter: 2. Typing indicator + photo buffer (4s)
    Adapter->>Guard: 3. Strip mentions, expand abbreviations
    Guard->>Engine: 4. process(session_id, caption, photo_b64)
    Engine->>SQLite: 5. Load session state (FSM + history)
    SQLite-->>Engine: 6. state: IDLE, exchange_count: 0

    Engine->>Vision: 7. Dispatch photo to VisionWorker
    par Vision + OCR in parallel
        Vision->>Ollama: 8a. qwen2.5vl:7b vision describe
        Vision->>Ollama: 8b. glm-ocr text extraction
    end
    Ollama-->>Vision: 9. Vision description + OCR items
    Vision-->>Engine: 10. classification: EQUIPMENT_PHOTO

    Engine->>Engine: 11. Set state → ASSET_IDENTIFIED

    Engine->>RAG: 12. Dispatch to RAGWorker with vision context
    RAG->>NeonDB: 13. pgvector recall (768-dim embedding)
    NeonDB-->>RAG: 14. Top-k reference documents

    RAG->>Router: 15. complete(messages, system_prompt + context)
    Router->>Router: 16. Load active.yaml, sanitize PII
    Router->>Claude: 17. POST /v1/messages (claude-3-5-sonnet)
    Claude-->>Router: 18. JSON response with next_state, reply, options, confidence
    Router-->>RAG: 19. content + usage_dict

    RAG-->>Engine: 20. Parsed response
    Engine->>SQLite: 21. Advance FSM (IDLE → Q1), save history
    Engine-->>Adapter: 22. Reply text + numbered options

    Adapter->>Tech: 23. Diagnostic question with options
```

## Timing Budget (target: under 10s end-to-end)

| Step | Typical Latency |
|------|----------------|
| Photo download + resize (512px max) | 200 ms |
| VisionWorker (Ollama local, parallel) | 1–3 s |
| NeonDB pgvector recall | 100–300 ms |
| Claude API call | 1–3 s |
| **Total** | **3–7 s** |

## FSM States

```
IDLE → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED

Special states (reachable from any state):
  SAFETY_ALERT       — hazard detected, de-energize warning
  ASSET_IDENTIFIED   — photo analyzed, equipment recognized
  ELECTRICAL_PRINT   — photo classified as drawing/schematic
```
