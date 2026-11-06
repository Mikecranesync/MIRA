# "Can say now" deploy check, 2026-10-25 (read-only)
Source: /workspace/marketing/research/work-order-claims-2026-10-24.md. Fetched with tags.
- **main** = `f1e53e0d` (v3.419.8, #4756).
- **Tags:** v3.419.5 = `a41710da` (#4747); v3.419.6 = `cb7545e4`; v3.419.7 = `6010ad60`; v3.419.8 = `f1e53e0d`. Tag messages say "auto-tagged on merge", so **tags are merge markers, not deploy evidence**.
- **Deploy evidence** (GitHub Actions, both workflows are `workflow_dispatch` with a candidate SHA input):
  - Deploy to Staging VPS: latest success run 40174204235 on `cb7545e4`, 2026-10-25 03:49 ET.
  - Deploy to VPS (prod): latest success run 40174713329 on `cb7545e4`, 03:57 ET; prior run 40159994414 on `a41710da` (v3.419.5) at 23:55 ET Oct 24.
  - So **prod looks like v3.419.6 (`cb7545e4`), one step past Mike's v3.419.5**, and v3.419.7/.8 (docs/tools only) are not deployed.
  - The run's head_sha is used as a proxy for the dispatched SHA input: UNVERIFIED. A live /version or health probe would confirm.
- **Ancestry caveat:** MIRA history was squashed into `4682cf47` (2026-10-15). Every claim's code predates it, so the original PR SHAs are not in main's graph. "On main/staging/prod" is proven by `git merge-base --is-ancestor 4682cf47 <sha>`, which is true for `a41710da` and `cb7545e4`, plus the file existing at that tree. Original PR attributions come from GitHub PR search and are marked where uncertain.

| Claim | PR / commit | On main | On staging (`cb7545e4`) | On prod (`cb7545e4`; v3.419.5 also yes) | Evidence |
|---|---|---|---|---|---|
| Open a project (equipment notebook) for a machine | PR #3189 (Notebook V1), #3371/#3373 (bind/open THE notebook for an asset); code in squash `4682cf47` | Yes | Yes | Yes | `mira-hub/src/app/api/equipment-notebooks/route.ts` present; ancestor check true |
| Attach that machine's manuals to the project | PR #3189 (sources), #3478 (private sources); upload `api/namespace/node/[id]/files/route.ts` in `4682cf47` | Yes | Yes | Yes | ancestor check; **but** #4694 (phone can't list manuals) and finding B (no indexing status; "add the manual" for ~5 min) |
| Ask questions, get answers cited to the attached manuals | PR #3189, #3240 (CIT-07 quotes), #3421 (one-object citations); `4682cf47` | Yes | Yes | Yes | chat `route.ts`; **overstated, see flags** |
| Create a work order on an asset | Original PR UNVERIFIED (pre-squash; candidates #1925-era Hub WO work, #2415 anomaly→WO link); `api/work-orders/route.ts` in `4682cf47` | Yes | Yes | Yes | ancestor check |
| Move a work order to "in progress" | PR #1925 "persist work order Start Work status (#1924)"; `4682cf47` | Yes | Yes | Yes | `api/work-orders/[id]/route.ts` PATCH status |
| Complete a work order with notes | `resolution` field; fix-branch `fix/work-order-get-omits-resolution-2375` (#2375; PR number UNVERIFIED); `4682cf47` | Yes | Yes | Yes | `[id]/route.ts:75-76,147-214` (resolution, closed_at) |

## Flags: false or overstated now
1. **"Answers cited to the attached manuals": overstated.**
   - #4750: some answers show a raw `[3]` with no source under a "not grounded" label.
   - #4749: the phone citation viewer is too small to read the cited page.
   - #4689 and #4667: markers are confusing and numbering is off.
   - Suggested wording: "answers cite the manual pages they used, when the manual covers the question". No "every answer", and no claim that you can read the page in-app on the phone.
2. **"Complete a work order": true only via "completed".**
   - #4731: "closed" errors.
   - The mobile app offers `resolved` as its completion status (`mira-mobile/src/screens/Workorders.tsx:39-42`). Per the T-001 brief this likely hits the same DB status constraint (UNVERIFIED live).
   - Say "complete (web)". Don't say "close", and don't claim phone completion until #4731 is fixed and verified.
3. **"Attach manuals": qualify.**
   - Finding B: no upload or indexing progress, and answers can say "add the manual" for ~5 min after upload.
   - #4694: the phone can't list a project's manuals.
   - Say "attach on the web; ready within a few minutes" until B is fixed.
4. **"Open a project": fine.** #4752 is only a misleading error if you send before the list loads, and #4682 a "No projects" flash. These are polish items, not falsifying. The existing guardrail (#4681 empty chat on tap) stands.
5. #4751 is fixed (PR #4755, `cb7545e4`), and that commit is on staging and prod per the runs above. #4753 (tab title) and #4754 (long answers open at the bottom) don't affect any claim.
6. The sheet's own caveat still holds: no live staging walk has passed (#4732). Deployed ≠ proven.
