# ProveIt! 2027 — Demo Runbook & Prerequisite Plan

> **The single target for everything.** Drives `NORTH_STAR.md`. ProveIt! 2027 is **Feb 9–12, 2027,
> Hilton Anatole, Dallas** (Walker Reynolds / 4.0 Solutions). This doc is the executable demo script
> + the prerequisite checklist. **The prerequisite checklist *is* the beta gate** — if we can do this
> demo on a factory we've never seen, the beta gate is closed by definition.

## What ProveIt actually is (so we build for the real format)

Not a scored benchmark. A **live showcase**: every vendor connects to the **same intentionally-messy
shared UNS factory** and answers four questions on stage — *what problem did you solve, how, how long
did it take, what did it cost* — judged by the manufacturers in the room. No rubric, no winner. 2026's
energy: **UNS + knowledge graphs + agents building live with Claude Code.** *"No polished slide deck
saves you. You either prove it or you don't."*

**Design rule:** we connect read-only to *their* shared factory and do the one thing no platform vendor
and no copilot vendor does — **build trustworthy maintenance context live, then prove it with a cited,
scored diagnosis.** We do **not** bring our own pre-seeded factory (that's the "polished demo" the event
rejects). SimLab is the rehearsal rig and the safety net, never the on-stage factory.

---

## The 20-minute arc (minute-by-minute)

**Pre-stage (before the slot):** MIRA cloud up; read-only connector armed against ProveIt's shared UNS
(Sparkplug/MQTT + Ignition); the asset's manual in hand (their provided docs); the recorded fallback
+ SimLab local rig loaded on a second machine.

| Time | On screen | What we say / do | Why it lands |
|---|---|---|---|
| **0:00–2:00 · Frame** | Title + the 4 questions | "Every agent you'll see this week works *after* the factory is contextualized. We're going to do the part everyone assumes away — live, on a factory we've never seen." | Sets the wedge; pre-answers the 4 questions. |
| **2:00–8:00 · Contextualize live (showstopper)** | Connector reads their tags → tagger/parser auto-classifies → proposed asset structure + knowledge graph → **human approves** → context package + maturity (L0→L4) | Point ingestion at their UNS + ingest the manual. Watch MIRA propose equipment, signal meanings, relationships — each with evidence + confidence. Approve them (train-before-deploy). A trusted, asset-bound context package appears. | This is the unmatched moment: building **trustworthy context**, not just a connector. Rides the agentic-build energy that won 2026. |
| **8:00–13:00 · Diagnose, cited + scored** | "Why did line 3 fault?" → grounded answer w/ citation from *their* manual + live tag evidence → **"Why MIRA Thinks This"** trace → **live groundedness score** | Ask a real fault question. Answer cites the manual page + the abnormal tag. Open the decision trace. Show the per-answer score. Emphasize: **read-only — MIRA never wrote to anything.** | Citations + per-answer score = the trust knife (only Cognite has a benchmark story, and it's a yearly PDF). |
| **13:00–15:30 · Everywhere the tech is** | Same answer in the **Ignition "Ask MIRA" panel**, **Slack**, and **Telegram** | "Once the context is trusted, the agent rides any front door your techs already use." | The adapters earn their place here — distribution, not the lead. "Text your factory from your phone." |
| **15:30–19:00 · The four questions** | One slide, four answers | *Problem:* the maintenance-context gap. *How:* ingest→propose→human-approve→diagnose, read-only. *How long:* minutes, live, on data we'd never seen. *Cost:* self-serve, cheap vs. a six-figure SI. | ProveIt's actual scorecard. |
| **19:00–20:00 · Close** | The line | *"Everyone here showed you an agent that works **after** your factory is contextualized. We just contextualized a messy factory we'd never seen — live, in twenty minutes — and answered a real fault with a cited source. That's the part everyone else assumes is already done."* | The whole strategy in one sentence. |

### Fallback plan (live demos on foreign data WILL surprise you)
1. **Recorded run** of the exact arc on the same shared-factory data, captured the night before — pivot to it if the live connection flakes.
2. **SimLab local rig** — the deterministic factory + self-scoring dashboard (already built, P0–P5). If the shared UNS is down entirely: "here's the same loop on our reference factory, deterministic and self-scored — and here's the live connection we just made." SimLab makes the safety net *also* a credibility beat.
3. **Pre-approved context package** for the target asset, exported, so step 2 can be replayed instantly if live approval stalls.

---

## On the adapters (Slack / Telegram / Ignition / QR) — explicit

**They stay.** "Lead with the context platform, never with the copilot" is about the *pitch and the
wedge*, **not** about removing surfaces. Once FactoryLM has built trusted context, MIRA the agent should
be reachable wherever a technician already is — Slack, Telegram, the Ignition "Ask MIRA" panel, a QR
scan on the machine, web. In the demo they're the **"and it's everywhere your techs are"** beat (13:00).
The rule: **every adapter renders the *same approved-context* answer** (same citations, same score, same
read-only guarantee). Adapters are consumption/distribution; context is the product. Both are real.

---

## Prerequisite checklist — this IS the beta gate

The headline beta gate — *a stranger uploads their own manual → cited answer, no Mike fixing anything* —
is the core prerequisite. The demo adds "on a foreign UNS, live." Owner: Mike. Status as of 2026-06-22.

| # | Prerequisite | Maps to | Status |
|---|---|---|---|
| 1 | **Upload→retrieval closed** — uploaded manual becomes citable | PR #1592 (folder=brain) | 🔴 DRAFT — *the gate* |
| 2 | **Citation ENFORCED, not logged** — no ungrounded answer ships | `citation_compliance.py` | 🟡 logs, doesn't enforce |
| 3 | **Tag auto-classification on UNSEEN tags** — generalizes past the bench | plc-parser/tagger (#2068, vfd auto-map) | 🟡 partial |
| 4 | **Read-only connector to a FOREIGN UNS** (Sparkplug/MQTT + Ignition) | `mira-relay`, `mira-bridge` | 🟡 bench-proven, not generalized |
| 5 | **Per-answer groundedness score in the product UI** | SimLab eval → surface in Hub/answer | 🟡 scored in SimLab, not in product |
| 6 | **"Why MIRA Thinks This" decision-trace UI** | spec `why-mira-thinks-this-spec.md` (#2081) | 🟡 backend/partial |
| 7 | **Context package + maturity level, first-class + visible** | namespace builder (L0–L6) | 🟡 partial |
| 8 | **Every adapter renders the same approved-context answer** | Slack/Telegram/Ignition/QR | 🟡 adapters exist; unify on approved context |
| 9 | **Read-only violation FENCED** — remove write-to-VFD calls | Perspective view (anti-goal) | 🔴 violated — fix |
| 10 | **Proven on ≥1 foreign plant/dataset before Feb** — the "stranger" test | design partner OR ProveIt shared spec | 🔴 never done |
| 11 | **Cross-tenant isolation proven** (no IDOR) | #1841 | 🟡 closing |
| 12 | **Recorded fallback + SimLab safety net** | SimLab P0–P5 (done) + capture | 🟢 rig done; capture TODO |

**Gate logic:** items 1–7 + 9–11 closing = the beta gate green. Add 4 + 10 (foreign UNS, foreign data)
and the ProveIt demo is real. Same finish line.

---

## Timeline (working back from Feb 9–12, 2027 · ~7.5 months)

| Window | Theme | Done when |
|---|---|---|
| **Jun–Aug 2026** | **Close the loop on foreign data** (items 1, 2, 9, 11) | Beta-gate test goes green on a *stranger's* manual, citations enforced, write-to-VFD fenced, IDOR closed. |
| **Sep–Oct 2026** | **Generalize + surface** (items 3, 4, 5, 6, 7) | Tag auto-classify works on unseen tags; read-only connector hits a foreign UNS; score + decision trace + maturity visible in the product. |
| **Nov–Dec 2026** | **Prove on someone else's mess** (item 10) + dry-run | The full 20-min arc runs end-to-end on a design partner's plant OR the ProveIt shared-factory spec. |
| **Jan 2027** | **Harden + rehearse** (items 8, 12) | Adapters unified on approved context; recorded fallback captured; script rehearsed cold; SimLab safety net wired. |
| **Feb 9–12 2027** | **ProveIt! Dallas** | We do it live. |

## Open decisions (Mike)
- **Pricing** — pick one architecture before beta outreach (flagged in `NORTH_STAR.md`).
- **Foreign-data source for item 10** — design partner plant vs. obtaining the ProveIt shared-factory
  spec early (worth asking 4.0 Solutions for access ahead of the event).
- **Booth vs. main-stage slot** — confirm the format/length 4.0 Solutions offers for 2027 and tune the
  arc to the allotted time.

## Cross-references
- `NORTH_STAR.md` — the wedge + competitive map this runbook executes.
- `docs/plans/2026-06-07-path-to-beta.md` — the beta-gate work (= prereqs 1–2, 11).
- `docs/simlab/README.md` + `simlab/` — the rehearsal rig + safety net + per-answer scoring credibility.
- `tests/beta/beta_ready_upload_retrieval_citation.py` — the gate test that goes green when prereq 1 lands.
