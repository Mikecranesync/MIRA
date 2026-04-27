# FactoryLM North Star

**The entire premise of this business is a self-building maintenance knowledge base that gets smarter with every trouble call.**

## The Flywheel

1. Tech gets a trouble call → opens MIRA → takes a photo
2. MIRA identifies the equipment → queues OEM manual download
3. Manual parsed → PM schedules AUTOMATICALLY extracted → calendar auto-populates
4. Every subsequent tech at ANY plant encounters that equipment → gets the manual, fault codes, PM schedule, and diagnostic patterns from every previous interaction
5. Every photo, conversation, and resolved fault makes the entire network smarter

## This Is The Product

Everything else — the hub, the chat adapters, the CMMS integrations, the channels, the OAuth connectors — is supporting infrastructure for this flywheel.

## The Decision Filter

Before building any feature, ask: **"Does this make the flywheel spin faster?"**

- Adding PM schedule extraction from manuals? YES — core flywheel.
- Adding a new chat adapter (WhatsApp)? YES — more techs feeding photos into the flywheel.
- Adding a pretty dashboard chart? MAYBE — only if it proves the flywheel is working.
- Adding a feature that no competitor has? ASK — does it feed the flywheel or is it a distraction?

## The Auto-PM Pipeline (THE core feature)

Status: PARTIALLY BUILT. This is the #1 priority.

| Step | Status | What |
|------|--------|------|
| Photo/tag → equipment ID | ✅ Built | Vision + OCR in GSDEngine |
| Manual not found → queue download | ✅ Built | KB Builder agent |
| Parse PDF → RAG chunks | ✅ Built | mira-ingest pipeline |
| Extract PM schedules → structured JSON | 🔲 NOT BUILT | LLM structured output from chunks |
| Auto-create PM work orders | 🔲 NOT BUILT | Calendar + WO generation |
| Push PMs to downstream CMMS | 🔲 NOT BUILT | Atlas/MaintainX/etc API |
| Knowledge Cooperative sharing | 🔲 NOT BUILT | Anonymized PM patterns across network |
| Sub-component model | 🔲 NOT BUILT | Machine → motor → relay → switch |

## The Knowledge Cooperative

Community tier customers share anonymized PM patterns. A plant that uploads a Yaskawa GA500 manual — every other Community plant with a GA500 gets those PM schedules. The more plants participate, the more complete the knowledge base becomes. This is the network effect.

Professional/Enterprise customers who opt out pay more and don't get the network benefit.
