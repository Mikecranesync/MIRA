# MIRA Mobile ChatV2 Integration Design

**Status:** Approved correction scope

**Date:** 2026-08-31
**Surface:** `mira-mobile` equipment-notebook conversation

## Outcome

Land the existing ChatV2 implementation from PR #3516 without duplicating it, while closing the
review findings that make the current branch unsafe to enable broadly. The result is a quiet,
conversation-first shell using `assistant-ui` for commodity thread behavior and MIRA-owned typed
parts for citations, machine evidence, observations, and safety.

This is an integration slice, not the final ChatGPT-parity program. MIRA remains a grounded
maintenance assistant. It does not gain a second provider path, conversation store, upload route,
or generic-chat backend.

## Decisions

1. **Reuse PR #3516.** Do not create a competing chat screen or SSE parser.
2. **Safety survives reload.** Consume the `safety_notice` evidence marker landed by PR #3517 and
   render the same visible STOP treatment for live and hydrated turns.
3. **Server capability is authoritative.** `MIRA_CHAT_V2_ENABLED=1` adds `chat_v2` to `/api/me`.
   Without that capability the client renders the legacy surface regardless of local preference.
4. **Transport honesty beats cosmetic parity.** Web may expose Stop because Fetch abort reaches
   the transport. The current native buffered transport must show a non-actionable Working state,
   not a Stop control that fabricates cancellation.
5. **One composer state.** `NotebookScreen` owns the draft already used by request assembly and
   attachment flows. ChatV2 becomes a controlled view of that state, so failed sends and photo
   questions cannot diverge.
6. **One transient-layer stack.** The attachment chooser uses the existing `Sheet`, so Android
   hardware BACK dismisses it before navigating.
7. **FactoryLM tokens only in new CSS.** ChatV2 rules use canonical `--fl-*` aliases. Raw color and
   shadow fallbacks are removed. Full legacy-token convergence remains a separate behavior-neutral
   refactor because changing every existing mobile token in this safety correction would enlarge
   the visual blast radius.

## Component boundary

```text
App(me.capabilities)
  -> NotebooksTab(chatV2Available)
    -> NotebookScreen(draft/send/upload/transport truth)
      -> ChatV2(controlled draft + semantic handlers)
        -> assistant-ui thread viewport/message primitives
        -> MIRA registered data parts
```

`mira-hub/src/lib/capabilities.ts` owns rollout. `mira-mobile/src/lib/chat-ui-pref.ts` only records
an allowed user's device preference; it can never grant access.

## Acceptance

- A persisted `safety_notice` evidence entry renders a safety alert and never a citation.
- Removing `chat_v2` from `/api/me` immediately selects legacy chat even when the device preference
  says `v2`.
- Native buffered transport never offers a Stop button; web streaming does.
- A failed send restores the visible ChatV2 draft.
- A typed question is the question sent with a photo.
- Hardware BACK closes the attachment sheet.
- ChatV2 source contains no raw color literals or shadow fallbacks.
- Mobile focused tests, mobile build, Hub capability tests, `git diff --check`, and CI pass before
  merge.

## Deferred follow-ups

- MIRA as the app-level default tab and a zero-setup general-maintenance thread.
- Thread history/search/rename and context switching outside a notebook.
- A real native streaming/auth design that makes server-confirmed Stop possible on Android.
- Full byte-for-byte reconciliation of `mira-mobile/src/tokens.css` with the canonical token file.
- Physical-device and benchmark gates required by the broader parity PRD.
