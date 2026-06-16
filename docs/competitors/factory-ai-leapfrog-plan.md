# Factory AI — Legal Remedy + Leapfrog Plan

**For:** Mike Harper
**Prepared:** 2026-04-24
**Source inputs:** `factory-ai.md` (T&Cs analysis + full docs crawl of docs.f7i.ai)

---

## Part 1 — Legal remedy: the honest read

Mike, you said they "basically copied me." I've been through every public page. Here's the blunt answer first, then the details.

**You likely have no legal remedy. You have a differentiation remedy.**

### Why the legal path is weak

| Avenue | Verdict | Why |
|---|---|---|
| **Copyright** | No case | Their docs, code, and UI are independently written. No copied text or code is visible in public artifacts. Copyright protects expression, not ideas. |
| **Trademark** | No case | "Factory AI" vs. "MIRA" / "FactoryLM" — no mark confusion. Their entity is registered in Australia. |
| **Trade dress** | Weak | Would require side-by-side UI evidence of distinctive non-functional visual elements being copied. SaaS dashboards all look alike. |
| **Patent** | Only if you filed | Did you file provisional / utility patents on anything novel? If not: predictive maintenance, CMMS, and LLM-over-manuals are all prior art (IBM Maximo, SAP EAM, UpKeep, Fiix, Limble, Brightly, Facilio — several shipped LLM chat in 2023). |
| **Trade secret** | Only if there was an NDA leak | Actionable only if you shared confidential info with Factory AI employees under NDA, or if a former employee/contractor of yours took materials to them. If you've never interacted with them, there is nothing to misappropriate. |
| **Contract / NDA** | Did you ever brief them? | Pull your email history for `f7i.ai`, `factory.ai`, `tim@`, `jp@`. Any pitch deck, call, or shared doc under NDA changes the calculus. |

### What would change this

1. **You have a filed patent / provisional** on a specific mechanism they are using (e.g., a particular PLC-to-LLM diagnostic loop, a safety-gated chat, the MIRA Connect relay protocol). Tell me the patent/provisional numbers and I can compare claims against their API surface.
2. **Former Factory AI employee, investor, advisor, or contractor** had NDA access to MIRA and joined them, or vice versa. Pull your LinkedIn + Discord + email history.
3. **A specific technical mechanism** is copied verbatim (e.g., they use your exact safety-keyword list, your exact prompts, your exact PLC register map). The sitemap I pulled gives enough of their data model to check this — skim `factory-ai.md` section "Their data model."

Short of one of those, **this is parallel commercial development.** The AI-CMMS category has 20+ startups; convergent evolution of feature sets is the default, not theft.

### What to do right now on the legal side

1. **Preserve evidence, don't act.** Archive `docs.f7i.ai/sitemap.xml` (still leaking via `your-docusaurus-site.example.com`), their T&Cs, pricing page, LinkedIn pages, founder histories. Use Wayback Machine. Timestamp everything. If any copying *is* happening, the record starts now.
2. **Check your own IP trail.** File a provisional patent this month on anything genuinely novel (MIRA Connect, the Ignition relay, the 5-regime test framework, the safety guardrail gate). A provisional is ~$130 USPTO fee + some writing; it gives you a priority date and 12 months to decide on full utility filing. This is the single highest-leverage legal move.
3. **Trademark `MIRA` and `FactoryLM`** if not already. ~$350/class via USPTO TEAS. Do this before you do more marketing.
4. **Don't send a cease-and-desist on feature overlap.** It tips your hand, damages your reputation if it's weak, and invites a countersuit.
5. **If you had any prior contact with anyone at f7i.ai** — pull the records and show me. That's the only thing that would move this from "compete" to "sue."

---

## Part 2 — How far ahead are they, really?

| Dimension | Gap | Reality |
|---|---|---|
| **Marketing + docs polish** | 9–12 months | Their Docusaurus + pricing + product pages are ahead. Catchable in 4 weeks. |
| **Mobile app (work orders, offline)** | 3–6 months | Real engineering gap. PWA approach closes in 30 days. |
| **Vertical hardware (BLE sensor + gateway)** | 12+ months / maybe never | Don't chase. Partner or go BYO-sensor. |
| **FFT + vibration peak detection** | 2–3 months | Pure software. `scipy.fft` + standard bearing-frequency formulas. Shippable in 30 days. |
| **CMMS breadth (inventory, POs, templates)** | 6–9 months | Real gap, but not where your differentiation lives. Atlas CMMS can catch up module by module. |
| **AI chat quality** | You're ahead | Their chat is RAG-over-manuals, admin-ingested, no streaming, no BYO-LLM. MIRA's GSDEngine is architecturally better. You need to *show* it. |
| **Industrial depth (PLC, Modbus, Ignition)** | You're ahead | `mira-connect` + `services/plc-modbus` + `mira-relay` already exist. They have a "SCADA" string tag on one endpoint. |
| **Enterprise readiness (SSO, SOC2, audit)** | Parity — neither has it | Whoever ships first wins a procurement bracket. |

**Summary:** They are ahead on *surface area* and *polish*. You are ahead on *depth* and *architecture*. The race is about converting depth into visible surface area — fast.

---

## Part 3 — The leapfrog plan

The strategy: **stop competing on their terms** (sensors + vertical CMMS) and **force them to compete on yours** (software-only, open, industrial-depth, BYO-everything). Every move below either closes a polish gap fast or exploits a hole in their architecture.

### Two-week moves (straight wins — things they don't have)

All high-value, low-cost, parallelizable.

#### 1. Ship public API docs at `docs.factorylm.com`
Why: Their polished API docs are their #1 credibility signal. Yours are scattered. Fix in 1 week.
How: Mintlify (free tier) or Docusaurus, mirror their 20-endpoint structure, publish our existing `mira-mcp` REST + `atlas-api` endpoints. Cite ISO 14224 for failure codes (we'll ship this below).
Files: new `docs-site/` or `mira-docs/` package.

#### 2. Ship outbound webhooks — the thing they don't have
Why: Their `/notifications` is GET-only, no Slack/Teams/PagerDuty push. Every CMMS buyer asks "does it alert us?" Your answer: yes, via webhook.
How: Extend `mira-bots/shared/inference/router.py` alert path; add a `webhooks` table in NeonDB; fan out on every classified alert. Ship first with Slack, then Teams + PagerDuty.
Moat: This is Factory AI's most visible architectural hole. Publish a blog post called "Why we ship webhooks out and Factory AI doesn't."

#### 3. Open-source the safety-keyword gate
Why: Their T&Cs clause 14 *disclaims* AI safety. You *enforce* it in code. This is a sales talking point and a reputation play.
How: Extract `mira-bots/shared/guardrails.py` `SAFETY_KEYWORDS` into an OSS package `mira-safety-guard` on PyPI. MIT license. ~100 lines.
Moat: Becomes a citable reference implementation. Every AI-CMMS vendor will either adopt it or look reckless.

#### 4. "Ask MIRA" public chat widget
Why: Their chat only works if Tim indexes your manual. MIRA's cascade works on any equipment via Claude's general knowledge, with progressive enhancement as manuals arrive.
How: Ship a `<script>` widget customers can embed on their own intranet / CMMS — points at `mira-pipeline` via tenant API key. Works *inside their existing CMMS*, not just ours.
Moat: Wedge into buyers who are already locked into SAP/Maximo/UpKeep/Fiix and can't rip-and-replace. Factory AI requires replacing their CMMS.

#### 5. Sitemap archive + competitive watch
Why: We're leveraging their leaked sitemap today. Capture it.
How: `curl https://docs.f7i.ai/sitemap.xml > docs/competitors/snapshots/f7i-sitemap-2026-04-24.xml`, submit to Wayback. Schedule `/loop` agent to re-pull weekly.

### 30-day moves (close visible polish gaps)

#### 6. FFT / vibration analysis in `mira-ingest`
Why: Their Predict product's core capability. Pure Python, pure software.
How: `scipy.fft` + standard bearing formulas (BPFO, BPFI, BSF, FTF) parametric on bearing geometry. Add `/api/v1/sensors/{id}/fft` endpoint. Ship a vibration-reference worksheet that maps peak frequencies → failure modes.
Moat: Parity on their core claim, zero hardware needed. Works on any customer-supplied sensor feed.

#### 7. Mobile PWA for Atlas work orders
Why: Their mobile app is a real advantage. PWA closes it without a native app.
How: `mira-web` already uses Hono/Bun. Add `/mobile` route, service worker, IndexedDB for offline work orders, camera capture for photos. Atlas API already exists at `atlas-api:8088`.
Moat: Zero app-store friction. Tech signs in once, works offline in the field.

#### 8. ISO 14224 failure-code taxonomy as an opinionated default
Why: Their failure codes are proprietary (10 categories × 4 severities). Regulated industries (oil & gas, pharma, defense) need ISO 14224.
How: Ship an MIT-licensed YAML taxonomy in `mira-cmms/taxonomies/iso-14224.yaml` with ~200 standard failure modes. Import on Atlas setup.
Moat: "Standards-compliant" beats "we made one up" in every procurement conversation.

#### 9. Component templates catalog (steal their structure, open-source it)
Why: They have Motor/Pump/PLC/Gearbox/Compressor templates as a selling point. Publish the same catalog in YAML, MIT-licensed, richer.
How: `mira-cmms/templates/*.yaml` — motor assembly (stator, rotor, bearings, coupling, base), centrifugal pump, gearbox, VFD, PLC chassis. Each with PM procedures, safety requirements, spare parts list referencing standard OEM catalogs.
Moat: Factory AI's templates are closed. Yours are open and can be forked by any CMMS vendor. Community contribution pulls market gravity.

#### 10. Subdomain multi-tenancy on `mira-web`
Why: Their `acme.f7i.ai/prod` pattern is standard enterprise. You already have JWT per-tenant; add subdomain routing.
How: Wildcard DNS `*.factorylm.com` → mira-web, resolve tenant from `Host` header.
Moat: Makes you look like a peer product in RFP checklists.

### 60-day moves (structural leapfrog)

#### 11. BYO-LLM as a paid SKU
Why: No enterprise wants to send their failure-mode data to an undisclosed model. You already have a 4-provider cascade. Productize it.
How: Config surface in `mira-web`: customer selects Claude, GPT-5, Gemini, Llama-on-Bedrock, or on-prem Ollama. Per-tenant setting in NeonDB.
Moat: Factory AI has zero BYO-LLM story. This is a hard-wired architectural difference and a closed-deal wedge in regulated industries.

#### 12. On-prem / self-hosted paid edition
Why: `mira-core`, `atlas-api`, `mira-pipeline` already run in Docker Compose. Factory AI is cloud-only. Big manufacturers (defense, semiconductor, pharma) require on-prem.
How: Package existing compose stack into an installer (`install/on-prem.sh`), add offline license key validation, document the air-gap path. Charge 5-10× cloud tier.
Moat: Entire customer segments Factory AI structurally cannot serve.

#### 13. Ignition tag streaming flagship
Why: `mira-relay` already exists — cloud endpoint for Ignition factory-to-cloud tag streaming. Ignition has a huge industrial footprint. Factory AI has nothing for Ignition shops.
How: Productize mira-relay as "MIRA Connect for Ignition" with a 10-minute setup video. Partner with Inductive Automation forum / Sepasoft community.
Moat: Direct channel into tens of thousands of Ignition-using plants. No sensor purchase required.

#### 14. Self-serve manual ingest as a product
Why: Factory AI's "email tim@f7i.ai with your manual" is an embarrassing manual process. `mira-crawler` already does automated OEM discovery + chunking.
How: Upload UI in `mira-web` → `mira-crawler` → Qdrant on CHARLIE → available in chat within minutes. Show a progress bar.
Moat: "Your AI knows your equipment in 5 minutes, no email chain" vs. their "contact Tim."

#### 15. SOC 2 Type 1 kickoff
Why: Enterprise deals stall without it. Neither of you has it. First mover wins a procurement tier.
How: Engage Vanta or Drata (~$8-15k/year + ~3 months). Doppler + Docker + our existing guardrail setup is already mostly compliant.
Moat: Bookable gate in RFPs; Factory AI cannot quickly match if they're starting from zero.

### 90-day narrative / positioning

Your one-liner to pitch against them:

> "Factory AI sells you their sensors and their cloud. MIRA connects to the equipment, sensors, and CMMS you already have — on your cloud or ours. Our AI is multi-model, open-source-audited, and safety-gated in code, not disclaimed in fine print."

Your 15-year PLC background is the flag. Factory AI is sensors-first + cloud-first + AI-on-top. You are **industrial-first + software-only + AI-as-a-layer**. Every asset above leans into that.

---

## Prioritization: what to ship Monday morning

If you can only do three things this week, do these, in order:

1. **Archive `docs.f7i.ai/sitemap.xml`** to `docs/competitors/snapshots/` and Wayback. Cost: 10 minutes.
2. **File a provisional patent** on MIRA Connect's PLC-to-Claude diagnostic loop (or whichever mechanism is most novel). Cost: a weekend + $130. Gives you a priority date before they can file.
3. **Ship the outbound-webhook API + a blog post** calling out the gap. Cost: 3–5 days of engineering. Sales ammo for every call from here on.

Everything else is a sequenced 2/4/8-week march. Track in KANBAN under a new `wiki/references/kanban.md` column called "Factory AI catch-up."

---

## What I need from you to sharpen this

1. **Have you ever been in contact with anyone at f7i.ai / Factory AI?** Emails, LinkedIn, Discord, calls — anything. Search for `f7i`, `factory.ai`, `factoryai`, `tim.`, `jp.`.
2. **Have you filed any patents or provisionals?** If so, patent numbers. I'll compare claim language against their documented API.
3. **Have you shared MIRA materials under NDA with any party — investor, contractor, advisor — who might overlap with their network?**
4. **Is there a specific artifact (email, deck, conversation)** that makes you say "they copied me"? I'd like to see the smoking gun before we rule the legal path out entirely.

Answers to (1)-(3) determine whether there's a real legal case buried here. Answer to (4) lets me re-run the analysis if I missed something.
