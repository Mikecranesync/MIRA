# MIRA morning research and experience handoff — 31 October 2026

**Information only · proposed direction · no implementation authorization**

This packet makes the morning's research and product thinking discoverable to repository agents. It is not a release note, a new implementation mission, a claim of deployed functionality, or an approved scientific publication. It contains public professional references and original design proposals—not private contact records or relationship histories.

## Start here

| Document | Purpose | Status |
|---|---|---|
| [Research network](research-network.md) | Local-first research fit, public profiles, and collaboration questions | Prospective collaborators only; no endorsement or partnership |
| [Practitioner response paper](coffeebench-response.md) | Decision contract and proposed incremental-evidence study | AI-assisted draft; author review pending; no original experiments |
| [Customer experience](mira-customer-experience.md) | Blind link-to-answer-to-CMMS journey and acceptance contract | Target experience, not verified implementation |
| [Contents manifest](MANIFEST.md) | File scope and public-sharing boundaries | Documentation inventory |

The response paper is a **public-safe adaptation of an AI-assisted private draft, with author review pending**. Its intellectual content is preserved; the byline and publication framing distinguish informational sharing from author endorsement. Inclusion here does not establish author approval, submission, publication as research, or agreement to proposed sample sizes. Obtain author review before representing it as Mike Harper's approved position or sending it as a collaboration proposal.

## The desired outcome

For one real maintenance job, MIRA should help a technician reach a correct, safe, source-supported next decision faster than working without it—and repeat that advantage on unfamiliar cases. A useful decision may be a supported answer, one necessary evidence request, or a justified escalation. The experience should be a helpful engineering colleague, not a confident answer generator or a self-assigned reliability badge.

## Research findings and their limits

CoffeeBench is a simulated-appliance preprint, not factory validation. Its judge score is not a calibrated correctness probability. See the response draft for methods and limitations. [Primary paper](https://arxiv.org/abs/2610.19291).

A public CoffeeBench repository and reuse license have not been verified in this handoff. Do not infer permission to reuse code from the existence of a paper or dependency licenses.

The response draft also situates its proposal beside manual-grounded fault-diagnosis evaluation, human–AI team performance, citation support, and selective classification. Those are supporting research directions, not proof that MIRA works. Their primary-source references appear in the draft.

## Immediately applicable design proposals

1. **Keep an explicit case ledger.** Separate asset identity, observations, applicable sources, hypotheses, contradictions, unknowns, and decision history. Corrections preserve provenance rather than silently overwriting the past.
2. **Ask the next useful question.** Explain which uncertainty a request resolves and how it could change the next decision. Accept unavailable evidence; do not repeat answered questions or invent measurements.
3. **Audit consequential claims.** Check source applicability and support, contradictions, and permission boundaries separately. Model agreement is not independent verification. A link alone does not prove the cited passage supports the claim.
4. **Choose answer, ask, or escalate.** Do not force a diagnosis at a turn limit. Do not convert uncertainty into hazardous testing instructions, automatic equipment control, or unsupported repair decisions.
5. **Evaluate the technician–assistant team.** Compare unaided work, a retrieval baseline, an interviewer with a ledger, and an interviewer with an evidence audit. Measure defensible decisions, severe errors, time including unsuccessful cases, review burden, and appropriate escalation. Proposed study sizes are design values—not recruited participants or collected data.

## Target customer journey

Open a fresh link → understand the purpose → use a clearly isolated sample or authenticated real asset → establish asset and source applicability → get a useful response or question → supply evidence that can change the decision → inspect the support → record the actual outcome → preview a specific work-note change → approve that bounded change → transmit → independently read the destination record → resume the case next shift.

The supplied sample is synthetic. Its routing rule supports a review request, not a confirmed fault, a pump replacement, an equipment-specific procedure, or a claim about real machine behavior.

### Backend promises that must match the screen

- FactoryLM asset memory and unified namespace (UNS) events retain provenance; model hypotheses do not become authoritative asset conditions.
- Distinguish local unsaved draft, durable MIRA save, draft note, approval pending, queued, sent, confirmed by independent CMMS readback, and unresolved failure/conflict.
- Preview and authorize the exact tenant, asset, destination, operation, and fields. Preserve unrelated fields. Recheck authority before queued delivery.
- Reuse a stable intent identity, reconcile uncertain outcomes before retry, and handle concurrent edits. Do not promise unconditional exactly-once delivery.
- Atlas is the proposed first testbed. Each later adapter must declare its actual capabilities and earn separate acceptance; unsupported operations remain unavailable.
- A work-note approval does not authorize work-order closure, signoff, physical actuation, or PLC control.

## What was prepared versus what remains unproven

**Prepared:** professional research and a public-safe shortlist; a practitioner response draft with references; a detailed customer journey; a blind-review acceptance checklist. Private relationship preparation remains separate. These documents do not establish outreach, collaborator interest, data-sharing permission, funding, or engagement.

**Proposed, not established:** the interviewer/ledger/audit design, study recruitment and experiments, improved diagnostic performance, the complete CMMS round trip, universal adapter support, or repeatable advantage on live maintenance work. Passing document review or software tests would not establish customer acceptance or field effectiveness.

## Agent coordination: inspect before creating work

Historical coordination references include MIRA [#5020](https://github.com/Mikecranesync/MIRA/issues/5020), [#5024](https://github.com/Mikecranesync/MIRA/pull/5024), and [#5025](https://github.com/Mikecranesync/MIRA/issues/5025). These links are pointers to inspect, not assertions about current owners, review status, merge state, or outstanding defects. Check current repository instructions, issue owners, latest commits, review evidence, and existing missions before proposing overlapping work.

### Repository snapshot checked 31 October 2026, 11:06 UTC

This is a dated coordination snapshot, not new acceptance evidence. Refresh these records before relying on their state.

- [Mission #5020](https://github.com/Mikecranesync/MIRA/issues/5020) remains open. Its older three-round closeout is superseded for the foundation PR by the later review below; the full interviewer and inbound round trip remain beyond that foundation.
- [PR #5024](https://github.com/Mikecranesync/MIRA/pull/5024) is open and unmerged at `fffb1363b792660cfa7f74ebc3632f7c4f04e4ec`. [Round 6](https://github.com/Mikecranesync/MIRA/pull/5024#issuecomment-6542429520) reviewed that head and body digest `04ffdd0c560e7b017cc690b1756dbd7f3c44017262afb04cb4753f04f82c32e4`, reporting 0 BLOCKER, 0 HIGH, and 1 MEDIUM. The [follow-ups record](https://github.com/Mikecranesync/MIRA/pull/5024#issuecomment-6542434304) tracks that medium in [#5027](https://github.com/Mikecranesync/MIRA/issues/5027): a transient pre-create marker lookup failure can quarantine a never-sent fix. This is review convergence under the existing process, not merge, deployment, or product acceptance.
- [#5025](https://github.com/Mikecranesync/MIRA/issues/5025) remains open for reported legacy Atlas partial-PATCH, conflict-type, and unscoped-lookup hazards. No fix or live verification is supplied by this packet.
- The [customer/release tracker #4372](https://github.com/Mikecranesync/MIRA/issues/4372#issuecomment-6539264445) reports the deployed `01f4f512fbdb8e9489c571f95805bb6a12c775aa` line. Its linked [production deploy](https://github.com/Mikecranesync/MIRA/actions/runs/41169886680) and [smoke run](https://github.com/Mikecranesync/MIRA/actions/runs/41170387188) were independently checked as completed successfully for that SHA. These are repository receipts, not a live service probe or proof of the proposed customer journey.
- The checked-in [release-train record](../../architecture/convergence/RELEASE_TRAIN.yaml) at this packet's base `01f4f512f` still describes `mira-1.2.0` as `RC` and expected migration level 110. Its identity differs from the newer tracker report; do not collapse a registry expectation, a workflow receipt, and a verified runtime into one status. This information PR changes none of them.

For every capability, distinguish **specified → implemented → tested → reviewed → merged → deployed → accepted by a user**. Record evidence for the actual stage; do not infer later stages from earlier ones.

The next useful planning action is to map the customer-experience checklist against existing owners and observable evidence, identify genuine gaps, and propose a bounded next mission for approval. This packet itself authorizes **no code change, execution mission, spending, outreach, deployment, merge, equipment intervention, or expansion of an existing build**.
