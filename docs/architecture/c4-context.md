# C4 Context Diagram — MIRA

MIRA as a black box: who uses it and what external systems it depends on.

```mermaid
flowchart TB
    tech["<b>Field Technician</b><br/>Industrial maintenance tech<br/>Stands at the machine"]
    admin["<b>FactoryLM Admin</b><br/>Manages knowledge base<br/>Reviews interactions"]

    mira["<b>MIRA</b><br/>AI maintenance co-pilot<br/>Diagnoses faults, retrieves manuals,<br/>guides repair via messaging apps"]

    slack["<b>Slack</b><br/>Team messaging platform"]
    telegram["<b>Telegram</b><br/>Consumer messaging app"]
    teams["<b>Microsoft Teams</b><br/>Enterprise messaging"]
    whatsapp["<b>WhatsApp</b><br/>Mobile messaging via Twilio"]

    claude["<b>Anthropic Claude API</b><br/>LLM inference — reasoning,<br/>diagnosis, GSD dialogue"]
    neondb[("<b>NeonDB + pgvector</b><br/>Cloud Postgres + vector store<br/>5,493 knowledge entries")]
    langfuse["<b>Langfuse</b><br/>LLM observability<br/>(optional)"]
    twilio["<b>Twilio</b><br/>WhatsApp message relay"]
    azure["<b>Azure Bot Service</b><br/>Teams bot framework relay"]

    tech -- "Sends photo/text" --> slack
    tech -- "Sends photo/text" --> telegram
    tech -- "Sends photo/text" --> teams
    tech -- "Sends photo/text" --> whatsapp

    admin -- "Manages KB, reviews logs" --> mira

    slack -- "Socket Mode events" --> mira
    telegram -- "Polling updates" --> mira
    azure -- "POST /api/messages" --> mira
    twilio -- "POST /webhook" --> mira

    mira -- "POST /v1/messages" --> claude
    mira -- "pgvector recall" --> neondb
    mira -- "Traces + spans" --> langfuse
    mira -- "Bot Framework auth" --> azure

    style tech fill:#08427B,color:#fff,stroke:#08427B
    style admin fill:#08427B,color:#fff,stroke:#08427B
    style mira fill:#1168BD,color:#fff,stroke:#0B4884
    style slack fill:#999,color:#fff,stroke:#666
    style telegram fill:#999,color:#fff,stroke:#666
    style teams fill:#999,color:#fff,stroke:#666
    style whatsapp fill:#999,color:#fff,stroke:#666
    style claude fill:#999,color:#fff,stroke:#666
    style neondb fill:#999,color:#fff,stroke:#666
    style langfuse fill:#999,color:#fff,stroke:#666
    style twilio fill:#999,color:#fff,stroke:#666
    style azure fill:#999,color:#fff,stroke:#666
```
