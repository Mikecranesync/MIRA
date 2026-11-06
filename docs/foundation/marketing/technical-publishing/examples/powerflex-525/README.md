# PowerFlex 525 reference example

The user approved the two-page **FactoryLM-PowerFlex-525-F004-F005-Sample.pdf** on 2026-10-25, then requested that it and the creation workflow be preserved for other agents.

## Artifact status

| Item | Identity / status |
|---|---|
| Approved PDF | SHA-256 `c84aca76304482965124fb5943197c05a56bb5cd192e6a952f13288a23534c07`; 3,394,411 bytes; two US Letter pages. This is the exact attached, approved file, not the earlier local export with different bytes. |
| Approved hero | SHA-256 `88bf4364b278404a72f310cec1a6d74965287484fc667b4e931009f8d83e074a`; 1,923,489 bytes; 1536 × 1024 PNG. OpenAI-generated editorial illustration, generic hardware. |
| Binary transfer | Pending confirmation in this initial text handoff. Do not claim a local scratch asset is available from GitHub until its remote blob has been verified. |
| [article.json](article.json) | Proposed reusable input, revision v2. It carries the reviewed meaning forward and adds a native document title. It has not yet been built or judged through the proposed repository renderer. |
| [source-ledger.json](source-ledger.json) | Thirteen claim/scope entries, exact OEM edition and source fingerprint. Distinguishes OEM support from editorial reasoning. |
| [provenance.json](provenance.json) | Reference identity, image provenance and repeatability limits. |
| [hero-prompt.md](hero-prompt.md) | Reusable design brief reconstructed from the approved image and recorded requirements. It is not represented as a verbatim original tool invocation. |

Do not replace the approved PDF with the v2 build or assume approval transfers to changed text/layout. Keep the reference immutable; write candidate exports to a separate output directory. A candidate must pass its own actual technical and visual reviews.

## Source

Rockwell Automation, *PowerFlex 520-Series Adjustable Frequency AC Drive User Manual*, **520-UM001O-EN-E, September 2025**. [Official manual](https://literature.rockwellautomation.com/idc/groups/literature/documents/um/520-um001_-en-e.pdf). Reviewed source SHA-256: `b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6`.

Relevant printed/PDF pages: 13, 78–79, 134, 145, 159–161; the reviewed page numbers align. The rolling OEM URL may serve a later edition. Confirm its bytes and applicability rather than silently substituting a changed manual. The OEM PDF is not redistributed in this repository.

## What the sample establishes

It demonstrates an approved editorial direction and a sourced explanation of recorded F004/F005 evidence. It does not establish the cause on a reader's machine, verify a repair, authorize a restart, prove a MIRA answer or demonstrate marketing demand. Those outcomes require their own evidence in later phases.
