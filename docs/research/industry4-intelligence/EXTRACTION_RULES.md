# Extraction Rules (Phases 4 + 5)

> The rules that govern how we pull intelligence from public sources into the library. Use this checklist when filling a company / source / pattern file.

## Source-priority ordering (Phase 4)

For every target, work the sources in this order. Stop when you have enough to fill the company file's required sections; record what you read.

1. **GitHub repos** (highest evidence) — the company's GH org, their open-source SDKs, sample apps, helm charts, terraform, demo flows. Read the README first, then `examples/`, then `docs/`, then code.
2. **Official docs** (`docs.{company}.com`, developer portals) — architecture diagrams, API reference, deployment guides.
3. **Videos / transcripts** — conference talks (ProveIt Live, IICS, Hannover Messe, ARC Forum), YouTube product demos, podcast episodes.
4. **Articles, LinkedIn posts, case studies** — last resort because of marketing skew. Cite carefully; quote sparingly.

## What to extract (Phase 5)

For every source, capture these dimensions where the source actually shows them. Leave a section blank rather than guess.

### A. Data architecture

- **Hierarchy:** site / area / line / asset / component / sensor / PLC / tag / event / alarm / fault / work-order — which of these exist in their model? What names do they use?
- **Cardinality:** is "component" per-instance or per-model? Are tags first-class objects or strings attached to assets?
- **Identifier strategy:** UUIDs, slug-paths, ltree, free-form names?
- **Where the data lives:** time-series store, document store, relational, knowledge graph?
- **History / provenance:** do they retain edits / sources / who-said-what?

### B. UNS architecture

- **Topic / path layout:** verbatim if shown (e.g., `enterprise/site/area/line/asset/component`).
- **Payload schema:** Sparkplug B protobuf, raw JSON, OPC-UA over MQTT, proprietary?
- **Namespace authority:** is the broker the source of truth, or is there a separate modeling layer (Industrial DataOps thesis)?
- **Conformance:** do they claim ISA-95 / ISA-88? Where do they deviate?
- **Multi-site:** how do they scale namespace across plants?

### C. AI architecture (where applicable)

- **Surface:** chat, agent, anomaly detection, predictive maintenance, vision, recommendation?
- **Grounding:** RAG over what corpus? Are they grounded in plant context (UNS, KG, manuals) or generic LLM?
- **Loop:** human-in-the-loop confirmation? Auto-execution? Auto-creation of work orders?
- **Models / providers:** in-house, OpenAI, Anthropic, multi-provider?
- **Citations:** does the UI cite source documents? Show evidence?

### D. Maintenance relevance

- Do they handle **work orders**? Read-only or full lifecycle?
- Do they track **fault codes** as first-class objects?
- Do they show **PM schedules**? Condition-based vs time-based?
- Do they cite **manuals** in their reasoning?
- Do they ingest **CMMS** data?

### E. Screens / UX

- Where does the user spend time — mobile, desktop, kiosk, headset, HMI panel?
- Is the front door **chat**, a **dashboard**, a **form**, an **app builder**?
- Does the UX show **evidence** (citations, source links) or just answers?
- Does the UX include a **confirmation gate** (location / asset / fault) before action?

### F. Business model

- Self-serve vs sales-led? Per-seat / per-tag / per-asset / per-site / per-plant pricing?
- Channel / OEM / direct? Is integration the wedge or the moat?
- Who's their published ICP signal (discrete vs process; SMB vs enterprise; geography)?

### G. MIRA-specific translation

Every source extraction ends with the MIRA editorial layer. For each finding, classify into one of:

- **Emulate** — borrow the pattern; link the file/module in MIRA where it'd land.
- **Avoid** — explicit anti-pattern; explain why it's wrong for the MIRA wedge.
- **Integrate** — they're a partner, not a competitor; record the integration vector.
- **Own** — they don't do this; MIRA's wedge stays distinct.
- **Feature idea** — a concrete product idea worth a future PR.
- **Demo idea** — a concrete content idea (LinkedIn post, video, screenshot pair) worth shipping.
- **Threat level** — low / medium / high; one-sentence justification.
- **Partnership opportunity** — concrete: who to contact, what to propose, what they need from us.

## Discipline

- **Quotes get receipts.** Verbatim text only when accompanied by a URL.
- **Inference is labeled.** `INFERENCE:` or `UNCONFIRMED:` prefix in the text — never let a guess sit in the facts section.
- **No proprietary content.** Summarize and cite. Never paste internal docs / leaked content.
- **Dates are absolute.** "Recently" / "last year" → write the actual date.
- **One source ≠ one fact.** If two reputable sources contradict each other, note both.

## Tooling notes for Claude Code

- Prefer `WebSearch` to scout, then `WebFetch` to read a specific page deeply.
- For GitHub URLs, prefer the `gh` CLI (`gh api`, `gh repo view`) over `WebFetch`.
- Don't fetch raw video files; transcribe via the `youtube-transcript` skill / `tools/youtube_transcript.py` if needed.
- Limit each company first-pass to ~30 minutes of research; better to ship a focused stub than a sprawling file.
