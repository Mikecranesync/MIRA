# Telegram Bot Logic Map

Date: 2026-05-01
Scope: live `mira-bot-telegram` flow, shared dispatcher path, `Supervisor` FSM, and the current failure pattern seen in chat `telegram:8445149012`.

Primary code paths:

- [mira-bots/telegram/bot.py](/Users/bravonode/Mira/mira-bots/telegram/bot.py)
- [mira-bots/telegram/chat_adapter.py](/Users/bravonode/Mira/mira-bots/telegram/chat_adapter.py)
- [mira-bots/shared/chat/dispatcher.py](/Users/bravonode/Mira/mira-bots/shared/chat/dispatcher.py)
- [mira-bots/shared/engine.py](/Users/bravonode/Mira/mira-bots/shared/engine.py)
- [mira-bots/shared/guardrails.py](/Users/bravonode/Mira/mira-bots/shared/guardrails.py)

Runtime state and evidence:

- DB: `/Users/bravonode/Mira/mira-bridge/data/mira.db`
- Session photos: `/Users/bravonode/Mira/mira-bridge/data/session_photos/`
- Live logs: `docker logs mira-bot-telegram`

## 1. Top-Level Telegram Flow

```mermaid
flowchart TD
    A["Telegram user message/photo/voice"] --> B["python-telegram-bot polling loop<br/>mira-bots/telegram/bot.py"]
    B --> C{"Message type?"}

    C -->|"text"| D["text handler"]
    C -->|"photo"| E["photo handler"]
    C -->|"document/pdf"| F["document_handler"]
    C -->|"voice"| G["voice handler -> transcribe_voice()"]

    D --> H["TelegramChatAdapter.normalize_incoming()"]
    E --> H
    G --> H

    H --> I["NormalizedChatEvent<br/>platform=telegram"]
    I --> J["Attachment download/prep<br/>image bytes -> attachment.data"]
    J --> K["ChatDispatcher.dispatch()"]

    K --> L["Build chat_id<br/>telegram:{chat_id}[:thread_id]"]
    L --> M["Rate limit check"]
    M --> N["Resolve canonical user if identity service exists"]
    N --> O["Extract first image as photo_b64"]
    O --> P["Supervisor.process(chat_id, message, photo_b64)"]

    P --> Q["NormalizedChatResponse(text=engine reply)"]
    Q --> R["TelegramChatAdapter.render_outgoing()"]
    R --> S["Telegram sendMessage API"]
```

## 2. Supervisor Decision Tree

```mermaid
flowchart TD
    A["Supervisor.process()"] --> B["load_state(chat_id)"]
    B --> C{"Pending action?"}

    C -->|"cmms_pending"| C1["_handle_cmms_pending()"]
    C -->|"pm_suggestion_pending"| C2["_handle_pm_suggestion_pending()"]
    C -->|"none"| D["Load session photo for text follow-up<br/>if photo_turn still fresh"]

    D --> E{"state == MANUAL_LOOKUP_GATHERING<br/>and no new photo?"}
    E -->|"yes"| E1["_handle_manual_lookup_gathering()"]
    E -->|"no"| F["Option resolution<br/>1 / 2 / option 2 -> full text"]

    F --> G{"detect_session_followup()?"}
    G -->|"yes"| G1["_handle_session_followup()"]
    G -->|"no"| H["route_intent() + keyword fallback"]

    H --> I{"Intent branch"}
    I -->|"safety"| I1["Immediate safety reply + alert"]
    I -->|"log_work_order"| I2["_handle_wo_request()"]
    I -->|"switch_asset"| I3["_handle_asset_switch()"]
    I -->|"check_equipment_history"| I4["_handle_check_equipment_history()"]
    I -->|"general_question"| I5["_handle_general_question()"]
    I -->|"greeting_or_chitchat in IDLE"| I6["_greeting_response()"]
    I -->|"answer_question"| I7["_handle_instructional_question()"]
    I -->|"find_documentation"| I8["Specificity gate -> doc lookup or manual gathering"]
    I -->|"fallback / diagnosis"| J["Continue into photo path or RAG/FSM path"]

    J --> K{"photo_b64 present?"}
    K -->|"yes"| L["vision.process(photo, message)"]
    K -->|"no"| M["text-only FSM/RAG path"]

    L --> N{"Vision classification"}
    N -->|"low confidence"| N1["Ask for clearer photo"]
    N -->|"ELECTRICAL_PRINT"| N2["state=ELECTRICAL_PRINT"]
    N -->|"NAMEPLATE"| N3["_handle_nameplate()"]
    N -->|"generic equipment"| N4["state=ASSET_IDENTIFIED<br/>save asset text + session_context"]

    N4 --> O{"Active diagnostic state?"}
    O -->|"yes"| O1["Treat photo as answer to last question"]
    O -->|"no"| O2["Maybe auto-diagnose visible fault indicators"]

    O1 --> P["RAG / worker processing"]
    O2 --> P
    M --> P

    P --> Q["_advance_state()"]
    Q --> R{"state == DIAGNOSIS?"}
    R -->|"yes"| R1["critique / revision loop"]
    R -->|"no"| S{"state == RESOLVED?"}

    R1 --> S
    S -->|"yes"| S1["build UNS work order + maybe suggest PM"]
    S -->|"no"| T["record history + save_state()"]

    S1 --> T
    T --> U["Formatted reply returned to dispatcher"]
```

## 3. Documentation Subroutine

```mermaid
flowchart TD
    A["User asks for manual / instructions / website"] --> B["route_intent() -> find_documentation"]
    B --> C["Check specificity"]
    C -->|"specific vendor+model"| D["_do_documentation_lookup()"]
    C -->|"too vague"| E["_enter_manual_lookup_gathering()"]

    E --> F["state=MANUAL_LOOKUP_GATHERING"]
    F --> G["Store prior_state + gathering payload in context"]
    G --> H["Ask for missing vendor/model"]

    H --> I{"Next user reply"}
    I -->|"provides vendor/model"| J["Complete crawl / KB lookup"]
    I -->|"skip / back"| K["Restore prior_state"]
    I -->|"diagnosis signal"| L["Escape gathering and restore prior_state"]
    I -->|"too many failed attempts"| M["Give up and restore prior_state"]
```

## 4. State Persistence Model

```mermaid
flowchart LR
    A["conversation_state table<br/>/Users/bravonode/Mira/mira-bridge/data/mira.db"] --> B["state<br/>IDLE / ASSET_IDENTIFIED / Q1 / DIAGNOSIS / RESOLVED / MANUAL_LOOKUP_GATHERING"]
    A --> C["context JSON<br/>history, session_context, q_rounds, photo_turn, pending flags"]
    A --> D["asset_identified"]
    A --> E["fault_category"]
    A --> F["exchange_count"]
    A --> G["final_state"]
    A --> H["voice_enabled"]

    I["session_photos/*.jpg"] --> J["Loaded for text follow-ups<br/>for PHOTO_MEMORY_TURNS turns"]

    B --> K["Drives follow-up behavior"]
    C --> K
    J --> K
```

## 5. Current Failure Loop In Mike's Telegram Chat

Observed chat: `telegram:8445149012`

Stored state snapshot:

- `state = ASSET_IDENTIFIED`
- `asset_identified = Elmo device with PORT A / PORT B`
- `fault_category = hydraulic`
- `final_state = RESOLVED`
- `exchange_count = 19`

```mermaid
flowchart TD
    A["User sends new equipment photo"] --> B["Vision identifies Elmo device"]
    B --> C["state=ASSET_IDENTIFIED<br/>photo_turn saved<br/>asset_identified stored"]
    C --> D["User asks: What is an Elmo device?"]
    D --> E["Handled as general question"]
    E --> F["Assistant answers reasonably"]

    F --> G["User asks: do they have a website?"]
    G --> H["Session photo still loaded from prior turn"]
    H --> I["Bot keeps using asset/session context instead of starting fresh doc lookup"]

    I --> J["User asks: user manual"]
    J --> K["Bot misroutes into diagnostic branch"]
    K --> L["fault_category remains hydraulic"]

    L --> M["User says: no its wrong"]
    M --> N["Bot asks system-type clarification"]
    N --> O["User says: 2 / it electrical"]
    O --> P["Bot still replies from stale Elmo + hydraulic context"]
```

## 6. Live Failure Points

```mermaid
flowchart TD
    A["Telegram polling"] --> B{"Competing poller?"}
    B -->|"yes"| B1["409 Conflict<br/>another getUpdates consumer is active"]
    B -->|"no"| C["Normal polling"]

    C --> D["Photo OCR call"]
    D --> E{"Open WebUI auth OK?"}
    E -->|"no"| E1["401 Unauthorized<br/>OCR path degraded"]
    E -->|"yes"| F["OCR available"]

    C --> G["Visual search"]
    G --> H{"mira-ingest endpoint exists?"}
    H -->|"no"| H1["404 Not Found<br/>visual retrieval disabled"]
    H -->|"yes"| I["Visual KB lookup"]

    C --> J["FSM follow-up logic"]
    J --> K{"session photo still fresh?"}
    K -->|"yes"| K1["Old photo context reused"]
    K -->|"no"| L["Fresh text-only turn"]

    K1 --> M{"topic changed?"}
    M -->|"yes, but not detected"| M1["Misroute into stale branch"]
    M -->|"yes, detected"| L
```

## 7. Practical Mental Model

Think of the bot as seven layers:

1. Telegram transport:
   receives updates, sends replies, downloads attachments.
2. Adapter:
   converts Telegram payloads into a platform-neutral event.
3. Dispatcher:
   rate limits, builds `chat_id`, extracts the first image, calls `Supervisor`.
4. Supervisor:
   the real orchestrator; loads state, decides whether this is follow-up, docs, safety, general Q, or diagnosis.
5. Workers:
   vision, electrical print, nameplate, RAG, doc lookup, CMMS.
6. FSM:
   stores where the conversation is and what the bot thinks the asset/problem is.
7. Persistence:
   SQLite state plus saved session photos that can bleed into later turns if reset logic is weak.

## 8. Most Likely Root Cause For The Current Chat

The current conversation is going wrong because three things are interacting badly:

1. The session photo is still considered fresh enough to load on later text turns.
2. The state never got properly reset when the user pivoted from identification to documentation lookup.
3. `fault_category` and `final_state` were left behind in a contradictory combination, so the bot is carrying stale diagnostic assumptions into a new question.

## 9. Best Fix Targets

If we patch this, the highest-value places are:

- [mira-bots/shared/guardrails.py](/Users/bravonode/Mira/mira-bots/shared/guardrails.py):
  `detect_session_followup()`
- [mira-bots/shared/engine.py](/Users/bravonode/Mira/mira-bots/shared/engine.py):
  photo follow-up load logic, documentation routing, and stale-state reset points
- Telegram ops:
  stop the duplicate poller causing `409 Conflict`
- OCR / ingest plumbing:
  fix the `401` OCR path and `404` visual search path

## 10. One-Line Summary

The Telegram bot is a transport -> adapter -> dispatcher -> FSM supervisor -> worker stack, and the current bug is a stale photo/FSM carry-over problem, not just a bad answer from the model.
