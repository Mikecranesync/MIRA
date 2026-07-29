# MIRA Print Pack — Grading Rubric

This is the published grading standard every Print Pack is scored against before it ships. It's the
customer-facing version of the same 100-point rubric used internally to grade the CV-101 reference
pack — same categories, same hard-fail conditions, same bar to clear. Nothing here is softened;
this document is just aimed at the person receiving the pack rather than the person building it.

Before any of this, a pack has to pass its own automated structural checks — orphan wires,
duplicate ids, missing citations, dangling cross-references between sheets, and more — machine-
enforced, before a human reviewer ever sees it. A pack that fails that gate never reaches grading.

## The 100-point scale

Every drafted sheet is scored independently by all four reviewer roles (below), across the 12
categories below, for a possible 100 points. A pack's score is its **lowest** sheet score across
all four reviewers — one weak sheet is enough to hold the whole pack back; strong sheets don't
average it out.

| # | Category | Points | What it checks |
|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | Every drawn element traces to the model; every "verified" claim has a citation you can actually reach from the sheet; no unacknowledged conflict with the manual, the PLC program, or a prior drawing. |
| 2 | Technician troubleshooting readability | 12 | Can a technician meter-lead-walk the sheet's main circuit without ambiguity? Does the sheet orient in three seconds — title, scope, what and where? |
| 3 | Maintenance-engineer approvability | 8 | Could a plant engineer sign off on this without a verbal explanation — scope note, revision, date, pointers to the open items that affect it? |
| 4 | Standard symbols & reference designations | 8 | Symbols match standard industrial drafting practice; device tags are used consistently; nothing standard is drawn as an ad-hoc shape. |
| 5 | Wire & terminal identification | 10 | Every conductor is numbered and legible; both endpoints carry real terminal ids that match the model; the numbering scheme is consistent from sheet to sheet. |
| 6 | Power / control / grounding / safety separation | 8 | One circuit family per sheet; protective earth is visually distinct; safety-relevant paths are distinguishable from ordinary status/indication wiring. |
| 7 | PLC I/O presentation | 8 | Consistent presentation between the inputs sheet and the outputs sheet; commons and banks are explicit; spare points are marked with the open item that covers them. |
| 8 | VFD power & control presentation | 8 | Conventional line/load orientation; drive terminals shown exactly as the OEM manual names them; auxiliary terminals shown with their actual state — jumpered or open, not assumed. |
| 9 | Cross-references & continuation markers | 6 | Every off-sheet reference names its destination sheet; anything split across two sheets cross-references both directions; nothing dangles. |
| 10 | Title block, revision, notes, print-scale readability | 7 | A complete title block, legible at full size, with nothing drawn outside the sheet border. |
| 11 | Model-to-render consistency | 5 | What's drawn matches what's actually in the source data — spot-checked against the model, not assumed from how the drawing looks. |
| 12 | Absence of unsupported assumptions | 5 | Every unknown is marked FIELD VERIFY; every unconfirmed id is labeled as such; nothing reads with more confidence than the evidence behind it supports. |

## The four reviewer roles

Every pack is graded by four independent reviewers. Each reads the whole package, but brings a
different lens:

- **Industrial maintenance technician** — can this be worked at 2 a.m. with a print and a meter?
  Deep-dives readability, wire/terminal identification, PLC I/O, and cross-references.
- **Controls engineer** — does the drawing actually match the program, the drive configuration, and
  the physics? Deep-dives electrical truth, PLC I/O, drive presentation, cross-references, and
  model-to-render consistency.
- **Electrical-drafting-standards reviewer** — does this follow real drafting practice? Deep-dives
  symbol correctness, wire/terminal identification, circuit separation, and title-block discipline.
- **Evidence auditor** — is every claim actually backed by what it cites, and does the drawing ever
  say more than the underlying data knows? Deep-dives electrical truth, model-to-render consistency,
  unsupported assumptions, and all six hard-fail conditions below.

**The evidence auditor's role is mandatory, and it is not redundant with the other three.** On the
CV-101 reference pack, the auditor's first-pass score came in well below the other three reviewers
on exactly the sheets where something was wrong underneath a sheet that otherwise read fine: a
citation pointing at an evidence file that predated the fact it was supposedly backing, and a
safety-relevant note that existed only in the drawing's rendering code and not in the underlying
data model. A technician, a controls engineer, and a drafting reviewer can all be satisfied with how
a sheet reads and still miss a broken citation chain or a fact that was never actually in the source
data — from the outside, a wrong citation looks identical to a right one, and a render-only fact
looks exactly like a modeled one. That's precisely the gap the fourth, adversarial role exists to
close. Both issues were found, fixed, and independently re-checked before the pack shipped (see the
worked example below).

## Hard-fail conditions

Six conditions are zero-tolerance. Any one of them fails the pack regardless of its point score:

1. **Invented content** — a terminal, wire, device, contact, protection device, voltage, conductor
   size, color, or safety function that's drawn or stated with no backing in the model or a cited
   source.
2. **A solid wire without cited evidence** — any conductor rendered as confirmed, in the actual PDF
   and image output (not just the source file), whose underlying status isn't genuinely verified
   with two known endpoints and a recorded source.
3. **An ambiguous protective-earth or safety connection** — a ground connection that could be
   misread, or a safety function implied but never explicitly stated.
4. **An unacknowledged internal contradiction** — a conflict between the model, the PLC logic, the
   OEM manual, a prior drawing, and the rendered sheet that the sheet doesn't call out. A documented
   correction — with a note explaining what changed and why — is not a contradiction; that's required
   honesty, not a defect.
5. **Clipped or unreadable content** — anything outside the sheet border, text struck by a line, or
   a table row cut off.
6. **Render-only engineering information** — a fact that appears only in the drawing's layout code,
   with nothing backing it in the underlying model. The layout step is only ever allowed to lay a
   fact out — never to originate one.

## The 90-point bar and the tier mapping

Every reviewer has to score every sheet at least 90 out of 100 for a pack to ship at all. Below
that — or a single hard-fail anywhere in the package — and the pack isn't sellable, full stop.

| Tier | Requirement | What closes it |
|---|---|---|
| **NOT APPROVABLE** | Any hard-fail present, or any reviewer scored a sheet below 90. | Nothing — the pack doesn't ship. |
| **APPROVABLE WITH FIELD VERIFICATION** | No hard-fails; every reviewer ≥90 on every sheet; every remaining unknown is explicit, docketed in the open-items register, and pointed to from the sheet it affects. | The review panel's verdict, dated and recorded. This is the standard, sellable pack — a real machine reaches this tier on day one, honestly. |
| **APPROVABLE** | The same bar, plus zero remaining field-verify items that would block safe energization. | Each of those items closed with a citation that actually resolves, plus a named technician's field sign-off after their own review. |

A pack is never labeled at a tier higher than what it actually achieved. **"APPROVABLE WITH FIELD
VERIFICATION" is not a placeholder waiting to become "APPROVABLE"** — it's its own sellable result,
and it is never presented as an as-built.

## Worked example: the CV-101 reference pack

The reference implementation for this rubric is CV-101 (a garage conveyor), a real 9-sheet package
graded by all four reviewer roles, independently, against every category above.

Final scores ranged 92–100 across all 9 sheets and all 4 reviewer roles — every sheet cleared the
90-point bar with every reviewer. Two issues surfaced during grading, both caught by the evidence
auditor: a citation on one sheet pointed at an evidence file that predated the fact it was supposedly
confirming, and one safety-related note existed only in the drawing's rendering code rather than in
the underlying model. Both were fixed and independently re-checked before delivery — the re-check
confirmed the fix in both cases — and a standing automated check was added afterward so the
render-only-fact class of issue can't ship again unnoticed.

**Final verdict: APPROVABLE WITH FIELD VERIFICATION, unanimous.** 37 of the 40 modeled conductors and
34 of the 96 modeled terminals remain FIELD VERIFY, each sitting in the open-items register
as a specific, doable task. The pack is honest about exactly what it doesn't yet know — that honesty
is what earned the tier, not a gap that got quietly waved through.
