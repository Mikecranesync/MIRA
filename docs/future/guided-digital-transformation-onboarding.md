# Future Concept: Guided Digital Transformation Onboarding

Status: Future / preserve only

## Purpose

Preserve a future FactoryLM/MIRA onboarding concept for companies that have little or no existing digital transformation. This is intentionally not part of the current application delivery path and should not distract from proving the core technician experience.

## Product Idea

FactoryLM provides a guided onboarding wizard that helps a plant move from an unstructured legacy environment to enough trusted digital context for MIRA to be useful.

The wizard does not independently seek passwords, scrape secrets, or silently gain access to industrial systems. It guides authorized plant personnel through the steps required to inventory, structure, connect, secure, and verify their environment.

The target experience is:

1. Inventory the plant, lines, machines, HMIs, PLCs, drives, historians, CMMS, manuals, and existing software.
2. Propose a FactoryLM Project / UNS structure from confirmed information.
3. Recommend the next connection or setup step.
4. Explain exactly what access is needed and why.
5. Let the customer's authorized IT / controls personnel configure credentials or permissions directly in the appropriate local system, connector, gateway, or secure store.
6. Verify the connection and retain evidence of what was proven.
7. Continue progressively until MIRA has enough trusted context to answer useful technician questions.

## Security Principles

- No silent credential collection.
- No password harvesting.
- No write/control access as part of ordinary onboarding.
- Default to read-only and least privilege.
- Explicit human approval before deeper discovery or connection steps.
- Credentials should be entered into the customer's approved system, connector, gateway, or secret store rather than exposed to the AI model.
- Every connection should show what is being accessed, for what purpose, and with what permissions.
- Maintain an evidence trail for discovered or confirmed facts.

## Example Wizard Progression

- Plant inventory started
- Assets organized
- Documentation attached
- Existing industrial software identified
- Read-only data sources connected
- Security / permissions configured
- Machine context verified by plant personnel
- MIRA ready for technician use

## Relationship to the Discovery Probe Idea

A future USB or edge-device discovery tool may eventually accelerate onboarding, but the onboarding wizard is the safer and more general product concept.

The physical device should be optional. The core capability is the guided workflow: discover what exists, tell the customer what to do next, let authorized personnel perform the security-sensitive step, verify the result, and progressively construct the plant's trusted digital model.

If a discovery probe is later built, it should start in a passive/read-only posture and feed observations into this wizard rather than bypassing it.

## Product Positioning

This could let FactoryLM serve plants that are not yet "AI ready." Instead of requiring a pre-existing UNS, historian strategy, organized documentation, and clean integrations, FactoryLM could guide the plant toward that state.

The UNS should increasingly become an output of verified discovery and onboarding rather than a large manual configuration burden.

## Non-Goals for Current Development

Do not build this now unless it becomes a validated customer requirement.

It must not block or redirect current work on:

- the ChatGPT-style technician experience,
- Projects / conversations / evidence,
- mobile and web convergence,
- answer integrity,
- reliable production deployment,
- the public product demonstration,
- real technician validation.

## Future Validation Trigger

Revisit this concept when one or more real prospects say some version of:

- "We don't know where to start."
- "Our plant isn't digitized enough for this."
- "We have PLCs and HMIs, but no organized data layer."
- "IT/security will not let an AI system directly inspect our network."
- "Can you walk us through connecting everything safely?"

At that point, prototype the smallest wizard that can take one plant from inventory to one verified, read-only machine connection and a useful MIRA conversation.
