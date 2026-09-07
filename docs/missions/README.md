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
  files and were overwritten by unrelated missions. Do not add new files under `.fleet/`. Missions
  still writing there keep doing so until they close; nothing is relocated.
- A handoff is a mission-specific file, written before context degrades (~70 %, 200 turns, a hard
  blocker or a human gate), and the replacement session resumes from it under the same claim.
