# PRD — Cited Technician Turn

- **Status:** DRAFT — recommendation for product review. This document authorizes no
  production traffic, deployment, provider change, or control write.
- **Date:** 2026-08-03
- **Owner:** Mike Harper
- **Product area:** MIRA technician experience
- **Scope classification:** Core SaaS — grounded maintenance copilot, not generic chat
- **Repository snapshot:** reviewed against <code>origin/main</code> at <code>cde434b9</code>
- **Decision:** Every MIRA answer should be a short, context-bound, cited technician
  turn: what MIRA knows, the evidence it used, the next safe check, and the one
  action that moves the job forward.

## 1. Executive summary

MIRA should borrow the interaction discipline of the best chat products without
copying a generic-chat product surface.

The recommended product is the **Cited Technician Turn**: a mobile-first response
that makes a technician's current asset context, evidence, uncertainty, safety
status, and next action visible in one compact unit. It converts chat from a
scrolling transcript into a reliable maintenance interaction:

1. identify or certify the asset context;
2. answer directly when cited evidence supports an answer;
3. ask one bounded question only when context or evidence is missing;
4. stop and escalate when the safety policy fires; and
5. preserve a reviewable evidence trail for a supervisor, work order, or later
   return to the job.

This is deliberately narrower than a ChatGPT clone. MIRA does not need arbitrary
projects, a general-purpose canvas, web browsing, long-form content generation, or
a separate conversational brain. Its differentiator is a correctly scoped,
evidence-backed answer at the machine.

## 2. Product decision and boundaries

### 2.1 Product decision

**Default behavior:** once MIRA has either confirmed chat context or a certified
direct connection, and has supporting evidence, it gives the direct answer and
one next safe check. It does not use a Socratic follow-up as the default style.

A question is appropriate only when it is necessary to:

- resolve or correct the asset context;
- obtain a required piece of evidence;
- distinguish multiple equally plausible assets or faults;
- honor a safety STOP; or
- collect an explicit outcome or handoff choice.

**This is a rule about defaults, not a ban on conversation.** Dialogue mode is
adaptive on surface, intent, context and evidence — the decision of record is
§2.2 of `docs/prd/2026-08-03-mira-answer-integrity-and-validation-engine.md`,
and the two PRDs agree:

| Surface | Mode |
|---|---|
| Ignition Ask MIRA, QR deep-link, kiosk — **single-shot** | Direct, complete, cited answer. **No trailing question**; the technician cannot reply. (Merged PR #1685.) |
| Hub asset / node pages, certified direct connections | Direct cited answer **plus one next safe check**. Never re-confirm an already-certified asset. |
| Telegram, Slack, conversational web chat | Natural multi-turn conversation. One targeted guiding question when it advances a *live* diagnosis; a direct answer when the answer is already supported. |

Intent modulates this within a conversational surface: "what does F004 mean?"
and "give me the reset procedure" get direct cited answers; "why does this
conveyor keep stopping?" with thin evidence gets what is known plus **one**
grounded question; "teach me how to diagnose this circuit" gets deliberate
Socratic coaching. Safety STOP overrides every mode, and never disguises steps
as questions.

The failure this guards against runs both ways. Quizzing a technician who asked
a direct question wastes the one thing they cannot spare; but stripping the
guiding question out of live conversational diagnosis would throw away the
interaction that makes MIRA feel like a senior technician rather than a search
box. **Never withhold a supported answer to satisfy a style rule — and never
delete a question that is genuinely narrowing the problem.**

### 2.2 In scope

- One semantic response contract across Slack, generic web chat, the Hub asset
  page, and Hub namespace pages.
- Clear distinction between confirmed chat context and UNS-certified direct
  connections.
- Visible citations, freshness, and an evidence-detail view.
- A compact, mobile-first technician response layout.
- Safe STOP, evidence-gap, and human-handoff paths.
- Explicit confirmation, correction, outcome, and draft-handoff controls.
- Deterministic regression coverage for the complete response states.

### 2.3 Non-goals

- A generic personal assistant, arbitrary chat history, file workspace, or
  open-ended research product.
- A replacement for SCADA, CMMS, historian, or a work-order execution system.
- PLC, HMI, or equipment control writes; all live context remains read-only.
- A new LLM abstraction, LangChain, TensorFlow, or n8n.
- A new response registry or parallel chat schema.
- Auto-confirming context from an emoji, auto-promoting knowledge-graph facts, or
  automatically creating/sending a work order or escalation.
- A new public marketing chatbot.

## 3. Why this is needed now

The core pieces exist, but the technician experience is fragmented.

| Current capability | Evidence | Product gap this PRD closes |
| --- | --- | --- |
| Platform-neutral response blocks already exist | <code>mira-bots/shared/chat/types.py</code> defines <code>NormalizedChatResponse</code> and <code>ResponseBlock</code> including citation, warning, button, and suggestion-chip blocks. | The shared dispatcher presently emits a primarily text response, so the richer contract is not yet the common technician experience. |
| Hub asset chat retrieves real evidence | <code>mira-hub/src/app/api/assets/[id]/chat/route.ts</code> streams manual sources, decision trace IDs, machine next checks, safety state, and a provider cascade. | <code>AssetChat</code> currently renders text, trace ID, and next check but not the streamed sources. A cited answer can therefore arrive without visible citations. |
| Hub namespace chat has partial source handling | <code>mira-hub/src/components/namespace/NodeChat.tsx</code> consumes streamed <code>sources</code>. | Asset and namespace chat have divergent response semantics and duplicate UI behavior. |
| Slack and other adapters already share a dispatcher | <code>mira-bots/shared/chat/dispatcher.py</code> is called by Slack and other adapter paths. | Rich response semantics must be preserved through every renderer, not added only to one front end. |
| MIRA has a location gate and safety guardrails | <code>mira-bots/shared/engine.py</code>, <code>uns_resolver.py</code>, and <code>guardrails.py</code>. | The UI must make the gate and STOP states understandable rather than hiding them in free text. |

The architecture requirement is equally important: a presentation surface may format
a turn, but it must not become a second diagnostic engine or provider policy.
The Hub route's valuable manual, machine, and trace context should become a
well-defined evidence producer/adaptor; the end state is one diagnostic policy
behind the shared engine and inference router.

## 4. Users and jobs to be done

| User | Job | Successful result |
| --- | --- | --- |
| Technician at a machine | Diagnose a known fault without retyping the asset, hunting through manuals, or guessing which answer is current. | A short cited answer, clear next safe check, and one obvious action. |
| Technician in Slack or generic web chat | Establish what machine/fault is being discussed before receiving asset-specific guidance. | A compact confirmation card with evidence and explicit correction choices. |
| Technician facing an unknown or incomplete asset | Avoid a plausible but unsafe answer. | An honest evidence-gap response that asks for the most useful missing fact or document. |
| Supervisor / qualified person | Understand why MIRA said something and take over when appropriate. | A reviewable evidence trail and a draft handoff summary with no automatic send. |
| Product and engineering | Keep every front door behaviorally equivalent as MIRA adds evidence sources. | One semantic contract and an automated conformance suite. |

## 5. The Cited Technician Turn

### 5.1 Layout

Every technician-facing response uses the same information hierarchy:

~~~text
Context
  Site / area / line / asset / component / fault
  confirmed, certified, or needs confirmation

Direct answer
  A concise answer in plain language

Next safe check
  One bounded, read-only or human-performed check

Evidence
  Up to three source chips in the primary view
  Open evidence details for the full list and locators

Actions
  Confirm, correct, show evidence, mark outcome, or draft handoff
~~~

The primary view must fit a phone screen without a wall of prose. Expanded evidence
belongs in a drawer or sheet, not in a separate generic canvas.

### 5.2 Required turn states

| State | When it appears | Required content | Prohibited behavior |
| --- | --- | --- | --- |
| **Context confirmation** | Asset-specific chat from Slack, Telegram, email, or generic web chat has a high or medium candidate. | Site, area, line, asset, component, fault/symptom; up to three evidence bullets; confidence band; explicit Confirm / Different asset / Clarify controls. | Troubleshooting, reset advice, or a high-confidence claim without a UNS match. |
| **Direct certified answer** | A Hub asset/node page, QR deep link, Ignition, or other direct surface supplies a resolvable UNS identity on every turn. | Certified context label, cited answer, freshness, next check, evidence controls. | Asking the technician to re-confirm the asset; treating a page title or free text alone as certification. |
| **Confirmed grounded answer** | The chat gate was explicitly confirmed and cited evidence supports the answer. | Direct answer, one next safe check, citations, outcome controls. | Long generic preamble, numeric model confidence, or uncited factual claims. |
| **Evidence gap** | Context is known but supporting evidence is absent, stale, contradictory, or insufficient. | Clear admission of the limit, what evidence is present, and the smallest useful next request. | A confident diagnosis, fabricated citation, or a disguised generic answer. |
| **Safety STOP** | A safety-keyword policy fires. | Hazard category, applicable standard reference, escalation/isolation options, and a clear pause. | Troubleshooting steps, PLC writes, or resuming troubleshooting inside the same safety state. |
| **Human handoff** | The technician requests help, repeats an unsuccessful attempt, or MIRA cannot proceed safely. | Read-only summary of confirmed context, evidence, attempts, and unresolved question; an explicit Draft handoff action. | Automatic message/work-order creation or claiming a human was contacted. |

### 5.3 Context rules

The location-confirmation gate remains load-bearing.

| Entry surface | Required behavior |
| --- | --- |
| Slack, Telegram, email, and generic <code>mira-web</code> chat | Asset-specific turns use the chat gate. No confirmed namespace context means no troubleshooting. |
| Hub asset detail, Hub namespace node, QR asset deep link, Ignition/Perspective, MQTT/Sparkplug, PLC bridge | They may skip the chat gate only when every turn carries a resolvable UNS path, asset-context object, or <code>equipment_entity_id</code> that resolves to a UNS path. The adapter marks the context <code>source="direct_connection"</code>. |
| A purported direct connection with no resolvable identity | Reject with <code>{"error":"uns_required"}</code>. Do not silently downgrade it to a chat-gate question. |
| General educational questions | Do not require asset confirmation, but still cite the supporting manual or standard and honor safety policy. |
| Asset change during a conversation | Clear diagnostic carryover and start the correct gate/certification path again. |
| Low-confidence free-text match | Ask for context instead of presenting a guessed asset. |
| Context confirmation | Require explicit text confirmation or a button click; never infer it from a thumbs-up reaction. |

A direct connection certifies **where** the technician is working. It does not
certify the diagnosis. Every consequential answer still needs supporting evidence.

### 5.4 Direct answer policy

After a valid confirmation or certification:

- Lead with the direct answer, not an apology or an explanation of the model.
- Limit the primary answer to the smallest useful answer and one next safe check.
- Use numbered steps only after context is valid and no safety policy applies.
- Show no more than three primary evidence bullets/chips.
- Distinguish static reference information from live telemetry and show freshness
  as live, stale, simulated, or unavailable.
- Use high, medium, and low only as a context-resolution band; never expose a
  made-up numeric confidence as proof.
- Cite evidence rather than saying “I am confident.”
- Preserve an always-readable text fallback for every block response.

## 6. Canonical response contract

### 6.1 Reuse the existing contract

<code>NormalizedChatResponse</code> and <code>ResponseBlock</code> are the canonical
outbound shape. Do not create a competing <code>CitedTurn</code>, <code>ChatResult</code>,
or per-surface response schema.

| Meaning | Existing block shape |
| --- | --- |
| Context title and state | <code>header</code> plus <code>key_value</code> |
| Direct answer | <code>paragraph</code> and, when appropriate, <code>bullet_list</code> |
| One next check | <code>key_value</code> |
| Evidence source | <code>citation</code> |
| Safety/evidence-gap state | <code>warning</code> |
| Confirm/correct/evidence/outcome controls | <code>button_row</code> |
| Follow-up prompts | <code>suggestion_chips</code> |
| Accessible fallback | required <code>text</code> field |

The block <code>data</code> payload must be versioned and documented before a renderer
consumes it. At a minimum, a citation identifies its source type, human label,
exact locator (page, section, work-order ID, tag/timestamp, or other durable
reference), freshness, and verified/proposed status when applicable.

### 6.2 Boundary ownership

~~~text
Presentation surface
  -> adapter/renderer
    -> shared diagnostic policy and location/safety/citation gates
      -> UNS, live context, component/KG, manuals, and work-order evidence
~~~

- Presentation components render blocks and submit explicit actions. They do not
  infer context, invent citations, or decide diagnostic policy.
- Adapters normalize events and direct-connection identity, then call the shared
  diagnostic path.
- The engine owns safety precedence, context gates, grounding policy, and
  provider selection through <code>InferenceRouter.complete()</code>.
- Hub-specific asset/manual/live-machine retrieval remains an evidence/context
  producer. It must adapt into the common response contract rather than keep an
  independent provider policy indefinitely.
- Provider-specific SSE chunks remain transport details. The consumer receives
  a semantic response envelope, not an ad hoc collection of <code>content</code>,
  <code>sources</code>, <code>traceId</code>, and <code>next_check</code> fields.

### 6.3 Incremental convergence

The migration is intentionally not a big-bang rewrite:

1. Normalize the existing Hub stream fields into the common block semantics and
   render AssetChat sources just as NodeChat does today.
2. Add contract tests proving the same input evidence produces equivalent
   context, citation, warning, and action semantics across Hub, Slack, and
   generic web renderers.
3. Move diagnostic/provider policy behind the shared engine after the response
   policy is reconciled with PR #3088. Preserve the Hub's tenant-scoped manual,
   machine, decision-trace, and drive-pack evidence as inputs to that path.
4. Remove presentation-route provider cascades only after conformance and
   staging tests prove no loss of grounding, safety, or asset evidence.

## 7. Interaction design

### 7.1 Confirmation card

A confirmation card contains:

- a one-line context summary in site → asset → component → fault order;
- structured detail only when it helps disambiguate;
- up to three evidence bullets;
- a confidence band;
- explicit actions: Confirm, Different asset, and Clarify.

The primary button may be “Confirm this asset,” never “Continue” without a
context label. A correction does not silently overwrite prior context; it becomes
technician-confirmed evidence subject to existing provenance rules.

### 7.2 Answer and evidence card

A grounded answer renders:

1. the active context and whether it is confirmed or certified;
2. the concise answer;
3. the next safe check;
4. evidence chips with human labels such as “OEM manual p. 42,” “Work order
   1042,” or “Live tag 14:02:16”; and
5. actions for View evidence, Resolved, Still need help, Source is wrong, and
   Draft handoff when applicable.

On desktop, View evidence opens a right-side drawer/sheet so the answer remains
visible. On mobile, it opens a bottom sheet. This adapts the useful separation
between conversation and detailed work without creating a general artifact or
canvas system.

### 7.3 Evidence gap card

An evidence gap is a successful honest outcome. It must say:

- what MIRA can verify;
- what it cannot verify;
- why the current evidence is insufficient or stale; and
- the next smallest useful input, such as an asset tag, fault code, model,
  manual page, photo, or qualified-person review.

It must not say “try these common fixes” merely to fill the card.

### 7.4 Safety STOP card

Safety is evaluated before normal context or answer behavior. The card:

- states that MIRA is pausing;
- identifies the matching hazard category;
- references the appropriate OSHA/NFPA standard category;
- offers an escalation or acknowledgement action; and
- explains that MIRA cannot provide steps for live, pressurized, confined-space,
  or otherwise hazardous work.

A safety acknowledgement may be recorded, but it does not unlock troubleshooting.
A fresh non-safety message is required to begin a new safe path.

### 7.5 Handoff and outcome controls

- **Resolved** records outcome feedback only; it does not self-promote a KG
  relationship.
- **Still need help** keeps the cited context visible and asks one bounded
  follow-up.
- **Source is wrong** captures a correction for review; it does not silently
  change a verified fact.
- **Draft handoff** builds a reviewable summary. A human explicitly decides
  whether it becomes a Slack message, work order, or escalation.

## 8. Design-system and accessibility requirements

The UI should feel calm and deliberate in a noisy plant.

- Map Mira Hub and Mira Web chat styling to the canonical
  <code>docs/design/factorylm-tokens.css</code> values. Do not add raw hex values
  or a parallel palette.
- Use muted normal state. Reserve green for grounded/healthy/accepted state,
  amber for warning or medium context, red for fault/STOP/rejected, gray for
  unknown/low, and indigo only for actions or selection.
- Use flat cards, thin borders, quiet chrome, and a single obvious primary
  action. No gradients, celebratory decoration, or status-colored branding.
- Touch targets must work on a phone; actions are clear text plus an icon where
  useful, not an emoji-only control.
- The transcript is an accessible live region with appropriate
  <code>role="log"</code>/<code>aria-live</code> behavior. Streaming must not repeatedly
  steal focus.
- A blocking safety STOP or error moves focus to its explanatory content and
  gives it an accessible text label.
- Citation chips announce source type, name, exact locator, and freshness to
  screen-reader users.
- Color is never the only indication of confirmation, stale data, unknown
  context, or safety state.
- Preserve reader position: do not force-scroll a technician reading older
  evidence; auto-follow only when they are already at the newest turn.

## 9. Best-practice patterns adapted for MIRA

These are interaction patterns, not product features to clone.

| Reference pattern | MIRA adaptation | Explicit limit |
| --- | --- | --- |
| ChatGPT Projects: a conversation has deliberately scoped context and attached sources. [OpenAI Projects](https://help.openai.com/en/articles/10169521-chatgpt-projects) | The asset, UNS path, and evidence packet are MIRA's scope boundary. The context bar makes it visible. | No generic project/file workspace. |
| Claude Artifacts: keep a detailed working view separate from the conversation. [Claude Artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) | Evidence details open beside the answer or in a mobile sheet. | No free-form canvas or new artifact system. |
| Slack Block Kit: compose information and explicit actions into portable blocks. [Slack Block Kit](https://docs.slack.dev/block-kit/) | <code>ResponseBlock</code> is the semantic source; Slack, Hub, and web render it appropriately with plain-text fallback. | No Slack-only business logic. |
| Intercom Fin: escalate on clear triggers and carry context into the handoff. [Fin escalation guidance](https://www.intercom.com/help/en/articles/12396892-manage-fin-ai-agent-s-escalation-guidance-and-rules) | MIRA gives an explicit, reviewable handoff summary when safe self-service ends. | No automatic outbound escalation or customer-data leakage. |
| W3C WAI-ARIA live-region guidance. [WAI-ARIA](https://www.w3.org/WAI/standards-guidelines/aria/) | Streamed chat, STOP states, citations, and actions remain understandable without visual-only cues. | Accessibility is a release requirement, not a later polish pass. |

## 10. Delivery slices and ownership boundaries

Each slice is a narrow PR with its own tests and no unrelated refactor.

| Slice | Outcome | Primary areas | Guardrail |
| --- | --- | --- | --- |
| **0. Contract and policy alignment** | Define documented <code>ResponseBlock</code> payloads, state matrix, direct-connection inputs, and a cross-renderer fixture suite. | <code>mira-bots/shared/chat/</code>, tests, docs. | Do not independently alter <code>engine.py</code> or <code>rag_worker.py</code> while open PR #3088 remains unresolved; reconcile its answer-policy decision first. |
| **1. Hub citation parity** | AssetChat renders streamed sources, trace, next check, evidence detail, and correct safety/error states; NodeChat and AssetChat share semantic behavior. | <code>mira-hub/src/components/AssetChat.tsx</code>, <code>namespace/NodeChat.tsx</code>, their routes/tests. | Keep all existing tenant checks and source sanitation. No provider change in this slice. |
| **2. Context-bound adapters** | Generic chat uses the confirmation gate; Hub asset/node routes supply certified UNS identity or reject missing identity. | Hub/API adapters, web-chat adapter, shared event normalization. | A direct connection with missing identity fails closed; it cannot become a free-text chat-gate workaround. |
| **3. Common technician renderers** | Slack, generic web, and Hub render context, citation, warning, and action blocks with accessible fallback. | Slack renderer, webchat adapter, Mira Web widget, Hub components. | Keep technician wording concise; no renderer invents content. |
| **4. Outcomes, handoff, and staged rollout** | Explicit feedback/handoff controls, telemetry, staging proof, and controlled progressive release. | Existing feedback/trace paths, tests, runbook/docs. | Draft-only external actions; no production experiment against customer conversations. |
| **5. Route convergence** | Provider selection and diagnostic policy are behind the shared engine; Hub stays an evidence producer. | Shared engine/inference boundary and Hub adapter. | Requires a reviewed migration plan, staging gate, eval proof, and rollback path. |

## 11. Acceptance criteria

### 11.1 Product behavior

- [ ] A generic asset-specific Slack or web-chat turn cannot receive
  troubleshooting until the technician explicitly confirms the resolved context.
- [ ] A certified Hub asset/node turn with a resolvable identity does not ask
  the technician to reconfirm the page they are already using.
- [ ] A purported direct turn with no resolvable identity returns
  <code>uns_required</code>; it does not continue as generic chat.
- [ ] Every grounded answer exposes at least one visible citation with a usable
  source locator.
- [ ] AssetChat renders the existing streamed source payload; NodeChat and
  AssetChat have equivalent evidence behavior.
- [ ] Answers with no adequate evidence become evidence-gap responses rather
  than confident generic advice.
- [ ] A safety-keyword turn yields STOP and escalation before provider
  troubleshooting; no PLC write or unsafe action is suggested.
- [ ] After STOP, the prior troubleshooting state cannot resume without a fresh
  non-safety message.
- [ ] Changing assets clears prior diagnostic carryover and runs the correct
  confirmation/certification path.
- [ ] Confirm, correction, feedback, and handoff actions are explicit; no
  emoji reaction silently confirms context and no action auto-writes to a CMMS
  or external channel.
- [ ] The technician never sees a numeric LLM confidence score.

### 11.2 Architecture and evidence behavior

- [ ] A single <code>NormalizedChatResponse</code>/<code>ResponseBlock</code> contract
  can represent every required turn state with a plain-text fallback.
- [ ] Presentation routes do not own final safety, context, citation, or
  provider policy in the converged design.
- [ ] Hub manual, machine, live-state, drive-pack, and trace inputs survive
  adapter convergence as evidence; no tenant scoping or current source locator
  is lost.
- [ ] All direct identity handling uses the resolver/UNS authority; no
  hand-formatted path or client-asserted asset identity becomes trusted.
- [ ] Static reference, live telemetry, simulated data, and stale/unavailable
  data are distinguishable in the response.

### 11.3 Quality and test gates

- [ ] Add response-contract fixtures covering confirmation, direct-certified,
  grounded, evidence-gap, safety STOP, handoff, asset change, and missing
  direct identity.
- [ ] Extend <code>mira-bots/tests/test_dispatcher_gate.py</code> or its
  replacement with block and plain-text fallback assertions.
- [ ] Add/extend Hub component tests for AssetChat and NodeChat source, trace,
  next-check, safety, and failure rendering.
- [ ] Add renderer snapshots/contract tests for Slack and generic web
  accessibility text and explicit action IDs.
- [ ] Add deterministic golden journey cases for no-context, confirmed context,
  direct-certified context, missing evidence, stale/live evidence, correction,
  and safety STOP.
- [ ] Run the hallucination audit after any engine, gate, or adapter policy
  change, and keep the existing safety test coverage green.
- [ ] Any visible Mira Hub or Mira Web change includes Playwright proof at
  mobile and desktop viewports in <code>docs/promo-screenshots/</code>.
- [ ] Engine/RAG/FSM changes pass the staging smoke and relevant eval regime
  before merge; no feature branch uses a production bot, production NeonDB, or
  direct VPS deployment for validation.
- [ ] CI has a required path that collects the new regression suite; a test
  file that no required job runs is not an acceptance test.

## 12. Measurement

Instrument the turn without turning technicians into experimentation subjects.

| Metric | Definition | Guardrail |
| --- | --- | --- |
| Time to valid context | Median turns from initial asset-specific message to confirmed/certified context. | A shorter time is not a win if it bypasses the gate. |
| Cited-answer rate | Share of grounded-answer turns with at least one visible, valid source. | Do not count unverified labels or inaccessible links as citations. |
| Evidence-gap honesty | Share of evidence-insufficient cases that return an explicit gap rather than a diagnosis. | Review false gaps; do not optimize by refusing everything. |
| Context correction rate | Explicit correction actions per context attempt. | Investigate resolver/identity quality, not user behavior. |
| Outcome utility | Explicit Resolved versus Still need help after a cited turn. | Do not treat silence as resolution. |
| Safety fidelity | Safety-keyword turns that STOP, retain the lock, and offer an escalation path. | Zero unsafe false negatives in the hard-gate set. |
| Handoff completeness | Draft handoffs containing context, evidence, prior attempts, and open question. | Draft only unless a human authorizes send/create. |

Metrics are product-learning evidence, not an excuse to weaken citations, gate
confirmation, tenant isolation, or safety behavior.

## 13. Rollout and rollback

1. Establish contract fixtures and component tests locally and in required CI.
2. Enable the first surface only in the staging synthetic tenant.
3. Exercise the technician journey: confirmation/certification, cited answer,
   evidence gap, safety STOP, correction, and draft handoff.
4. Capture both mobile and desktop visual proof and a redacted response trace.
5. Release behind a default-off, independently reversible surface/tenant
   configuration. The implementing PR must document the concrete configuration
   name, default, owner, and rollback step.
6. Expand one surface at a time only after the prior surface meets the
   acceptance criteria and has no unresolved P0/P1 safety, evidence, or
   tenant-isolation finding.
7. Roll back by disabling the new renderer/adapter path while retaining the
   existing plain-text fallback; do not delete evidence or decision traces.

No rollout is a reason to test against a real production technician, production
conversation history, or live equipment-control path.

## 14. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A polished UI makes an uncited answer look more trustworthy. | Citation and freshness are first-class blocks; evidence gap is a required state; regression fixtures include missing evidence. |
| The UNS gate becomes annoying and is bypassed in one surface. | Treat direct certification and chat confirmation as separate, testable paths; fail closed on missing direct identity. |
| Hub route convergence loses its rich machine/manual context. | Make Hub an evidence producer/adaptor first; compare current and converged evidence packets in staging before removing any route-local behavior. |
| PR #3088 independently changes answer policy. | Reconcile its product decision before touching shared engine/RAG policy; do not run parallel edits in <code>engine.py</code> or <code>rag_worker.py</code>. |
| Safety STOP turns into a cosmetic warning. | Guardrail check precedes answer generation; STOP has dedicated tests and requires a fresh non-safety message to resume. |
| UI work drifts into a generic chat redesign. | Hold non-goals, mobile answer hierarchy, and evidence drawer boundary in PR review. |
| Color/styling drifts across Hub and Web. | Use FactoryLM tokens and screenshot proof; reject raw color values and duplicate palettes. |
| A successful-looking rollout relies on tests CI does not collect. | Add the suite to a required job and prove collection in the PR description. |

## 15. References

### Internal source of truth

- <code>docs/THEORY_OF_OPERATIONS.md</code>
- <code>.claude/CLAUDE.md</code>
- <code>.claude/rules/uns-confirmation-gate.md</code>
- <code>.claude/rules/direct-connection-uns-certified.md</code>
- <code>.claude/rules/security-boundaries.md</code>
- <code>docs/design/factorylm-style.md</code>
- <code>docs/design/factorylm-tokens.css</code>
- <code>mira-bots/shared/chat/types.py</code>
- <code>mira-bots/shared/chat/dispatcher.py</code>
- <code>mira-hub/src/app/api/assets/[id]/chat/route.ts</code>
- <code>mira-hub/src/components/AssetChat.tsx</code>
- <code>mira-hub/src/components/namespace/NodeChat.tsx</code>
- Open PR #3088: answer-quality probe battery and Answer Integrity PRD

### External interaction references

- [OpenAI Projects](https://help.openai.com/en/articles/10169521-chatgpt-projects)
- [Claude Artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)
- [Slack Block Kit](https://docs.slack.dev/block-kit/)
- [Intercom Fin escalation guidance](https://www.intercom.com/help/en/articles/12396892-manage-fin-ai-agent-s-escalation-guidance-and-rules)
- [W3C WAI-ARIA](https://www.w3.org/WAI/standards-guidelines/aria/)
