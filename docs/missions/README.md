# docs/missions — one directory per mission

Convention from FLEET-PEER-NETWORK-001 Slice A (`../peer-network/START_HERE.md` §6).

```
docs/missions/<MISSION-ID>/
  MISSION.md    goal, slices, dependencies, human gates, links to the record (issue/PR)
  HANDOFF.md    the current handoff: tests, changed files, HEAD SHA, remaining work, resume command
  CLAIMS.md     optional — the claims this mission documents (e.g. another team's active claims)
```

- `<MISSION-ID>` is the durable mission id (`FLEET-PEER-NETWORK-001`, `FLM-UI-4000-SLICE-D`), one
  per substantial task, matching the canonical issue or draft PR.
- **`.fleet/TASK.md` and `.fleet/HANDOFF.md` are deprecated for new missions** — they are global
  files and were overwritten by unrelated missions. Do not add new files under `.fleet/` — the gate is an exact branch + path policy (`tests/peer_network/test_contract.py::FLEET_ALLOWANCES`): only the grandfathered branches may touch `.fleet/`, each only its own recorded paths; every other branch may not add, modify, delete, rename or copy anything there. Missions
  still writing there keep doing so until they close; nothing is relocated.
- A handoff is a mission-specific file, written before context degrades (~70 %, 200 turns, a hard
  blocker or a human gate), and the replacement session resumes from it under the same claim.

## Shared-file governance — fragments in, one composer out

The rule that makes the `.fleet/` deprecation matter: **no ordinary session writes a shared file
that another mission also writes.** Concurrent missions overwriting one global file
(`.fleet/TASK.md`, `.fleet/HANDOFF.md`) is exactly how handoffs were lost.

- **Ordinary sessions write only their own mission fragments** — files under their own
  `docs/missions/<MISSION-ID>/` directory (the canonical fragment directory), one writer per path,
  named by the mission's claim. A session never edits another mission's directory, and never a
  repo-wide shared operations file.
- **One claimed integrator composes the shared operations file.** When a shared, cross-mission
  document must exist (a combined roster, a merge train, a shared operations manifest), exactly one
  session holds the claim for it and composes it *from* the fragments — the fragments are the source
  of truth, the composed file is derived. That shared file is a resource key like any other
  (`docs/<shared-file>`), so the atomic-claim race (PRD §6 law 2, `../peer-network/schemas/claim.schema.json`)
  guarantees a single writer.
- **Machine hooks may enforce this, but they are not the only documentation.** A pre-commit or CI
  hook that blocks a second writer of a shared file is a welcome backstop, but this written
  convention is the primary contract — a session with no hook installed still discovers the rule
  before editing (PRD §8).
