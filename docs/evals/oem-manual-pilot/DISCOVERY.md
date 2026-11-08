# How the OEM manuals were found and selected

Research date: 29 October 2026. These are candidate documentation sources, not a market-popularity ranking or a claim that every instruction applies to an arbitrary customer's machine.

## Scope history

The first research handoff supplied 17 PDFs (16 machine/model families plus an archived revision), including a welder, bandsaw and floor scrubber. Private parsing/retrieval artifacts were preserved. Mike rejected that equipment selection and declined the proposed $5 answer-generation pilot. Those files are historical preparation, not the accepted demo target.

Mike clarified the target as **complete industrial production machines, especially injection-molding machines**. He subsequently selected the three candidates below for testing, asked for plant-technician scenarios and ingestion-to-answer traces, and explicitly chose **$0**. He then made accurate cited next steps/troubleshooting a top-priority customer-readiness blocker (#4967). No inference that selecting a manual authorizes spend or deployment.

## Actual search trail

The investigation used public web searches and opened OEM pages/PDFs. Representative queries from the recorded research:

```text
site.boymachines.com operating manual injection molding machine pdf
site.arburg.com operating instructions machine manual download injection moulding
site.sumitomo-shi-demag.eu operating manual injection molding machine pdf
site.arburg.com arburgXworld machine operating instructions documentation
site.engelglobal.com e-connect machine documentation operating manual
site.husky.co injection molding machine manuals portal documentation
injection molding machine "operation manual" filetype:pdf -site:scribd.com -site:manualslib.com
site.wittmann-group.com "manuals" "injection"
site.wittmann-group.com "wb-bg.com"
site.wb-bg.com/upload/manuals "INSTRUCTION MANUAL" injection
site.apsx.com "user manual" "PIM" revision
```

Search results are leads, not verification. Open the actual PDF; inspect cover, applicability, revision, table of contents, operational content, diagrams/tables and copyright terms. A filename containing “manual” does not establish a complete-machine manual. Manufacturer specs, component/control manuals and generic process guides do not satisfy this selection.

## Accepted candidates and constraints

| Candidate | Actual document / scope | Verification / caveat |
|---|---|---|
| Battenfeld PLUS | PLUS350/75 serial25336, 2003, TB4GBV01 05/00; same PDF includes PLUS350V/75 serial25556, TB4GBV00 9/99; UNILOG B2;132 pages | Whole-machine installation, operation and maintenance. Mixed covers require section-specific applicability. Do not declare the two machines interchangeable. |
| Wittmann Battenfeld VM R B6 family | VMRGBV02_0315,25 March2015, UNILOG B6x;226 pages | Whole-machine installation, assemblies, adjustments and maintenance. Cover model/serial fields contain placeholders; exact customer machine remains unidentified. |
| APSX-PIM V3 | User Manual V4.5;45 pages | Complete compact machine with setup, operation and troubleshooting. Mixed2023 date/2025 footer; retain both facts rather than inventing a revision date. A compact desktop machine is not automatically representative of larger production presses. |

Authoritative download URLs and exact observed SHA256 values live in `manifest.json`. The official [WITTMANN Bulgaria listing](https://www.wittmann-group.com/en/bulgaria) confirms `wb-bg.com` is its subsidiary, establishing the OEM provenance of both Battenfeld PDFs. APSX links user manuals from its [downloads page](https://apsx.com/downloads).

## Exclusions and legitimate-access gaps

- BOY and Sumitomo results inspected were brochures/data sheets; not substituted for operating manuals.
- ARBURG's public ALLROUNDER technical downloads are not operating manuals. [MachineCenter documentation](https://www.arburg.com/media/daten/publications/brochures/ARBURGXWORLD_682277_TD_en_GB.pdf) describes machine documentation from2017 through the customer's portal.
- ENGEL [e-connect](https://www.engelglobal.com/en/us/digital-solutions/e-connect-portal) is a legitimate customer route. The public e-connect.24 remote-service manual was excluded as not the complete-machine manual.
- [Husky's public manual page](https://www.husky.co/en/solutions/manuals/) exposed controller/hot-runner/manifold documentation, not a verified complete press manual.
- The [APSX-LSR manual link](https://apsx.com/fill-out-the-form-for-the-apsx-lsr-user-manual) led to a request form; it was not submitted and no restricted access was bypassed.
- Unverified aggregator mirrors were not promoted to OEM-authoritative sources.

For a real plant demonstration obtain the legitimate customer/OEM PDF set, nameplate model/serial/year, control/software version and installed options. Include applicable mechanical, operation/setup, fault/alarm and option supplements. Do not ask for passwords in a ticket. Public availability is not permission to republish manuals: source PDFs, extracted content, page renders and raw retrieval traces stay private. Confirm intended storage/use/audience rights before wider distribution.

## Discovery rerun rule

Repeat the searches and provenance check, then compare downloaded bytes with the lock. A changed hash is a new candidate edition, not an automatic update. Inspect applicability and rights, create a new corpus identity, preserve the old lock, and review question/page expectations before running. Never alter the frozen rubric just to make a candidate pass.
