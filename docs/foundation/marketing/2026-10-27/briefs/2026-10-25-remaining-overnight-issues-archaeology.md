# Remaining Oct 24 overnight issues: archaeology (T-012)
Main tip: `a41710da1a05ef3a9b7ab22d312e78d76ef2ed25` (2026-10-24 23:46 ET, #4747). Read-only. All 8 issues are **OPEN**. None has a fixing commit on main, a matching remote branch, or a PR. I ran PR searches by number; they returned only unrelated hits (#3975, #4120). Nothing here was reproduced live.
Lane note: everything under `packages/factorylm-ui/` and the /v3 adapter (`mira-hub/src/factorylm-ui/*`) is in the held shared-UI lane (#3626, Foreman F004 M2, draft #4303).

## #4683 Attach sheet: disabled Camera and Scan look enabled
- **Code:** `packages/factorylm-ui/src/AttachmentMenu.tsx:36-53` sets `disabled={!native||busy}`, and the reason is only a `title` tooltip, which phones never show. The only disabled styling is `conversation.css:235` `.fl-attachment-menu__item:disabled{color:var(--fl-workspace-off-ink)}`: no opacity, no caption, and the icon keeps its color. Whether `off-ink` really looks like the enabled color on staging is UNVERIFIED.
- **Prior attempts:** none. Related: #4631 (wording on the same sheet).
- **Tests:** `packages/factorylm-ui/src/__tests__/public-surface.test.tsx:113` checks that the labels exist; nothing checks the disabled state.
- **Verdict: FINISH, S.** Smallest fix: render a visible caption ("Needs the phone app") when `!native`, add `opacity:.5` and `cursor:not-allowed`, or hide the rows when `!native`. Add one test.
- **Board:** #4372 (readiness).

## #4684 Citation viewer is blank for 5-10 s with no loading text
- **Code:** `packages/factorylm-ui/src/SourceViewer.tsx:38` is a bare `<iframe className="fl-source-viewer__frame" src={href}>` with no onLoad and no placeholder. The href is built at `mira-hub/src/factorylm-ui/to-interaction.ts:179` (`#page=N`, using the browser's native PDF viewer). The CSS is `conversation.css:222`.
- **Prior attempts:** none. Related: #4668, #4431. The snippet CONNECT from the 10-21 brief (`EvidenceCitation.quote` → `SourceReference.snippet` → SourceViewer) is the natural first paint and is still not on main.
- **Tests:** `packages/factorylm-ui/src/__tests__/media-previews.test.tsx:106-117` (href only).
- **Verdict: CONNECT, S-M.** Smallest fix: show the locator ("Loading page N…") plus the cited quote above or behind the iframe, and hide it on `onLoad`. A pre-rendered page image would be BUILD and L; it's out of scope.
- **Board:** #4372.

## #4685 Citation PDF opens at 39% with thumbnails; landscape frame is 225px
- **Code:**
  - The zoom and thumbnails come from the native viewer's defaults. The href has only `#page=N` (`to-interaction.ts:179`), with no `zoom=page-width&pagemode=none`, which Chrome's viewer honors (UNVERIFIED for the other browsers).
  - Landscape: `.fl-source-viewer` (`conversation.css:214`) has `overflow:auto` and the frame has `min-block-size:60vh` (`:222`). At 390px tall that's about 234px inside a scrolling panel, which matches the nested-scroll complaint.
- **Prior attempts:** none. Related: #4668, #4431.
- **Tests:** `mira-hub/src/factorylm-ui/media-links.test.ts:21-42` pins the exact `#page=47` href, so it would need updating.
- **Verdict: FINISH, S.** Smallest fix:
  - Append `&zoom=page-width&pagemode=none` in `citationHref`.
  - Make `.fl-source-viewer--document` `overflow:hidden` with the frame `flex:1` (no min-vh), so the frame fills the sheet.
  - Update the two link tests.
  - Ship together with #4684 (same files).
- **Board:** #4372.

## #4686 Uploaded manual cited under a different file name
- **Code:** `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts:412` uses `sourceTitle: citationTitle(c)`, and `mira-hub/src/capabilities/citation-title.ts:13-15` returns the chunk's `title`. The header comment says an upload carries its filename as `title`. Likely mechanism (**UNVERIFIED**): the upload deduplicated by content to an existing library document, `2080-um001.pdf`, so retrieval returns the canonical document's chunks and title, not the user's attachment name. To confirm, look up the uploaded file's doc row and check whether the cited `docId` equals the new upload or a pre-existing library doc. The ingest dedup path wasn't traced this round.
- **Prior attempts:** none for this. Related: Golden Walk title fix (2026-10-04, in the citation-title.ts header).
- **Tests:** `mira-hub/src/capabilities/__tests__/citation-title.test.ts`.
- **Verdict: CONNECT, M.** Smallest fix: when the cited doc is attached to this notebook, prefer the notebook-attachment filename, or the PDF's metadata title, over the canonical chunk title. That's a lookup at citation build time.
- **Board:** #4732 (round trip; the uploaded-manual evidence must be recognizable when you close with evidence). It's also a readiness polish item.

## #4687 Answers don't stream (one dot for 5-30 s, then the whole answer)
- **Code:** this is by design.
  - `route.ts:3687-3691`: "with the gate on, candidate deltas accumulate in responseBuffer and are NOT enqueued — the full answer is validated first".
  - `answerGateEnabled()` at `route.ts:273-277` defaults to ON (`NOTEBOOK_ANSWER_GATE=0` is the rollback lever).
  - The release replays the text in fake ~120-char chunks through `chunkForRelease` (`mira-hub/src/capabilities/answer-validation.ts:1423`), used at `route.ts:4767`.
  - The gate is the safety validator (PR #3975, energized-procedure enforcement), so turning it off is **not** acceptable without Mike.
- **Prior attempts:** #4068 (live streaming in gate-off mode). No status-frame work found: there are no `status:"searching"`-style frames. The client shows "working" until the first content frame.
- **Tests:** the answer-validation tests and the chat-flight-recorder wire tests cover withheld content.
- **Verdict: BUILD, M.** Smallest fix: emit progress `status` frames ("Searching the manual…", "Writing answer…", "Checking safety…") during retrieval, generation and validation, without releasing content early. Also render them in the shell's working state (#3626 lane). Real token streaming conflicts with the safety gate and needs Mike's call.
- **Board:** #4372. It also drives the double-tap problem; see #4695 and the silent-fail FINISH.

## #4689 Citation markers are big blue squares; "4 1" reads like page 41
- **Code:**
  - The legacy Hub chip is `mira-hub/src/components/equipment/notebook-markdown.tsx:123-136`: `min-h-[24px] min-w-[24px] rounded-full mx-0.5 text-xs`, with the "≥24px, PRD §26" comment, inserted by `remarkCitationChips` (`:33`).
  - /v3 renders citations through the shared-UI parts (`packages/factorylm-ui/src/parts.tsx`, `conversation.css:93+`). Which component /v3 actually used in the screenshots is UNVERIFIED.
- **Prior attempts:** #4667 (numbering vs source list; open, still reproduces), #4563, and the 10-20 archaeology #7 REPAIR (`notebook-markdown.tsx:122-134`) / #8 FINISH (draft #4476, no renumbering).
- **Tests:** notebook-markdown tests (UNVERIFIED by name).
- **Verdict: FINISH, S-M.** This joins the existing #7+#8 grouping (draft #4476). Smallest fix:
  - Superscript `[n]` styling with a visible hit area via padding, not a box.
  - Joiner spacing between adjacent markers.
  - `white-space:nowrap` on the marker plus the following punctuation.
  - Renumbering comes from #4476.
  - There's tension with the PRD's 24px touch-target rule; keep the hit target and shrink the visual.
- **Board:** #4372.

## #4691 Phone landscape: permanent sidebar leaves about 3 lines of answer
- **Code:** `packages/factorylm-ui/src/shell.css:4` uses `grid-template-columns:minmax(14rem,18rem) minmax(0,1fr) auto`. The only collapse is `@media (max-width:48rem)` at `:131-135`. 844px is wider than 768px, so landscape keeps the sidebar. There's no height query.
- **Prior attempts:** none. Related: the 10-20 #3/#6 REPAIRs (shell.css:83/86, hub-host.tsx:227-270) wait on #4303.
- **Tests:** none for breakpoints.
- **Verdict: FINISH, S.** Smallest fix: widen the collapse query to `(max-width:56rem),(max-height:30rem)` (or ~900px / 450px) so the drawer is used, and slim the header and composer padding under the height query.
- **Board:** #4372. It's in the #3626 lane, so it's blocked until #4303 lands.

## #4692 Desktop: narrow answer column, 9-10px captions, no sidebar collapse
- **Code:**
  - Assistant text is capped at `max-inline-size:75ch` (`conversation.css:306`). At the Hub's 14px root and 13px body that comes to roughly 450-500px, which matches the report.
  - The phone type scale (16/14/13px) applies only under `max-width:48rem` (`shell.css:135`, #4613/#4614), so desktop keeps the smaller base tokens.
  - The sidebar is fixed (`shell.css:4`) with no toggle.
- **Prior attempts:** #4629 (phone font sizes), #4499, #4613/#4614 (phone-only scale).
- **Tests:** none.
- **Verdict: FINISH (type and column) + BUILD (collapse toggle), M.**
  - Smallest fix: desktop tokens `fs-body:15px` and `fs-xs`/captions ≥12px, and the column at `min(760px,100%)` instead of 75ch.
  - The collapse toggle and collapsible projects are new UI.
- **Board:** #4372. It's in the #3626 lane.

## Branch `fix/v3-list-loading-state`
- **Not on the remote.** `git ls-remote origin 'refs/heads/fix/v3-list-loading-state*'` returned nothing after a fetch. A GitHub PR search for `head:fix/v3-list-loading-state` returned 0 PRs, and no fork was found. No last pusher, author or date is available: UNVERIFIED.
- **Source:** the watcher comment on #4688 (2026-10-24 08:34Z, 4:34 AM ET). It says the notebook-loading adapter fix is held behind a `fix/v3-list-loading-state` claim (#3626), with regression tests kept locally on CHARLIE. It's most likely a local worktree on CHARLIE that was never pushed (UNVERIFIED).
- **Overlap:** by name and claim scope, it targets #4682: loading treated as empty at `hub-host.tsx:326-327`, with the empty states at `ProjectTree.tsx:121` and `Sidebar.tsx:174`. The watcher ties it to #4688's loading adapter as well. Without the branch, the actual diff can't be confirmed. Foreman should ask CHARLIE's owner to push it or release the claim.
