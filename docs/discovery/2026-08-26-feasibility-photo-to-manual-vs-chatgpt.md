# Feasibility: is FactoryLM worth pursuing when ChatGPT already does photo → manual?

**Date:** 2026-08-26 · **Trigger:** Mike photographed a Harrington UMS3-0335 end-truck plate.
ChatGPT returned the correct *Series 3 End Trucks Owner's Manual* with page refs and a caveat
(end truck ≠ hoist; unit-specific wiring diagram not in the generic manual). FactoryLM, after
tonight's outage fix, returned a distributor's **lever/manual hoist brochure**.

This is a decision doc, not a pep talk. Evidence first, then the call.

---

## 1. What actually happened on our side (measured, not recalled)

| Step | Result | Evidence |
|---|---|---|
| Recognize (vision) | ✅ 200 after #3407 | nginx 01:14:25Z `nameplate/recognize/ 200`; before the fix every read was 502 because the hard-coded Together model went dedicated-only |
| Manual discovery | ❌ wrong doc | mira-ask 01:16:30Z → Serper ×2 → picked `tool-smith.com/.../Harrington Manual Hoists.pdf` |
| Applicability check | ✅ correctly said *candidate* (unverified) | the UI showed it switched off — the guard worked; the *search* didn't |

Re-running **our own searcher** locally against Serper with the plate's exact fields:

| make | model | top pick | score |
|---|---|---|---|
| `Harrington` | `UMS3-0335` | **aceindustries.com/…/Harrington_Series3_EndTrucks_Manual_Rev821.pdf** ✅ | 30 |
| `Harrington` | `UMS-3-0335` | nj.gov/treasury/taxation/pdf/25-pas1in.pdf (a NJ tax form) | 40 |
| `Harrington Hoists and Cranes` | `UMS3-0335` | harringtonhoists.com/manual-hoists (lever hoists page) | 10 |
| `Harrington Hoists` | `UMS3` | hoists.com/…/harrington-cx-manual.pdf (a hoist) | 40 |

So the correct manual **is in the results**. Whether we surface it depends on the exact string
the recognizer emitted — one hyphen flips it to a tax form. Root causes, all structural:

1. **Ranking is a URL/title heuristic** (`_score`: OEM host +120, `.pdf` +30, "manual" in
   title +10, model token in filename +25). The Series 3 manual's *filename* doesn't contain
   `UMS3-0335`, its title is glyph-garbage from PDF metadata, and `harrington` isn't in
   `OEM_DOMAINS`, so it scores 30 — same as any random Harrington PDF. A brochure whose title
   literally says "Manual Hoists" scores 40 and wins.
2. **Nothing reads the candidate PDFs before choosing.** ChatGPT opened the PDF, found the
   model family in the table on page 10, and *also* noticed it's an end-truck manual and warned
   about the hoist. We only inspect content *after* download, to grade — not to choose.
3. **Free-tier model dependency.** Tonight's outage was Together silently retiring the one
   serverless vision model we're allowed to use. The Together catalog now has exactly **one**
   serverless vision model on the account. This will happen again.

Verdict on the incident: **not a bug to patch, a design that cannot match a reasoning agent
with browsing.** Every hour spent tuning `_score` is an hour a frontier model already spent.

## 2. The honest competitive picture

**Photo → manual is a commodity.** ChatGPT (and Gemini, Claude) do it in one turn, better,
with judgment ("this is the end truck, not the hoist"). It is not a product; it's a feature of
the model. Building it ourselves is a losing race, and it was never the wedge — `NORTH_STAR.md`
says the wedge is the *context layer*, and the app was supposed to *prove* it.

**What ChatGPT does not do** (and where a maintenance product can still live):

| Capability | ChatGPT today | Notes |
|---|---|---|
| Remember *this* crane, at *this* plant, next month, for a different tech | ✗ | per-asset notebook, shared across the crew |
| Cite from the **unit-specific** wiring diagram that shipped with the crane | ✗ | the doc ChatGPT itself said the generic manual doesn't replace |
| Tie the answer to work-order history / last PM / parts used | ✗ | CMMS integration |
| Live tag/PLC context (what the drive is doing right now) | ✗ | Ignition / Drive Commander |
| Work for 20 techs with one shared, approved corpus + audit trail | ✗ | multi-tenant, approval states |
| Run where phones can't upload plant docs to OpenAI | ✗ | data-residency objection is real in some plants |

None of that is technically defensible either (any competitor can add it), but it is
*operationally* defensible: it needs someone who knows how maintenance actually runs, and it
needs the plant's data in one place. That's the bet, if there is one.

**What we have NOT proven, in 5+ months:** that anyone will pay for the context layer.
`project_wayfinder_first_paying_technician` is still open. The discovery sweep (2026-07-03)
said "real at both ends, cut in the middle." That is still true.

## 3. Options

**A. Quit.** Rational if the goal was "a software product that wins on AI capability." That
goal is dead; frontier models own it. Not rational yet if the goal is "the maintenance context
tool a plant pays for," because that hasn't been tested with a buyer.

**B. Pivot the engine, keep the product.** Stop building recognizers, rankers, cascades.
Use a frontier model *as the engine* (photo → identity → browse → pick → read → cite), and
spend all effort on what it can't do: the asset registry, per-asset docs incl. the unit
wiring diagram, work orders, shared crew memory, approval, Ignition. This is literally
`NORTH_STAR.md`; the app drifted into re-implementing the model.
*Cost:* the "no paid frontier providers / free-tier only" constraint (PRD §4) is now
actively harming the product. $50–200/month of API spend would beat months of heuristics.
That constraint is Mike's to change.

**C. Sell the outcome, not the software.** Mike is a working technician. Take 2–3 plants
(own employer first), build their namespace + digitize their docs + put "Ask MIRA" on the
HMI, with a frontier model inside. Charge for the setup and a monthly fee. Revenue and the
paying-customer proof arrive together; the software follows what they actually use.

**D. Narrow to the tools ChatGPT is weak at.** Drive Commander (live read-only VFD data),
PrintSense (electrical prints), PLC Logic Lens. Per `project_go_forward_product_sequence`.
Smaller market, but a phone can't photograph a live Modbus register.

## 4. Recommendation

**Don't quit on tonight's evidence. Do kill the strategy tonight's evidence indicts.**

1. **Stop competing with the model.** No more work on vision recognizers, search scoring,
   free-tier cascades. Adopt a frontier model with browsing/tool-use as the discovery engine
   (B). If PRD §4's provider ban stays, this option is off the table and A gets stronger.
2. **Run a 30-day paid test (C).** One plant (the one Mike works at is the cheapest to
   access). Success = a technician other than Mike uses it in a real job at least weekly, AND
   a maintenance manager says yes/no to a number. Kill criteria written down before starting.
3. **Keep D as the fallback**, not the main bet — it's the part of the work where "we know
   maintenance" beats "we know models."

If (2) fails with a frontier-grade engine inside, then the context-layer thesis is wrong too,
and quitting or a hard pivot is the honest answer.

## 5. Cheap engineering follow-ups (only if B/C proceed)

- Add `harrington` → `harringtonhoists.com` to `OEM_DOMAINS` (one line; +120 OEM boost).
- Feed identity *variants* to search (`UMS3-0335`, `UMS-3-0335`, `UMS3`) and union candidates.
- **The real fix:** fetch the first pages of the top-N PDF candidates and have a model judge
  "is this the manual for `{make} {model}`?" *before* choosing. That is what ChatGPT did.
- Retire the nameplate `_score` heuristic once the judged path lands. Don't tune it further.
- POTD judge still points at retired `google/gemma-3n-E4B-it` (`POTD_JUDGE_MODEL`).
- Hub logged `embed_enrichment_degraded / embedder_unavailable` during this run — the
  nameplate text ingested without embeddings. Separate issue; check `OLLAMA_BASE_URL` path
  (see `reference_knowledge_entries_update_grant_dark_embeddings`).
