# FactoryLM technical publishing pilot

**Status: Phase 1 — documented handoff, 2026-10-25.** Mike approved the two-page PowerFlex sample and requested that the sample, creation process, independent judges and marketing work be recorded in [PR #4762](https://github.com/Mikecranesync/MIRA/pull/4762). He then asked to break implementation into phases so the work is durable and usable by Claude, Codex and other agents.

The goal is one repeatable learning cycle: a real technician question produces a useful sourced document; reader feedback and a separately observed MIRA evaluation identify warranted improvements; a comparable retest establishes whether a repair helped. We are at the start gate. Editorial polish is not evidence of product performance or customer demand.

## Start here

| Resource | Purpose | Current state |
|---|---|---|
| [Phased plan](PHASED-PLAN.md) | Bounded implementation slices, acceptance evidence and next-agent handoff. | Ready to implement phase by phase. |
| [Callable skill](../../../../.agents/skills/marketing/technical-publishing/SKILL.md) | Common instructions for Claude, Codex and other agents. | Research/drafting workflow documented; automated build commands remain Phase 2. |
| [PowerFlex example](examples/powerflex-525/) | Approved-reference identity, editable article input, claim ledger and illustration requirements. | Approved reference and proposed reusable input are distinguished in the example notes. |
| [Independent judge](JUDGE.md) | Technical and visual roles, required evidence, hard failures and revision bounds. | Contract documented; executable integrity gate remains Phase 3. |
| [Marketing experiment](MARKETING-EXPERIMENT.md) | Current channel research and a four-week usefulness/distribution study. | Study and draft copy complete; no launch or outreach performed. |
| [Editorial guide](../style-guides/STYLE-GUIDE.md) | Voice, technical scope, attribution, figures and export standard. | Working standard. |
| [Product-learning pilot](../style-guides/BLOG-PLAN.md) | Reuse of Answer Radar, outcome classification, repair and retest. | Existing components identified; reviewed-case adapter and these case runs remain proposed. |

## Invoke the workflow

Agents with repository skill discovery can invoke `$technical-publishing`. Any other agent can read `.agents/skills/marketing/technical-publishing/SKILL.md` directly. A Claude entry point points to that same canonical file so the instructions do not diverge.

Example task:

```text
Use $technical-publishing for the PowerFlex 525 F004/F005 case.
Read the phased plan and example status first. Complete only the next unfinished
phase. Preserve the approved reference, source identities and unresolved limits.
Return changed paths, commands actually run, evidence, findings and the next
bounded handoff. Do not report an unbuilt tool or unrun judge as complete.
```

## Quality and repeatability

Preserve the exact approved PDF and artwork as reference assets. Record their hashes, source editions and actual tool provenance. Reusing an approved image and a pinned renderer can make document builds repeatable. Generating a fresh image from the same prompt does not promise identical pixels or equal quality; inspect and judge each new asset.

The reference sets a direction: navy/amber identity, readable native text, a direct answer, useful evidence tables, consequences before material instructions, exact applicable sources and an honest illustration label. Improve weaknesses rather than copying them. In particular, make the full subject available as native text as well as in a hero image, and provide usable HTML alongside the printable document.

Two independent review roles are required: technical review against actual applicable sources and visual review of every delivered page against the approved reference. Neither a self-awarded score nor a checksum establishes correctness. The planned mechanical gate rejects incomplete, stale or internally inconsistent review packets; the judges still have to inspect and reason.

## Boundaries of this PR

This PR records and develops the publishing pilot. It does not establish a hardware repair, a current MIRA result, a deployed renderer, an installed scheduled automation or marketing performance. Source drafting, product evaluation, public publication and outreach have distinct evidence and authority. Preserve the user's existing authorizations; do not add a new approval ritual for routine reversible drafting.

The immediate deliverable is a durable handoff on the existing draft PR. Finish one phase and record its evidence before starting another. Do not hold useful documentation hostage to the entire automation project.
