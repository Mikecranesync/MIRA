# C4 Dynamic Diagram — Fault Diagnosis Flow

End-to-end sequence: technician sends photo → MIRA responds with diagnosis question.

```mermaid
sequenceDiagram
    participant Tech as Technician (any platform)
    participant Adapter as Platform Adapter<br/>(Telegram/Slack/Teams/WA)
    participant Engine as Supervisor FSM<br/>(engine.py)
    participant Vision as VisionWorker
    participant RAG as RAGWorker
    participant Router as InferenceRouter<br/>(router.py)
    participant Claude as Claude API
    participant NeonDB as NeonDB + PGVector
    participant SQLite as mira.db

    Tech->>Adapter: 1. Sends photo + caption<br/>("motor won't start")
    Adapter->>Adapter: 2. Sends typing indicator<br/>(immediate ack)
    Adapter->>Engine: 3. process(session_id, caption, photo_b64)
    Engine->>SQLite: 4. Load session state (FSM state, history)

    Engine->>Vision: 5. Dispatch photo to VisionWorker
    Vision->>Vision: 6. Resize to 512px max (encoder latency -75%)
    Vision-->>Engine: 7. Vision description (nameplate, fault codes, readings)

    Engine->>RAG: 8. Dispatch to RAGWorker with vision context
    RAG->>NeonDB: 9. pgvector recall (768-dim embedding search)
    NeonDB-->>RAG: 10. Top-k reference documents

    RAG->>Router: 11. complete(messages) with system prompt + context
    Router->>Router: 12. Load active.yaml system prompt
    Router->>Claude: 13. POST /v1/messages
    Claude-->>Router: 14. JSON response {next_state, reply, options}
    Router-->>RAG: 15. (content, usage_dict)

    RAG-->>Engine: 16. Parsed response
    Engine->>SQLite: 17. Advance FSM state (Q1→Q2), save history
    Engine-->>Adapter: 18. reply text

    Adapter->>Tech: 19. Diagnostic question with numbered options<br/>(≤50 words, <10s total)
```

## Timing Budget (target: <10s end-to-end)

| Step | Typical Latency |
|------|----------------|
| Photo download + resize | 200ms |
| Vision worker (Ollama local) | 1-3s |
| NeonDB pgvector recall | 100-300ms |
| Claude API call | 1-3s |
| Total | **3-7s** |

## FSM States

```
IDLE → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED
                                ↗
                         SAFETY_ALERT (always reachable from any state)
```
