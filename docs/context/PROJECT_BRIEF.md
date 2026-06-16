# MIRA — Project Brief
**Last Updated:** 2026-05-05

## What MIRA is
MIRA is an **AI-powered industrial maintenance diagnostic platform**. A field tech opens MIRA from their phone, takes a photo of a misbehaving piece of equipment, and gets a Guided Socratic Dialogue that walks them toward a self-diagnosis grounded in OEM manuals, fault codes, and prior similar incidents — typically in seconds, not the hour they'd otherwise spend.

## North Star (the one premise that owns every decision)
**The entire premise of this business is a self-building maintenance knowledge base that gets smarter with every trouble call.** (Source: `NORTH_STAR.md`)

The flywheel:
1. Tech gets a trouble call → opens MIRA → takes a photo.
2. MIRA identifies the equipment → queues OEM manual download.
3. Manual parsed → PM schedules automatically extracted → calendar auto-populates.
4. Every subsequent tech at any plant who encounters that equipment gets manual + fault codes + PM schedule + diagnostic patterns from every previous interaction.
5. Every photo, conversation, and resolved fault makes the entire network smarter.

Decision filter: *"Does this make the flywheel spin faster?"* If not, push it down the backlog or out of scope.

## Auto-PM Pipeline (#1 priority)
| Step | Status |
|---|---|
| Photo/tag → equipment ID | ✅ built (vision + OCR in GSDEngine) |
| Manual not found → queue download | ✅ built (KB Builder agent) |
| Parse PDF → RAG chunks | ✅ built (mira-ingest pipeline) |
| Extract PM schedules → structured JSON | 🔲 not built |
| Auto-create PM work orders | 🔲 not built |
| Push PMs to downstream CMMS | 🔲 not built |
| Knowledge Cooperative sharing | 🔲 not built |
| Sub-component model | 🔲 not built |

## Commercial strategy (from `STRATEGY.md`)
- **ICP:** Industrial maintenance managers at SMB manufacturers (10–500 employees, 1–5 techs). Paper PM logs / spreadsheets. One unplanned downtime event ≥ $10K.
- **Pricing:** Community (free, contributes data) → Troubleshooter ($97/mo, single plant) → Integrated ($297/mo, multi-site / CMMS sync) → Enterprise (custom).
- **Distribution:**
  - Stage 1 (now → 60 days): LinkedIn-first PLG. 6-part series, build-in-public, technical proof. Target 3 paid plants.
  - Stage 2 (60–120 days): Warm outbound — DM 20 maintenance managers / week with the offer "I'll extract your top 3 PM schedules from your OEM manual for free."
  - Stage 3 (120 days+): Partner channel — VFD distributors as referrals, OEM co-marketing, Community tier as viral top-of-funnel.
- **Moat:** The Knowledge Cooperative. As more plants upload manuals, anonymized PM patterns compound into a corpus competitors cannot replicate.

## Hard constraints (from `CLAUDE.md`)
1. **Licenses:** Apache 2.0 or MIT only.
2. **Cloud LLMs:** Groq + Cerebras + Gemini cascade (free tier, OpenAI-compat). NeonDB persistence. Doppler-managed secrets. **No Anthropic** (removed PR #610 + #649, never reintroduce).
3. **No:** LangChain, TensorFlow, n8n, or any framework that abstracts the LLM call.
4. **Secrets:** All via Doppler `factorylm/prd`. Never in committed `.env`.
5. **Containers:** One per service, `restart: unless-stopped`, healthcheck, pinned image versions.
6. **Commits:** Conventional format (`feat / fix / security / docs / refactor / test / chore / BREAKING`).

## What success looks like (next 90 days)
Source: `docs/plans/2026-04-19-mira-90-day-mvp.md` (locked 2026-04-19 → 2026-07-19).
- 3 paid plants on Troubleshooter or Integrated.
- Auto-PM pipeline end-to-end: photo → manual → structured PMs → calendar.
- Eval pass rate ≥ 90 % on the 39 golden cases (today: 77 %, stale).
- Knowledge graph triples wired from runtime conversations.
- Hub mobile experience polished enough that field techs use it without training.

## Source-of-truth pointers
- North Star + flywheel: `NORTH_STAR.md`
- GTM strategy: `STRATEGY.md`
- Per-module specs: `docs/specs/SPEC_INDEX.md`
- Architecture map: `docs/context/ARCHITECTURE.md` (this directory)
- Tech stack: `docs/context/TECH_STACK.md`
- Repo layout: `docs/context/FILE_STRUCTURE.md`
- Project rules: `docs/context/RULES.md`
- Where we are now: `docs/context/PROGRESS.md`
