# Customer problems and acceptance

**Working product hypotheses, November 1, 2026.** Read with the [source and evidence boundaries](README.md#existing-sources-and-owners) and existing [Level 3 plan](https://github.com/Mikecranesync/MIRA/blob/e4ba51a4879b7c829a7cd171454559030e10926f/docs/superpowers/plans/2026-11-01-first-customer-level-3.md). This is a customer-value overlay, not a second capability-closure registry.

## The job we should earn

When a supported machine has a fault, help the technician find and understand a justified next step quickly, then preserve useful evidence for whoever works on it next. Useful abstention identifies the missing evidence or safe escalation; a product that mainly abstains from supported jobs still fails usefulness acceptance.

The knowledge base, UNS and state panel serve this job. State capture should reuse the technician's existing description, present its proposed interpretation for correction, and confirm it with minimal repeated entry. Do not require a separate historical-data project before the first supported question can be answered. Keep identity, evidence and required safety confirmation intact.

## All eight Demand Map pains, connected to observable relief

The source map's numbering is retained for traceability, not a new quantitative ranking. Customer demand, prices and claimed savings remain unvalidated here.

| Pain | First useful behavior | Proof of relief and failure condition | Existing plan / treatment |
|---|---|---|---|
| 1. Hunting through the customer's own manuals | Correct asset and applicable manual are ready; plain-language question produces a supported next step with an opening citation | Compare total time to an independently accepted next step with manual search. Wrong-model evidence, incomplete prerequisites or unsupported critical facts fail. | Tasks 2–4; first customer-facing priority |
| 2. Junior/night-shift knowledge gap | Technician can use approved OEM guidance and scoped prior experience, with uncertainty and escalation visible | Less experienced technician completes the supported reasoning task without a senior or operator rescuing it; log every correction and assistance. No claim of replacing qualifications. | Tasks 3–5, 7, 9 |
| 3. Slow recovery during downtime | Existing answer and guided-work path gets the technician to a useful next diagnostic action | Measure fault-question-to-accepted-next-step time. Record restoration time separately only when observed under real site procedures. Faster answers alone do not establish lower MTTR or prevented downtime. | Tasks 2–4, 6, 9; same core product |
| 4. Fault guides that only repeat an error | One qualified OEM branch turns the fault into an evidence-backed check, result and next branch | For a supported branch, inputs change the next step correctly; no dead-end echo, invented measurement or unsafe instruction. No matching branch gives an honest sourced fallback. | Tasks 4, 6, 7; qualify one family |
| 5. Wrong/unknown machine and manual | Confirm model/component/revision, then choose or attach the matching manual | Corrected identity persists and excludes conflicting models. Prove the manual-selection route first; photo assistance is useful only when qualified. | Task 3; optional assisted identification |
| 6. CMMS complexity/migration | Complete the core job using MIRA with no CMMS account, connector or work-order migration | Full pilot journey passes with CMMS integrations off; no missing CMMS setup blocks an answer, packet or asset memory. | Core scope; external writes deferred |
| 7. Repeating the same discovery every shift | Confirm a useful observation/fix once, retain verification and let the next authorized technician recover it | Technician B recovers approved asset evidence and an appropriate next step without asking A to repeat it. Private chats remain private; an old fix is not asserted as a universal cause. | Mission 001 / Tasks 5, 7 |
| 8. Help disappears when connectivity drops | Preserve draft, evidence references and job progress; show an honest connection/recovery state | Lose connection, return, and resume without lost input, duplicate events or false “saved” state. Full offline Q&A/manual access needs separate qualification. | Task 2 recovery now; offline retrieval later |

## Practical priority and work boundaries

1. **Make the existing cited-manual path useful and safe on the phone.** Qualify actual customer manual packs and fix existing source, applicability, instruction-fidelity and phone failures. Reuse current owners' fixes.
2. **Finish Mission 001 as a benefit to that path.** Test that the customer's current observation changes the appropriate state and improves the next response. A new panel plus a saved report is insufficient.
3. **Close one supported job and handover.** Accept one sourced packet/guided branch and a verified outcome that another technician can use.
4. **Expand after evidence.** Add the next required manual family when pilot work demonstrates the need. Qualify assisted discovery, offline reasoning and external actions separately.

These are acceptance priorities; they do not dispatch new agents or interrupt existing approved implementation. PR #5091 owns the state slice. PR #5062 owns the existing packet. Shared UI has one writer under the existing claim protocol. No new dashboard, knowledge store, bus or CMMS replacement is proposed.

Before each implementation mission, record five items: customer situation; blocked job; smallest useful behavior; falsifiable acceptance; existing owner/reuse path. A proposed feature that cannot identify these needs customer discovery before expansion.

## Measure customer relief before declaring success

Use the [pilot job receipt](PILOT-JOB-RECEIPT.md). Freeze the equipment/manual/task scope and acceptance before evaluation; use independent assessors and unseen representative cases under the existing sealed-evaluation rules.

- Record both **time to first useful result** (including required onboarding/setup on first use) and **time from the fault question to an accepted next step** (including identity confirmation, source loading, waiting, corrections and retries).
- Establish a comparable manual-only baseline. Counterbalance task order to reduce learning effects. Treat prompted assistance and retries as part of elapsed time, not invisible operator work.
- Judge the next step against the actual source, applicability and safety conditions. Page targeting is a separate metric from correctness.
- Record a completed safe task, an appropriate evidence-seeking next step, an abstention and an escalation separately. A resolved software turn does not mean a resolved machine fault.
- Keep observation-confirmation effort visible. Re-entering the same details, losing a draft or asking the user to maintain a separate dashboard counts against benefit.
- Record capped cost per completed supported job, retaining unknown costs/reservations. Costs are not zero merely because a provider omitted usage.

Use the Level 3 plan's proposed bars: all mandatory gates; zero critical safety/identity/privacy/state-integrity failures; at least 90% supported citation checks among answered cases; at least 80% useful grounded in-scope results; representative set of at least 30 distinct cases; 4/5 technicians complete independently and at least 3/5 show measured benefit on comparable tasks. Apply any stricter existing gate. These are proposed acceptance criteria, not achieved results or statistical market proof.

Measure actual elapsed-time changes and report the median plus individual results. Do not invent a percentage reduction, select only successful sessions, or convert time-to-answer into an MTTR claim. Calibrate any additional numerical value target against the pilot baseline before freezing it.

## Demand and willingness to pay remain separate evidence

Public complaints and competitor offerings suggest problems worth testing. They do not prove that our pilot customers have the same urgency, trust our implementation or will buy it.

During the existing five approved organizations' free 30-day pilots, record the customer's recent concrete incident, workaround, frequency and consequences; have the technician perform their supported job; then record whether the buyer wants a separately agreed paid continuation. Stated interest, a free signup, repeated use and a paid agreement are distinct observations. Do not publish a price or contact anyone from this document.

Level 4 follow-up remains at least 2/5 technicians voluntarily returning for a second supported job within 14 days, with retained benefit and no critical failures. No automatic renewal. If the main benefit is absent, improve the existing job or narrow the offer before adding more capability breadth.

## Current evidence checkpoint

The main branch inspected for this docs slice was `8f3b56311fd6010a2e2f2d3d3edb806ead8eb0ca`. Its [#5087 merge](https://github.com/Mikecranesync/MIRA/pull/5087) implements the campaign-spend work associated with #5081; do not reimplement it from the older plan's open-issue snapshot. Runtime acceptance and exact deployed identity remain separate checks. The documents' other historical states also require refresh before acting.

This supplement changes no release gate and asserts no current production readiness, avoided outage, time saving or paid demand.
