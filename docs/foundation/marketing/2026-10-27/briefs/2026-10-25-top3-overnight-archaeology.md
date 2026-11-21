# Top-3 overnight issues: archaeology (#4682, #4688, #4690)
Read-only. Mikecranesync/MIRA main tip **a41710da1a05ef3a9b7ab22d312e78d76ef2ed25** (Sat Oct 24 2026, 11:46 PM ET). Code reading only; nothing was reproduced live.

## #4682: reload or thread switch flashes "No projects" and the "nothing cited" splash for 1–5 s
**Verdict: CONNECT · Effort: S–M · Board: readiness #4372** (pilot trust and /v3 polish; not a round-trip step)
- **Code paths (main):**
  - `mira-hub/src/factorylm-ui/hub-host.tsx:198-227`: `loadNotebooks` fetches `/api/equipment-notebooks/`; `notebooks` stays `null` until it returns.
  - `hub-host.tsx:326-327`: `notebookProjects(notebooks ?? [])` turns *loading* (`null`) into *empty* (`[]`).
  - `packages/factorylm-ui/src/ProjectTree.tsx:121` ("No projects in this workspace.") and `packages/factorylm-ui/src/Sidebar.tsx:174` ("No conversations yet.") have no loading state. grep found no loading or skeleton handling in either file.
  - `hub-host.tsx:929` calls `groundingLineFor(detail?.notebook ?? null, …)`, and `hub-host-logic.ts:336-337` returns the "General question … nothing cited" splash whenever `detail` hasn't loaded yet, even if a notebook is selected.
- **What already exists:** the loading/empty distinction is already modeled. `homeSendPlan(null)` returns `{kind:"loading"}` (`hub-host-logic.ts:129`; test `hub-host-logic.test.ts:408`), `NO_PROJECT_ERROR` ("Still loading your projects…") is at `hub-host-logic.ts:344`, and `loadingThread()` is at `hub-host-logic.ts:248`. It just isn't passed through to the sidebar or the splash.
- **Prior attempts:**
  - Draft PR #4479, "wait for notebook sources before showing 0 of 0" (#4371), is the same pattern for the sources count.
  - The #4688 watcher comment (2026-10-24) says a claim on the `fix/v3-list-loading-state` branch under #3626 covers the notebook-loading adapter. **UNVERIFIED:** that branch isn't on the remote (checked with `git ls-remote`), and there's no PR for it.
  - Draft PR #4610 (sidebar threads in one query) would shorten the flash but not remove it.
  - No closed PR targets this issue.
- **Tests:** none for the empty-vs-loading sidebar or the splash. `hub-host-logic.test.ts` covers only `homeSendPlan` loading.
- **Smallest fix:**
  1. Keep `null` as the loading value through to the shell: add a `loading` prop to ProjectTree and Sidebar that shows a skeleton or "Loading projects…".
  2. In `groundingLineFor`, return `undefined` or "Loading project…" when there's a selection but `detail` is still null.
  3. Add a test for each.
- **Lane note:** ProjectTree.tsx, Sidebar.tsx and hub-host* are in the #3626 shared-UI lane (draft #4303, F004 M2), so Foreman needs to clear ownership first.

## #4688: a bad or deleted project link silently drops you into uncited general mode
**Verdict: CONNECT · Effort: S · Board: readiness #4372** (C02 class: uncited answers that aren't labeled)
- **Code paths (main):**
  - `hub-host-logic.ts:158-172`, `selectionFromSearch`: `if (!nb) return null;` makes an unknown `?notebook=` look the same as having no link.
  - `hub-host.tsx:211`: `selectionFromSearch(...) ?? landingSelection(data.notebooks)` silently falls back to HOME or the landing project and keeps the bad id in the URL.
  - Sending from there goes `hub-host.tsx:576` `sendFromHome` → `homeSendPlan` (`hub-host-logic.ts:129`), which picks or creates "General" and answers uncited.
- **Prior attempts:**
  - The watcher comment on #4688 (2026-10-24 08:34Z, 4:34 AM ET) reproduced it at `db5e4909` with offline callback tests: 2 regression cases fail and 4 controls pass. The tests are kept on CHARLIE and aren't on main or any remote branch. The implementation was held behind the same `fix/v3-list-loading-state` claim (#3626).
  - Owner decision M4 on #4372 drops the "not found" page from `/equipment/[id]` (PR #4361), so it can't be reused here.
  - #3926 (closed, merged) introduced `?notebook=&thread=` deep links with no not-found branch.
- **Tests:** `hub-host-logic.test.ts` has deep-link cases but none for an unknown notebook. The watcher's repro tests are off-repo (**UNVERIFIED**).
- **Smallest fix:**
  1. Make `selectionFromSearch` return a distinct result such as `{missing:true}` when the URL names a notebook that isn't in the list.
  2. In `loadNotebooks`, show a "This project doesn't exist or you don't have access" state with a link back to the project list, call `writeSearch("")`, and block `sendFromHome` while that state is showing.
  3. Bring in the watcher's two regression cases as tests.
- **Lane note:** same #3626 lane and claim gate as #4682. These two issues should ship as one PR.

## #4690: the safety line runs straight into the answer
**Verdict: REUSE (already fixed; nothing to do) · Effort: none · Board: neither** (closed)
- **Fixed on main by a41710da** (PR #4747, which is the main tip):
  - `splitLeadingSafetyNotes` at `hub-host-logic.ts:197`
  - `mira-hub/src/factorylm-ui/answer-with-safety.tsx` (new)
  - a small change in `hub-host.tsx`
  - `packages/factorylm-ui/src/conversation.css` (+3)
- **Tests:** `mira-hub/src/factorylm-ui/hub-host-safety-notes.test.tsx` (87 lines).
- **Status:** the issue was closed on 2026-10-25 at 03:46Z (Oct 24, 11:46 PM ET). Mike's closing comment says it was verified live on production `a41710da1` (v3.419.5) at 390×844 with three banner types. The change is display-only, and the safety logic is unchanged.
- **Related:** #4565 (warning content) and #4067 are separate. The phone overflow is still open in draft #4677.

## Placement summary
- None of the three belongs on the round-trip tracker #4732. Its scope is project → work order → close with evidence.
- #4682 and #4688 belong on readiness board #4372 as trust items: #4688 under C02 (uncited answers that aren't labeled), and #4682 under the /v3 polish rows.
