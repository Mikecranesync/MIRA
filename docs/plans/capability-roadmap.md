# MIRA capability roadmap

Plan revision: 1 — 2026-11-18. Current step: **Find the Right Equipment**.
Direction: Mike's capability-by-capability delivery request. This plan adds a
sequence and acceptance scope; it grants no new release, review or spending authority.

A step adds something a technician can do. Existing code is reused and connected;
its presence does not mean the capability has been accepted. Start with the drive
and Q1/MLC, prove each increment, then expand across machines and lines.

## Capability sequence

| Step | Name | New technician capability | Proof before moving on |
|---|---|---|---|
| **1 — current** | **Find the Right Equipment** | Find a machine or component, distinguish repeated names by location, and deliberately select the correct question target. | The [Step 1 acceptance plan](find-the-right-equipment.md) passes on the connected Hub and physical tablet, with independent acceptance and Mike's recorded decision. |
| 2 | Open Its Workbench | Open that equipment's applicable documents, cited assistance, history and work records in one place. | Drive, then MLC: an original question uses the correct model's approved source; its actual page opens; wrong-model and wrong-equipment evidence is refused. Record any source limitations explicitly. |
| 3 | Record and Resume Work | Save a job, note and photo against that equipment and resume later. | Supported sign-in, save, lost connection, restart and another device recover the same records and attachments. A second authorized technician reopens the work without borrowing another tenant's data. |
| 4 | Remember Approved Knowledge | Reuse approved findings and corrections with their sources and history. | A new conversation recalls an approved fact; rejected, superseded and foreign facts do not appear. Exercise the application workflow that approves and retires facts, not only a helper in a test. |
| 5 | Connect Installed Equipment | Link a physical installed instance and functional position to its correct notebook and model documents. | Explicitly verified links resolve; missing, stale, corrected and foreign links fail safely. Replacement equipment gets a distinct identity while the position and prior maintenance history remain traceable. |
| 6 | See Live Equipment Context | Read the selected equipment's PLC/UNS observations alongside its work. | Source tag, equipment identity, value, unit, timestamp and quality remain attributable. Stale or unread data is unknown; a command never counts as feedback. Read-only pilot. |
| 7 | Understand the Whole Machine | Use component relationships, drawings, approved knowledge and live observations together. | A known machine fault is traced through the correct relationships with evidence; unrelated components and unsupported causal claims are excluded. |
| 8 | Repeat Across the Factory | Onboard more machines and lines without rebuilding the workflow. | A representative technician onboards unfamiliar equipment using the same process. Permissions, scale, recovery and shared UNS consumption are proven with the intended downstream systems. |

Steps 2–8 are planning outlines, not accepted specifications or authorization to
start seven workstreams. Some underlying capabilities already exist. At each step,
inventory that evidence first and build only the missing connection or protection.
Preparatory research and already-authorized defect repairs can continue in parallel;
the active product milestone remains Step 1 until its gate passes.

## Architecture to keep throughout

- Extend the shared FactoryLM shell and bounded Hub adapters. Keep the existing
  identity, authorization, chat, evidence and persistence services authoritative.
  Follow the [UI cutover charter](../architecture/convergence/UNIFIED_UI_CUTOVER.md).
- Design for site → area/line → machine → component where those relationships are
  recorded. Do not force every factory into an invented hierarchy or invent missing
  locations. Use bounded child queries, search and pagination instead of loading
  every factory component into a picker.
- Keep immutable identity, functional designation, display label, catalog number,
  PLC symbol and UNS path separate. `Q1`, `MLC`, and `CA3KN22BD` express different
  facts. A matching label or model never establishes an installed-instance link.
  Preserve PLC-native symbols exactly; do not silently rename them to UI labels.
- AI may propose identity or evidence interpretation. The stored, approved identity
  and deterministic authorization/applicability checks control access and selection.
- Apply the [FactoryLM UI style](../design/factorylm-style.md): quiet surfaces,
  state colors with meaning, visible selection and plain action labels. Follow the
  [brand voice](../factorylm-style-guide.md#voice--tone): technical and honest.
  Do not add confidence language, decorative status, or unexplained AI terminology.

The [published UI/UNS research packet](https://github.com/Mikecranesync/MIRA/pull/5559)
is background research, currently a separate draft. It does not prove implementation
or any outside expert's endorsement.

## Development scaffold

Use one small capability plan, the existing implementation PRs and the existing
acceptance ledger. Do not create another framework, task database or capability
registry. The [plan template](capability-step-template.md) supplies the repeatable
contract; [CAPABILITY_CLOSURE.yaml](../architecture/convergence/CAPABILITY_CLOSURE.yaml)
remains the software lifecycle registry.

For every step:

1. **Specify the technician outcome.** Freeze scope, examples, negative controls,
   acceptance IDs, existing owners and the boundary with the next step.
2. **Map what already exists.** Link code, tests and receipts. Mark their exact
   revision and proof level; do not rebuild working pieces or inherit stale verdicts.
3. **Finish one usable path.** Connect the existing interface, API and storage.
   Reproduce defects before repair; use isolated branches and existing claims.
4. **Prove the integrated path.** Required review/CI, real authenticated routes,
   actual database/transport, recovery and tenant negatives on one identified build.
5. **Prove it on the device.** Independent synthetic technician walk, then a human
   acceptance walk. Record failures and assistance, not just screenshots of success.
6. **Close and carry forward.** Coordinator records each acceptance result and Mike's
   decision in [#5232](https://github.com/Mikecranesync/MIRA/issues/5232). Only then
   make the next capability current. Preserve unresolved defects with named owners.

Each implementation PR names the capability, acceptance IDs, reused seams, changed
behavior and evidence. Review, CI, staging, device, human and production remain
separate stages. A staging capability acceptance never lights production readiness
or Mission Control's FIELD-VERIFIED state.

## Shared reporting

[#5314](https://github.com/Mikecranesync/MIRA/pull/5314) is the coordination inbox;
[#5232](https://github.com/Mikecranesync/MIRA/issues/5232) holds acceptance and
owner-managed lane reports. [Mission Control](../runbooks/mission-control.md) reads
those reports. The five sessions acknowledge this plan's commit in their existing
records and include `Current capability: Step 1 — Find the Right Equipment`, their
acceptance IDs, exact build, proof, blocker owner and next action at material changes
and handoff. Use the existing DELIVERY.md enums; prose is not a passing verdict.

CHARLIE Codex owns the combined verdict. The ontology specialist remains a distinct
session; its receipt is linked from the coordinator's summary. The dashboard's four
implementation lane cards must not be mistaken for evidence that only four sessions
exist. A sent message is not an acknowledgment.
