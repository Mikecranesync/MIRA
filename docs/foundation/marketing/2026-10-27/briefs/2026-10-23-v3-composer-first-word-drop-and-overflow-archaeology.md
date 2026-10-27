# /v3 composer first-word drop + phone overflow — archaeology (2026-10-23)
Main tip: bc10ab348764027f73cce3eb364aaf7a2327fb89 (#4599, 2026-10-23 17:52 EDT). Read-only. gh CLI unauthenticated → open-PR search UNVERIFIED.

## Q1 Verdict: REAL (likely; repro UNVERIFIED) — draft wiped by render-time hydrate while thread detail loads
Mechanism:
- Composer is controlled: packages/factorylm-ui/src/Composer.tsx:318-319 `value={state.draft}`, onChange dispatches set-draft(currentTarget.value). No autofocus, debounce, or draft restore here; IME guard only on Enter (:22-30,:192).
- The `state` the Composer gets is hub-host `view` (mira-hub/src/factorylm-ui/hub-host.tsx:910), a useMemo projection (:359-390).
- When `!detail || !meta` (thread selected but detail not loaded yet), :361-366 hydrates with `EMPTY_FIXTURE.thread` (hub-host-logic.ts:15), whose id ≠ state.thread.id (= shellThreadId(selection), set by syncThread :182-190).
- The reducer hydrate case (packages/factorylm-interaction/src/reducer.ts:209-224) sees threadChanged and returns `draft: ""` (:224). So the textarea shows "" while the real state.draft keeps updating.
- Each keystroke in that window sends set-draft with the value "" + the new char, so only the last char typed before detail lands survives. Typing "How " → state.draft=" " → then "do I clear…" → send trims (Composer.tsx:147) → "do I clear a fault on the Micro810?". This matches the screenshot exactly: one whole word plus its space lost.
- When the window opens: detail is null after select() (hub-host.tsx:265 setDetail(null)) and on first load/deep link until loadDetail resolves (:229-252). A refresh after a send keeps the old detail, so a gap needs a thread open or reload right before typing. The screenshot URL has notebook+thread params, so a reload or thread open just before typing fits.
- Origin: lines :360-366 are unchanged since baseline 4682cf47 (2026-10-15). Recent composer commits (6bd437aa #4625, 13d4608d #4622) did not touch it.
Why not ARTIFACT: automation typing too fast cannot drop only the first word; the drop lines up with the draft-reset window. Rerun proof: open a thread via the drawer or a reload, then type immediately with throttled network ("Slow 4G"). Expect lost leading chars. Typing after the turns render should be clean.
Smallest fix (for Foreman, not done): in the `!detail` branch, hydrate with `{...EMPTY_FIXTURE.thread, id: openId}` so the thread id matches and the draft is preserved, or disable the composer until detail loads. Add a unit test: type during detail=null.

## Q2 Verdict: NOT FIXED on main (FINISH stands)
packages/factorylm-ui/src/conversation.css @ bc10ab34:
- :273-282 `.fl-thread__viewport` display:grid with no grid-template-columns:minmax(0,1fr) and no min-inline-size:0.
- :287 `.fl-turn--aui { display:grid; gap }` has neither the fix nor overflow-wrap:anywhere. (The minmax(0,1fr) and overflow-wrap at :95-96 are only on `.fl-source`.)
- Last commits on the file: 28430d68 (#4642), 6bd437aa (#4625), 13d4608d (#4622), 86c5a80f (#4617). None adds the overflow fix. No fixing commit exists.
Staging SHA: deploy-staging.yml is workflow_dispatch with an "approved RC SHA" input, so the SHA is not in git. Newest tag v3.417.4 (and rollback/2026-10-23-v3.417.4) points at bc10ab34 = main tip. That suggests staging ≈ bc10ab34, but this is UNVERIFIED (check the Actions run inputs or the staging /version endpoint). Either way, staging lacks the overflow fix because main does.
