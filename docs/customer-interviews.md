# Customer Interviews & Market Validation Commentary

**Purpose:** Define a proposed customer-discovery process and preserve historical context.
New prospect records, interview notes, quotes and results belong in the private CRM, not this repository.

## Proposed customer-development operating plan

**Status: PROPOSED — owner decision required before adoption.** This is a 30-day planning
framework, not a launch commitment, contact authorization, price list or claim of customer traction.
The clock starts only after Mike approves scope, assigns owners and accepts the data boundaries.
No outreach, sequences, purchases, CRM changes, production changes or repository settings changes
are authorized by this document. Repository-wide visibility remains Mike's decision.

Use the existing [GTM hardening checklist](gtm/go-to-market-hardening-checklist.md) for product
readiness and the [GTM refocus](strategy/2026-07-gtm-refocus-drivesense.md) for positioning context;
do not create a competing strategy or treat their dated status statements as current proof.
Follow the [SDLC](architecture/mira-sdlc-v1.md) for engineering/review gates. This proposal does
not weaken those gates or replace the published product privacy notice. Conflicts or uncertain
capability claims require owner review before use in a customer conversation.

### 1. Information placement and visibility decision matrix

A directory named `private` inside public GitHub is still public. Apply these boundaries to
files, filenames, branches, commit messages, PRs, issues, comments, screenshots and CI artifacts.
Use clearly labelled synthetic examples only; removing a name alone does not anonymize a story.

| Destination | Appropriate material | Exclusions / access decision | Proposed retention and owner |
|---|---|---|---|
| Public GitHub | Product/contributor documentation, generic interview questions, process definitions, synthetic examples, verified capability limitations | No identities, contact details, actual prospect counts, campaign metrics, target lists, negotiation details, correspondence, private links, exports, credentials or internal assistant notes. Maintainer reviews the entire publication surface. | Maintainer reviews accuracy at process changes; preserve public process history. Privacy owner escalates accidental disclosures privately. |
| Restricted engineering docs | Necessary pilot technical scope, redacted failure evidence, access design and readiness reviews | A genuinely access-controlled system outside the public repo; named engineering roles only. Use a random case reference; keep the identity mapping in CRM. No raw CRM dump, correspondence or credentials. | Engineering owner sets an expiry when evidence is collected; proposed deletion review at pilot close plus 30 days. Retain only justified technical evidence. |
| Private HubSpot CRM | Minimal contact/account identity, provenance, current qualification, permissions/suppression, interview outcomes, buyer-approved pilot acceptance and commercial stage | Role-limited commercial access. Engineers receive only the minimum scoped technical handoff. Apollo remains a source/outreach tool, not a competing CRM or automatic qualification authority. | CRM steward reviews monthly; proposed review at 90 days without a current purpose, then delete or document a justified expiry. Suppression has a separately approved minimal retention rule. |
| Encrypted export storage | Original Apollo source exports and any necessary reconciliation copy | Outside Git and shared public folders; encrypted at rest/in transit, named custodian access, access logging, separate key management. Never attach exports to issues or copy them into assistant/engineering notes. | Data custodian records purpose, source, acquisition date, rights, access list and deletion date. Proposed removal after validated reconciliation, within 30 days unless a documented need or applicable obligation requires otherwise. |

These intervals are proposed operating defaults, not claims about legal requirements or existing
controls. The privacy owner must approve applicable obligations, vendor deletion/backup behavior
and exceptions before import or contact. Unclear provenance or permitted use means quarantine,
not permission to proceed. Credentials belong in the approved secret manager, never any of these
record formats. Restrict sharing by role and purpose, use individual accounts and MFA, remove
access at role changes, and review access monthly. Do not grant contributors CRM/export access
merely because they can read or contribute to GitHub.

Deletion workflow: the privacy owner receives requests privately; the CRM steward stops pending
contact immediately, propagates suppression to Apollo and checks pending/manual sends, then
coordinates deletion across CRM, exports, derived copies and vendor-supported backups. Record
completion or an unresolved exception privately. Keep only the approved minimum suppression
record needed to prevent reimport/recontact, segregated from marketing use. Do not erase that
record blindly during routine cleanup. Any later restore or import must reapply suppression first.

**Mike's visibility decision:** retaining public product/process docs with separate private stores
supports contributor discoverability; moving engineering material to restricted storage can reduce
future exposure but needs an approved migration and access review. Making the whole repository
private would change collaboration and does not retract existing clones, forks or caches. Decide
separately after a private inventory. This PR performs no migration, purge, credential rotation,
permission change or repository visibility change. Suspected disclosures are reported privately
with minimal location/category information, never copied into a public issue.

### 2. Qualification before outreach

Historical Apollo rows are **unreviewed historical prospects**, not leads, active relationships,
consent or customers. An export row, enrichment match, email open, signup, test account or
engineering demo does not establish buyer interest. Prioritize industrial maintenance/reliability
buyers and technician champions with a relevant operational problem. Keep unrelated investor
lists outside this customer-development funnel; investor activity is not customer validation.

Proposed manual workflow, to be executed only after separate approval:

1. Custodian inventories source provenance and permitted use in private storage. CRM steward
   reconciles HubSpot against Apollo using existing account/contact identifiers and human review
   for ambiguous matches; preserve source history without multiplying contacts or opportunities.
   Apply opt-outs and exclusions before considering any record for contact.
2. Steward records source/acquisition date, last verified date, current role/company relevance,
   verification method, purpose/permission status, suppression status and next review date in
   HubSpot. Unknown or conflicting fields stay unknown. Do not purchase enrichment.
3. Discovery owner confirms an industrial maintenance use case and plausible buyer/champion role.
   Proposed freshness gate: verify current role and contact channel within 30 days before a first
   approach; older/unknown records remain on hold. This check is not consent. Recheck suppression
   immediately before every send, including follow-ups.
4. Discovery owner drafts a short, relevant interview invitation privately. Privacy owner clears
   purpose/channel eligibility; the authorized human sender approves recipients and text. Use
   Apollo only within the approved workflow; no automatic sequence enrollment. Offer a simple way
   to decline. Proposed limit: one follow-up after seven days, then stop without a reply; any
   objection stops contact immediately. These limits also require approval before execution.
5. Log outcomes privately in HubSpot with dated evidence and the next agreed action. No response
   is not interest. A reply agreeing to discovery can advance the record; no reply, wrong role,
   stale contact or objection produces hold/disqualify/suppress with a reason, not a fabricated lead.

### 3. Stage definitions, owners and evidence

Role assignments below are proposed responsibilities, not commitments by named colleagues.
Mike assigns an accountable person and backup for each role before day 1. One person may hold
multiple roles, but customer acceptance must come from the customer, not the implementing agent.

| Stage / measure | Definition and required private evidence | Accountable role / decision |
|---|---|---|
| Historical prospect reviewed | A unique record has provenance, duplicate resolution, freshness and suppression disposition. Review coverage = reviewed unique records / in-scope unique records; report denominator and date privately. | CRM steward: hold until completeness; custodian owns source access/deletion. |
| Contact-eligible prospect | Relevant industrial role/use case, current verified channel and approved purpose/channel, with no suppression. Eligibility is not interest. | Privacy owner clears use; discovery owner confirms fit. |
| Discovery-qualified lead | Explicit agreement to discovery plus a relevant problem and current role recorded with dated evidence. | Discovery owner records evidence; opens no opportunity solely for a historical row or technical signup. |
| Completed discovery | Conversation actually held; recent workflow, problem, consequence, workaround, buyer path and next step captured. Interview completion = held / agreed interviews in the same cohort. | Discovery owner; distinguish declined, no-show and pending. |
| Pilot agreed / started | Agreed written scope, authorized data, time box, acceptance criteria, champion and buyer path; started only when the customer actually begins the scoped task. | Pilot owner and engineering owner validate feasibility; customer agrees scope. |
| Pilot accepted | Customer observes agreed tasks and explicitly accepts results against the pre-agreed criteria. Acceptance rate = accepted / completed pilots, showing failures and pending separately. | Pilot owner records customer evidence; engineering owner records technical readiness separately. |
| Paid conversion | Authorized buyer agrees commercial scope/terms and payment is confirmed through the approved billing process. Track agreement and payment as separate dates. Paid conversion = paid / completed pilots for a stated cohort and cutoff. | Commercial owner verifies with finance; no price or revenue promise inferred from a demo. |

All actual counts, rates, names, notes and negotiation details stay private. Report unknown and
pending honestly; a zero denominator means not applicable, not zero percent. Deduplicate at the
contact/account level and define the cohort and time window before comparing rates. A stage
advance needs evidence, date, owner and next action; a large imported list is not a success metric.

### 4. Discovery, bounded pilot and acceptance

Use the existing interview questions below as historical prompts, without adopting historical
pricing or capability assertions. Ask about a recent maintenance event: what happened, which
manual/tool was used, what was hard to find, how the workaround performed, who approves a new
tool, what data can be shared, and what would make a small trial useful. Ask what would disprove
the fit. Distinguish observed facts, participant statements and our hypotheses. Record only
necessary notes privately; obtain explicit permission before recording or quoting a participant.
A discovery conversation is evidence of a problem, not proof of product-market fit.

Before a pilot, agree one supported equipment/workflow scope, a fixed end date, customer-owned
baseline and measurable acceptance threshold, responsible users, permitted data, support effort
cap, exit/deletion plan and review meeting. The pilot must fit currently verified capabilities;
missing features go to a separately authorized backlog, never a sales promise. Keep evaluation
read-only, respect site safety procedures and qualified personnel, and perform no production
control changes under this plan. Stop for unsafe guidance, unauthorized data/access, an invalid
citation, material scope drift or inability to measure the agreed outcome; investigate before restart.

**Synthetic example only:** a fictional maintenance team evaluates finding the correct manual
section for a fictional pump fault. Before starting, the team chooses a task set, records its
current lookup time and agrees a completion criterion. At review, record correct source/model
match, citation accessibility, task completion, elapsed time, assistance required, failures and
the customer's accept/reject/defer decision. This is a measurement template, not a real customer,
benchmark, improvement claim or promised result.

Keep three evidence lanes separate:

- **Engineering tests:** commit/build, fixture, test command and result establish tested behavior.
- **Deployment verification:** environment/version, date and smoke evidence establish what ran.
- **Customer acceptance:** agreed task/threshold, observed outcome and explicit customer decision
  establish usefulness for that bounded pilot. A passing test or deployment is not acceptance.

Only an accepted pilot with an identified buyer and a mutually agreed next step enters commercial
conversion review. Discuss scope, procurement and support privately; Mike approves terms and
pricing separately. Accepted but unpaid remains accepted/unpaid. Declines and inconclusive pilots
are useful findings; neither becomes a success story. Public claims require independently checked
evidence, customer publication permission where relevant, and a separate privacy review.

### 5. Proposed 30-day process and decision gates

| Window | Work and accountable owner | Exit evidence / decision gate |
|---|---|---|
| Days 1–7: establish boundaries | Mike assigns roles and approves scope; privacy owner approves placement/retention; custodian and CRM steward inventory and reconcile a deliberately bounded cohort using existing HubSpot/Apollo. | G1: documented access, provenance, suppression and freshness dispositions. Unclear rights or incomplete controls means hold; no outreach. Cohort size is chosen privately from available capacity, not mandated here. |
| Days 8–14: learn the problem | After G1 and separate outreach approval, discovery owner conducts consented interviews and records contrary evidence as well as fit. | G2: a recurring relevant problem, accountable champion, buyer path and measurable task are evidenced. If absent, revise the hypothesis or stop; do not force a pilot to meet the calendar. |
| Days 15–21: scope a trial | Pilot and engineering owners propose a bounded evaluation using verified capabilities, agreed baseline/threshold and data/support limits. | G3: customer and owner agree written pilot boundaries and readiness evidence. No agreement or missing capability means hold; no implementation or production change is implied. |
| Days 22–30: evaluate and decide | If a pilot has completed, pilot owner gathers acceptance evidence; commercial owner reviews the paid next step; steward/custodian execute approved retention review. | G4: continue, revise or stop with dated evidence and owner. Advance to paid only on agreed terms and confirmed payment. Otherwise retain the honest stage; a pilot may extend beyond day 30 only by explicit agreement. |

At each weekly review, privately assess record completeness/freshness, opt-out processing,
interviews held, evidenced problems, pilots agreed/started/completed/accepted and paid conversions
using the definitions above. Review misses and suppression exceptions before increasing activity.
No targets or forecasts are invented here; Mike sets capacity and decision thresholds privately.

**Next three practical actions:**

1. Mike reviews this proposal, assigns role owners and decides the information-placement policy;
   separately decide whether a repository visibility assessment should proceed.
2. The assigned custodian and CRM steward prepare a private inventory and qualification sample
   using existing Apollo and HubSpot, documenting provenance, freshness, duplicates, opt-outs and
   deletion dates. Obtain approval before changing records or importing data.
3. The discovery owner prepares an interview guide and a synthetic pilot acceptance worksheet;
   bring these and the eligibility evidence to Mike for approval of any subsequent outreach.

## Historical discovery material

The material below is historical context, not current product, pricing, traction or acceptance
proof. Do not add new identifiable conversations or activity here. New records use the private
workflow above; public examples must be synthetic and clearly labelled.

## Interview Log

### Interview #1 — Lead Maintenance Technician (Internal)

**Date:** April 21, 2026  
**Who:** Lead tech on Mike's maintenance team  
**Context:** Casual conversation about daily workflow pain points  
**Format:** In-person / informal

**Key Quote:**
> "It would be really nice to have an AI summarization of the pass-down being sent to him digitally ahead of time."

**What this validates:**
- **Morning pass-down report feature (#466)** — the automated 6AM email digest we designed in the video marketing plan (Short #8, "The Morning Report") maps DIRECTLY to a stated need from a real technician
- **Digital-first communication** — techs want information pushed TO them, not something they have to go look for
- **AI summarization** — they're not asking for "more data" or "a dashboard to check" — they want the intelligence layer to SUMMARIZE and DELIVER proactively

**MIRA feature alignment:**
| Stated need | MIRA feature | Status |
|-------------|-------------|--------|
| AI summarization of pass-down | Morning maintenance report (#466) | Code shipped, needs Resend domain verification for email delivery |
| Sent digitally ahead of time | Push notifications (ntfy.sh) + email (Resend) | ntfy LIVE, email pending domain verify |
| Before the shift starts | 6AM Celery scheduled task | Built, ready to deploy |

**Competitive note:** This is EXACTLY what differentiates MIRA from traditional CMMS tools. UpKeep/Limble/MaintainX have dashboards the manager has to go CHECK. MIRA DELIVERS the intelligence proactively. The tech doesn't open an app — the app comes to the tech.

**Action items from this interview:**
1. ✅ Morning report feature already built (#466)
2. ⬜ Get Resend domain verified so the email actually sends
3. ⬜ Prototype: send a sample morning report to this tech's phone and get feedback on format
4. ⬜ Ask follow-up: "What would you want IN the summary? Just faults? Or also parts used, follow-ups needed, who worked on what?"

---

## Signal Tracker

| # | Date | Source | Signal | Validates Feature | Strength |
|---|------|--------|--------|-------------------|----------|
| 1 | 2026-04-21 | Lead tech (internal) | Wants AI-summarized pass-down sent digitally before shift | Morning report (#466) | STRONG — unprompted, specific |

---

## Interview Template (for future conversations)

### Interview #N — [Role] at [Company/Context]

**Date:**  
**Who:** [Title, relationship, how you know them]  
**Context:** [How did the conversation come up? Cold outreach? Casual? Demo?]  
**Format:** [In-person / phone / video / text]

**Key Quotes:**
> [Exact words if possible. Paraphrase if not, but mark it.]

**What this validates (or challenges):**
- [Feature or assumption this supports]
- [Feature or assumption this contradicts]

**MIRA feature alignment:**
| Stated need | MIRA feature | Status |
|-------------|-------------|--------|

**Follow-up actions:**
1. [What to do next with this person]

---

## Notes for Gust Launch

This document supports the customer discovery phase of the Gust Launch accelerator. Each entry is evidence that the product-market fit hypothesis is (or isn't) correct.

**MIRA's core hypothesis:** Maintenance technicians and their managers need an AI copilot that diagnoses equipment faults in real-time, captures the knowledge, and delivers proactive intelligence — all from their phone, without learning new software.

**Validation criteria (what we're testing):**
1. Do techs actually want AI help with diagnostics? Or is it a solution looking for a problem?
2. Do managers want automated reporting? Or do they prefer their current pass-down meeting format?
3. Will a plant pay $499/mo for this? Or is the value prop not strong enough at that price?
4. Is the phone the right form factor? Or do they need something else (tablet, desktop, radio)?
5. Is QR code entry the right onboarding path? Or is it friction they won't adopt?

Each interview should produce evidence for or against at least one of these five questions.
