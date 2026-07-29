# Phase 2: Asset Identity & Manual Applicability (nameplate intake + evidence routing)

> **Context:** Phase 1 (PR #2560) fixed nameplate → pack *routing* (GS10 now matches catalog
> prefixes GS11N/GS13N). Phase 2 makes a nameplate photo an **asset intake event first, answer
> routing second** — preserve raw OCR + structured fields, define an Asset Identity Packet,
> and join manual applicability deterministically without weakening the no-guess resolver.
> **Issue:** #2561.

## What & Why

A technician sends a **nameplate photo** (the real hardware label) to Telegram. Phase 1 extracts the
identity and routes to an approved pack fast. Phase 2 **captures the raw evidence** separately from
the resolved pack, building an **Asset Identity Packet** that can later feed Hub reviewer decisions,
evidence audits, and cross-checks against manuals.

**Why separate intake from routing?** Because a nameplate is an *artifact* (evidence the asset
exists, with certified fields), not just a query-resolver input. A single photo now carries: OCR
text, structured identity fields, manufacturer applicability (which manuals cover this model?),
candidate pack matches (with confidence), and approval status — flowing later to Hub for human
review.

## Architecture

Two truth sources meet in the middle:

```
Manual PDF                                    Nameplate Photo
  ↓                                                 ↓
Applicability extractor              Vision extractor (nameplate_ocr)
  ↓                                                 ↓
Applicable models + pages            Structured fields (manufacturer, model, serial, …)
  ↓                                                 ↓
Manual Applicability Artifact        Asset Identity Packet
  ↓                                                 ↓
Catalog crosswalk / match rules      Nameplate resolver
  ↓                                                 ↓
  └─────────────────────┬────────────────────────┘
                        ↓
              Cited service-pack answer
```

- **Left lane (manual):** PDF → applicability (which models does this document cover?) → the manual
  registry (`sources.json`) → reshaped into a `ManualApplicability` artifact.
- **Right lane (nameplate):** Photo → `NameplateWorker.extract` (now with raw OCR preserved) →
  `build_asset_identity` → structured `AssetIdentityPacket` → `resolve_service_pack`.
- **Join (target state):** the resolved pack's declared applicability should confirm it **documents
  this nameplate's model/prefix**. Today the **parity guard** enforces this at the data layer
  (`applicable_drive_models` ⊆ the pack's match surface). **Runtime applicability lookup inside the
  resolver is NOT built in this phase** — `resolve_service_pack` is unchanged; wiring applicability
  into the live match/confidence decision is future work.

## Asset Identity Packet

Built by `mira-bots/shared/drive_packs/asset_identity.py::build_asset_identity`. Schema:

Real example — the staging-smoke GS10 drive (nameplate reads `MODEL: GS11N-20P2`):

```python
{
  "raw_text": "MODEL: GS11N-20P2  INPUT 1PH 200-240V ...",  # Kept SEPARATE from interpreted fields
  "manufacturer": "AutomationDirect",
  "model_number": "GS11N-20P2",   # exactly as printed
  "sku_prefix": "GS11N",          # derived conservatively (leading catalog token), NEVER fabricated
  "serial_number": "…",
  "input_voltage": "200-240V",
  "current_or_fla": "5.1A",
  "hp": "0.25",
  "frequency": "0-599Hz",
  "certifications": [],
  "confidence_by_field": {"candidate_pack_id": "medium"},
  "candidate_pack_id": "durapulse_gs10",  # from resolve_service_pack; None if no match
  "candidate_asset_id": None,             # filled by Hub on review (Phase 3)
  "approval_status": "unreviewed"         # a packet is a proposal, never auto-approved
  # ...all other fields default to None / [] when the nameplate doesn't carry them
}
```

**Key discipline:** `raw_text` is kept **separate** from interpreted fields so an OCR error can't be
laundered into "fact." `sku_prefix` is derived only from the leading catalog token of `model_number`
(`GS11N-20P2` → `GS11N`); if the token doesn't look like a catalog prefix it stays `None` — never
invented. Fields the nameplate doesn't carry stay `None`; `certifications` defaults to `[]`.

## Manual Applicability Artifact

Built by `tools/drive-pack-extract/registry/applicability.py::ManualApplicability`. Describes
which models a manual covers:

```python
{
  "applies_to_models": ["GS10-20P2C", "GS10-20P5C"],  # Exact model strings from manual
  "applies_to_catalog_prefixes": ["GS10", "GS11N", "GS13N"],  # Model families documented
  "excluded_models": [],  # Explicitly NOT covered (e.g. industrial vs. commercial variant)
  "evidence_pages": {10, 15, 203},  # Manual page numbers documenting this model
  "confidence": "high",  # high / medium / low, from extraction metadata
  "source_publication": "PowerFlex_525_20F-ProgrammingGuide_v1.2"
}
```

Reshapes `sources.json` entry (from the manual-registry) into structured applicability that the
nameplate resolver can query: "Does manual X cover model Y?"

**Parity guard:** `mira-bots/tests/test_manual_applicability_parity.py` proves applicability survives
source → pack: every `applicable_drive_models` entry for a live pack must appear in that pack's
`family.aliases`/`nameplate.match_keywords` (verified for both `durapulse_gs10` and
`powerflex_525`). This is a data-layer invariant, not a runtime resolver change.

## Trust Rules (must not regress)

- **No-guess resolver never weakened.** Manufacturer-only / ratings-only / ambiguous evidence → refuses.
- **Serial identifies an asset, never selects a pack.** A serial number narrows an existing match,
  never makes one.
- **Catalog-backed aliases only.** GS12N/GS14N were excluded from the official GS10 spec (Phase 1
  precedent) — no fabrication of untested SKU variants.
- **Applicability carries evidence + confidence.** Manual says it covers models X, Y, Z
  (with pages cited); nameplate matches Y → high confidence answer. Nameplate matches Z but Z is
  excluded → refuse.
- **Asset Identity Packet tracks confidence per field.** Vision output for `model_number` is
  "high", for `serial_number` is "medium" — grounds downstream decisions.

## Deferred to Phase 3: Hub Asset-Candidate Review Record

**Design only; not built yet.**

Nameplate intake (this phase) produces an Asset Identity Packet with `approval_status =
"unreviewed"`. Phase 3 flows this candidate to Hub as a reviewable record (akin to
`ai_suggestions`), carrying:

- Raw OCR image + text
- Structured fields (manufacturer, model, serial, …)
- Confidence scores per field
- Proposed pack (from resolver)
- Manual applicability evidence (pages cited)
- Approval status toggle (unreviewed → reviewed → approved)

A Hub reviewer clicks "approve" on a GS10 nameplate photo → the packet moves to `approval_status =
"approved"`, the asset_id is populated, and future Telegram photos of the same serial/model flow
through the approved asset's context instead of re-asking for approval.

## Cross-references

- **Issue** #2561 (this phase)
- **PR** #2560 (nameplate routing phase 1)
- `mira-bots/shared/drive_packs/asset_identity.py` — Asset Identity Packet builder
- `tools/drive-pack-extract/registry/applicability.py` — ManualApplicability reshaper
- `mira-bots/shared/drive_packs/resolver.py` — pack resolver (UNCHANGED this phase; runtime
  applicability lookup is future work)
- `mira-bots/shared/workers/nameplate_worker.py` — `extract()` now preserves `raw_text`
- `mira-bots/tests/test_manual_applicability_parity.py` — the source→pack parity guard
- `mira-bots/telegram/bot.py` — `_try_nameplate_drive_pack_reply()` (Phase 1 fast path)
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` — product decision
- `docs/drive-commander/telegram-manual-intelligence.md` — Phase 1 workflow
- `.claude/rules/train-before-deploy.md` — why engine is a reasoner, not a state bag
