# Capability step template

Copy this structure for the next step only when its scope is ready. Use ordinary
Markdown and the existing issue/PR records; do not build a parallel tracker.

## Name and technician outcome

- Step/name and roadmap link:
- Plan revision/date; accountable coordinator:
- One sentence: what the technician can now do:
- Current state and accepted environment, if any:
- Explicit boundary with the previous/next capability:

## Reuse and architecture

- Existing UI, API, identity and storage seams; current owners:
- Existing tests and receipts with exact revisions and limitations:
- Missing behavior only; affected canonical capability registry entry:
- Data/identity contract, permissions, unknown/empty/error states:
- Recovery and rollback; configuration/migration implications:
- Existing claims and overlap/handoff checks:

## Acceptance contract

Freeze expected results before executing them. A narrow happy path and its
negative control belong together. Preserve the prior step's accepted behavior.

| ID | Technician action or failure condition | Expected observable result | Proof level / owner | Receipt and result |
|---|---|---|---|---|
| STEP-01 | Main supported path | Concrete outcome | Real integration + device | NOT TESTED |
| STEP-02 | Wrong identity/tenant/stale context | Concrete refusal with work retained | Independent negative control | NOT TESTED |
| STEP-03 | Interruption/restart/recovery | Concrete recovery behavior | Device + persistence | NOT TESTED |
| STEP-04 | Representative human task | Outcome without developer repair | Human acceptance | NOT TESTED |

## Work sequence

1. Reconcile live heads, owners and authority; freeze this contract.
2. Reproduce missing behavior; repair only the owned slice.
3. Required review/CI on the composed candidate; keep exact evidence bindings.
4. Exercise real supported authentication, routes and storage.
5. Authorized deployment, version/flag check and leased physical-device walk.
6. Independent verdict, human acceptance and coordinator closeout.

For each active session: one next deliverable, dependency/owner and useful
independent action while waiting. Preserve existing stop instructions and review
caps. Escalate a concrete missing decision, not a generic request to proceed.

## Evidence and Mission Control

Packet: full SHA/base/body digest; build/image/configuration; data/source revisions;
operator/device/time; synthetic versus human; real versus mocked dependencies;
expected/observed results; screenshots/logs/hashes; cleanup; remaining defects.

Reuse DELIVERY.md's owner-managed #5232 status comments and allowed enums. Add:

```text
Current capability: Step <n> — <name>
Plan revision: <immutable commit link>; acknowledgment: PROPOSED | MERGED
Acceptance rows: <IDs; PASS/FAIL/NOT TESTED with proof links>
Next: <one outcome>; Blocked by / needs: <owner and action, or none>
```

Keep formal direction in #5314 and definitive verdicts in #5232. Update at material
changes, handoff and session end, then read back. List every session's ACK separately
from message delivery. Never overwrite another active owner's record.

Completion requires every mandatory row's compatible evidence, existing release
gates, independent verdict and recorded human acceptance. State exactly which
environment passed; deployment, production and FIELD-VERIFIED remain distinct.
Name the next capability and carry unresolved work forward with owners.
