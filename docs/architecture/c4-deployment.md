# C4 Deployment Diagram — MIRA

Physical and cloud deployment topology.

```mermaid
C4Deployment
    title MIRA — Deployment View

    Deployment_Node(mac, "Mac Mini M4", "Apple Silicon M4, 16GB, macOS") {
        Deployment_Node(docker, "Docker Engine") {
            Deployment_Node(corenet, "core-net bridge") {
                Container(webui, "mira-core", "open-webui:v0.8.10")
                Container(mcpo, "mira-mcpo", "mcpo:v0.0.20")
                Container(ingest, "mira-ingest", "python:3.12.13-slim")
                Container(bridge, "mira-bridge", "node-red:4.1.7-22")
                Container(mcp, "mira-mcp", "python:3.12.13-slim")
            }
            Deployment_Node(botnet, "bot-net bridge") {
                Container(tg, "mira-bot-telegram", "python:3.12.13-slim")
                Container(sl, "mira-bot-slack", "python:3.12.13-slim")
                Container(te, "mira-bot-teams", "python:3.12.13-slim :8020")
                Container(wa, "mira-bot-whatsapp", "python:3.12.13-slim :8010")
            }
        }
        Deployment_Node(host, "Host Process") {
            Container(ollama, "Ollama", "Metal GPU inference\n:11434")
        }
        ContainerDb(sqlite, "mira.db", "SQLite WAL\n~/Mira/mira-bridge/data/")
    }

    Deployment_Node(neoncloud, "NeonDB (us-east-1 AWS)", "Serverless Postgres") {
        ContainerDb(pgvector, "neondb", "pgvector 768-dim\n5,493 knowledge entries")
    }

    Deployment_Node(anthropic, "Anthropic Cloud", "Managed LLM") {
        Container(claudeapi, "Claude API", "claude-3-5-sonnet-20241022")
    }

    Deployment_Node(twilio_cloud, "Twilio Cloud", "CPaaS") {
        Container(twiliorel, "WhatsApp Relay", "Sandbox → Production")
    }

    Deployment_Node(azure_cloud, "Azure (Microsoft)", "Bot Service") {
        Container(azurebot, "Azure Bot", "F0 free tier\nBot Framework auth")
    }

    Rel(ingest, pgvector, "pgvector recall", "TCP/TLS 5432")
    Rel(tg, claudeapi, "POST /v1/messages", "HTTPS 443")
    Rel(sl, claudeapi, "POST /v1/messages", "HTTPS 443")
    Rel(twilio_cloud, wa, "POST /webhook", "HTTPS 8010")
    Rel(azure_cloud, te, "POST /api/messages", "HTTPS 8020")
    Rel(ingest, ollama, "embed + describe", "HTTP 11434")
```
