# {{Company Name}}

> Copy this template into `companies/{{slug}}.md` and fill in. Mark unknowns with `UNCONFIRMED:` or `?`. Keep the section headings — INDEX cross-refs assume them.

## Identity

- **Name:** {{Company Name}}
- **Website:** {{https://...}}
- **HQ / origin:** {{city, country}}
- **Founded:** {{year}}
- **Funding / ownership:** {{public / VC / bootstrapped / subsidiary of X}}
- **Category:** {{MES | UNS / DataOps | MQTT broker | CMMS | SCADA / HMI | Industrial AI | Consultancy | Platform | Other}}
- **ProveIt involvement:** {{member / speaker / unrelated / unknown}}
- **Industry 4.0 relevance score (1-5):** {{n}}
- **MIRA overlap (1-5):** {{n}} — 1 = adjacent, 5 = direct competitor
- **Last reviewed:** {{YYYY-MM-DD}}
- **Reviewer:** {{name or "claude-code"}}

## What they do (public summary)

{{2-4 sentences. Plain language. Cite the source(s) you read.}}

## Architecture (as publicly described)

- **Data model / hierarchy:** {{site → area → line → asset → component → tag, or whatever they describe — quote when possible}}
- **UNS / namespace approach:** {{ISA-95 ltree? Sparkplug B groups? proprietary? none?}}
- **Protocols supported:** {{MQTT / Sparkplug B / OPC-UA / REST / GraphQL / Modbus / EtherNet/IP / ...}}
- **AI / ML usage:** {{LLM chat? anomaly detection? predictive maintenance? none?}}
- **Hosting / deploy model:** {{SaaS / on-prem / hybrid / edge appliance}}
- **Notable repos:** {{github.com/... — link}}
- **Notable screens / UX:** {{describe + link to screenshots / demo videos}}

## Maintenance / CMMS / PLC relevance

- **Do they touch maintenance?** {{yes/no — how}}
- **Do they touch CMMS?** {{integrate? replace? agnostic?}}
- **Do they touch PLC programs / tags?** {{read-only? configure? own the program?}}

## Business model

- **How they sell:** {{self-serve SaaS / enterprise sales / channel partners / OEM bundle}}
- **Pricing visibility:** {{public price / quote-only / freemium}}
- **ICP signal:** {{discrete vs process, plant size, geography}}

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| {{title}} | {{docs / repo / video / blog / case-study}} | {{url}} | {{YYYY-MM-DD}} | {{1-line summary}} |

## What MIRA should emulate

- {{specific pattern, with file/repo pointer}}

## What MIRA should avoid

- {{specific anti-pattern, with reasoning}}

## Integration opportunity

- {{is there a connector, partnership, OEM angle? — concrete next step or "none seen"}}

## Threat level to MIRA (low / medium / high)

- **Score:** {{low / medium / high}}
- **Why:** {{1-2 sentences — overlap in ICP, wedge, or motion}}

## Usefulness score for MIRA learning (1-5)

- **Score:** {{n}}
- **Why:** {{what specifically we can learn from them}}

## Open questions

- [ ] {{thing we couldn't confirm from public sources}}
- [ ] {{follow-up to research next sprint}}

## MIRA lessons (1-3 bullets)

- {{takeaway that should be visible in mira-lessons/mira-architecture-decisions.md if material}}
