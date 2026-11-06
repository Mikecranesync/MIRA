# Decision memo: three open product calls (8 AM roundup)

**From:** FactoryLM Product · 2026-10-25 · private draft
**How to use:** each call can be answered in one line, like "A: reopen latest."

---

## (a) What should tapping a project open? ([#4681](https://github.com/Mikecranesync/MIRA/issues/4681))

**Question:** When a tech taps a project, should they land in a brand-new empty chat or back in their last conversation on that machine?

**Today:** the web app (/v3) deliberately opens a fresh chat. That came from PR [#4449](https://github.com/Mikecranesync/MIRA/pull/4449) for issue [#4444](https://github.com/Mikecranesync/MIRA/issues/4444), and tests lock it in. The native phone app already reopens the latest thread, so the two apps don't match. Draft PR [#4474](https://github.com/Mikecranesync/MIRA/pull/4474) adds an explicit "New chat" button.

| Option | Upside | Downside |
|---|---|---|
| **A. Reopen the latest thread**, with "New chat" from #4474 for a fresh start | The tech picks up where they left off, the web app matches the phone app, and the tap no longer looks broken | Reverses #4444. Old context can carry into a new problem unless the tech taps New chat |
| B. Keep opening a fresh chat | Clean slate every time. No work | Every tap looks like "my history is gone." The web and phone apps keep disagreeing |

**Recommendation: A.** Most of a maintenance job is coming back to the same machine. An empty chat on every tap reads as lost work, and that hurts trust. Landing #4474 first keeps a fresh start one tap away.

**Once you decide:** with A, Foreman lands #4474, changes the open-project path to pick the newest thread (and only creates one when none exists), and updates the #4444 tests. It's a small FINISH item. With B, #4681 closes as "by design," and #4474 still adds New chat.

---

## (b) Answers don't stream: show progress messages, or stream for real? ([#4687](https://github.com/Mikecranesync/MIRA/issues/4687))

**Question:** Today a tech sees one dot for 5 to 30 seconds, then the whole answer appears at once. Do we fix the wait with honest progress messages, or let words stream as they're written?

**Why it's like this:** the safety check holds the answer until it has been validated. That's the answer gate from PR [#3975](https://github.com/Mikecranesync/MIRA/pull/3975), which enforces the energized-procedure rule. Real streaming would show text before it has been checked.

| Option | Upside | Downside |
|---|---|---|
| **A. Progress messages:** "Searching the manual…", "Writing answer…", "Checking safety…", with the gate kept on | No unchecked text ever reaches the screen, the wait feels alive, and "Checking safety" becomes visible proof of the moat. Medium build | Total time to the answer doesn't change |
| B. Real token streaming | Feels fastest, like ChatGPT | Conflicts with the safety gate. Text could show and then be pulled or changed, which is the worst trust failure on a lockout question |

**Recommendation: A.** For maintenance, "checked before you see it" is worth more than speed, especially with LOTO-type failures still open. Progress messages fix the "is it broken?" feeling, which also drives double-taps ([#4695](https://github.com/Mikecranesync/MIRA/issues/4695)).

**Once you decide:** with A, Foreman builds the progress messages in the answer route and the shell's working state (the #3626 shared-UI lane). Streaming work in [#4068](https://github.com/Mikecranesync/MIRA/issues/4068) stays parked. With B, we'd need a new safety design for streamed text before any build, which is much bigger and riskier.

---

## (c) "Not a CMMS" vs. work orders inside MIRA

**Question:** Our approved line is "Keep your CMMS. MIRA is not a CMMS." But MIRA now lets a tech create, start and complete a work order in the app, and the round-trip tracker [#4732](https://github.com/Mikecranesync/MIRA/issues/4732) builds more of that. Which story do we tell?

**Tension:** the build-in-public draft walks through opening and completing a work order, which reads as CMMS-like. Approved claim A6 ("doesn't write work orders") is no longer literally true. Much of the work-order story isn't built yet: assignment and notification ([#4725](https://github.com/Mikecranesync/MIRA/issues/4725)), close with evidence ([#4730](https://github.com/Mikecranesync/MIRA/issues/4730)), and the "closed" status bug ([#4731](https://github.com/Mikecranesync/MIRA/issues/4731)).

| Option | Upside | Downside |
|---|---|---|
| **A. Keep "not a CMMS."** Work orders become a light job log next to the cited answer, for crews without a CMMS. Reword A6 to "doesn't replace or write to your CMMS" | Matches the buyer (they have a CMMS or spreadsheet they won't replace), stays honest about the half-built work-order features, and doesn't pull us into a feature war | The round-trip post has to be reframed. Work-order BUILD items look less urgent |
| B. Lead with the full round trip (MIRA as a light CMMS) | A bigger, more complete story | We can't back it up yet (no assignment, no evidence close). It contradicts the approved claims and the site cleanup, and invites CMMS feature comparisons |

**Recommendation: A, for now.** Revisit once #4725 and #4730 ship and a real pilot asks for it. The wedge is "ask the manual, get the page." Work orders should support that, not become the pitch.

**Once you decide:** with A, Grok Bot rewords claim A6 and reframes the round-trip post around "a cited answer and a quick job note on the same machine." On the product side, CONNECT work stays priority ([#4726](https://github.com/Mikecranesync/MIRA/issues/4726), [#4727](https://github.com/Mikecranesync/MIRA/issues/4727)). BUILD items ([#4728](https://github.com/Mikecranesync/MIRA/issues/4728), [#4729](https://github.com/Mikecranesync/MIRA/issues/4729)) wait for pilot demand. With B, the approved claims and site copy get rewritten, and #4725/#4730 become P0 before any outreach.
