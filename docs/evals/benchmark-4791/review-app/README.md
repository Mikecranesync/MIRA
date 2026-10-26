# Industrial Intelligence Challenge: expert-review page, v2

How Mike's answers become the benchmark's answer key, and how the benchmark is rescored, is covered in
`../HUMAN_REVIEW.md` (shipped with the benchmark, PR #4793).

This is the phone page Mike uses to become the IMIB answer key.
- **Live v1:** https://claude.ai/artifact/FyGwYMjfhTzQ6QnSZJ5jwf (unchanged by this PR).
- **v2 preview:** https://claude.ai/artifact/CewhKns3sQFnF46KLq5jzW. Its answers are test data.

It is an internal evaluation tool, not FactoryLM product UI, so it lives under `docs/evals/` rather than the
unified UI shell. It still uses the canonical `--fl-*` tokens, inlined by `build.py`.

## The three missions

The order and the lock are the same as v1:

1. **Hazard Hunter.** Mike writes 10–20 hazard questions in his own words. He sees none of the existing safety
   examples while doing it.
2. **Manual Detective.** 34 real forum questions. For each candidate manual page Mike answers "Answers it",
   "Partly", "No" or "Can't tell", then gives an overall call.
3. **Safety Sentinel.** 32 safety questions: stop, warn, just answer, or "Not sure". It stays **locked until
   Hazard Hunter has 10 questions** or he taps "I'm done writing", exactly as in v1.

**What v2 adds:**
- per-mission and overall progress bars;
- XP and count-based badges;
- toasts when a badge is earned or a mission is completed;
- optional quick sessions of 5 or 10 questions, taking the next unanswered ones in the original order;
- an "Unsure / needs a second expert look" flag on every item;
- a final summary;
- larger type (20–22 px) and tap targets of at least 56 px;
- page images at 150 dpi, with "tap to open full size, pinch to zoom".

## Scientific constraints and how each is enforced

| Constraint | How |
|---|---|
| Frozen data and order | `data.json` is byte-identical to v1's embedded data (sha256 in `data.json.sha256`). `build.py` refuses to build if it changes, and test 1 asserts that the page embeds exactly that data. |
| Nothing shown before a judgment | The embedded data holds only id, manual title, question, URL and candidate page numbers. Candidate pages are shuffled the same way as v1 and carry no source label. No expected answers, AI labels, MIRA rankings or grader feedback appear anywhere, the summary included (tests 1 and 13). |
| No timers; no accuracy-based or label-based XP | XP is a fixed amount per completed review: 10 per manual case, 5 per safety call, 5 per hazard. "Can't tell", "Not sure" and "Unclear" earn the same as any other answer (test 6). Badges depend only on counts. Nothing tracks time. |
| No reward for skipping evidence | A page's buttons stay disabled until its image has loaded **and** been on screen (test 5). A case counts only when every page **and** the overall question are answered (test 6). |
| XP only for saves the server confirmed | XP, progress and badges are computed only from database snapshots that are definitive (`fromCache: false`) and have no pending writes (test 4). |
| Edits before the first sync, or made offline, never wipe saved fields (Codex F1 on #4801) | Answer buttons, flags and notes stay disabled with a "Loading your saved answers" banner until the first definitive snapshot. A record edited offline is **merged** field by field into the server copy (the phone's fields win; saved page ratings and notes are kept), never replaced. Every save starts from both copies, the newer one's fields winning, so no save can drop a field the other copy holds (Codex round 2). (Tests 14, 15, 17 and 19.) |
| The session summary survives a late first sync (Codex round 2 F4) | The finished session is kept for as long as its summary shows (test 18). |
| A failed first load recovers (#4802) | A subscription error shows "Couldn't load your saved answers" with a **Try again** button that resubscribes. Answer controls stay locked until a definitive snapshot arrives, so nothing saved can be overwritten. A hazards-only failure is shown and recovers too (tests 20 and 22). Callbacks still in flight from a superseded subscription are ignored, via a generation counter. That guard is defensive: no test isolates it (independent review finding, 2026-10-27). |
| The session count stays accurate (#4803) | The session summary re-renders as pending saves confirm (test 21). |
| A removed hazard stays removed (Codex F2) | Removing a hazard deletes it from the phone's copy as well as the server, so a reload can't re-upload it (test 16). |
| Saved records never altered | The record keys and shapes are unchanged from v1 (`answers/forum-<id>`, `answers/safety-<id>`, `answers/meta-words`, `hazards/<id>`); `flag: true` and the value `"unsure"` are the only additions. Opening v2 over v1 records makes **zero** writes (test 9), and an older phone copy never overwrites a newer server record (test 10). |
| Save and resume, no lost answers | Every tap writes at once, one write at a time per record. Notes save on pause, on blur and on page hide. A copy is kept on the phone. After a reload or outage, a phone copy that is newer than the server's is pushed (tests 7 and 8). |
| Owner-only writes | Database rule `{path: "", read: "view", write: "owner"}`, unchanged. A refused write shows a read-only banner and earns nothing (test 11). On the live artifacts, `interact` and `admin` writes are refused; see the evidence below. |
| Speech to text | The artifact frame refuses microphone access, so an in-page mic button can't work. Every text box points to the phone keyboard's own dictation microphone instead. |

## Evidence (2026-10-26)

**Playwright suite** (`test/review.spec.mjs`, against `test/fake-db.js`):
- **44/44 pass:** 22 tests × 2 devices, Pixel (412×915, Chromium) and iPhone 13 (390×664, WebKit).
- The fake database mimics the real contract: a cached snapshot first, then a definitive one; writes pending,
  then confirmed; injected `unavailable` and `invalid_argument` errors; and a server copy that survives reloads.

**Mutation proof** (`test/red_runs.py` → `test/red-runs.json`): 17 mutations, each turns its guarding test red,
and the unmutated control passes the **whole** suite. The mutations:
- answer XP counted from the phone's copy;
- hazard XP counted from the phone's copy;
- the page gate removed;
- v1 records rewritten on load;
- the Sentinel lock removed;
- XP depending on the label;
- an overall-only answer completing a case;
- an older phone copy overwriting the server;
- edits allowed before the first sync (Codex F1);
- an offline edit replacing the saved record instead of merging into it (Codex F1);
- a removed hazard kept on the phone (Codex F2);
- a no-op merge not kept on the phone (Codex round 2 F1);
- a save starting from the phone copy alone (Codex round 2 F1);
- the session summary reading a cleared session (Codex round 2 F4);
- a subscription error swallowed (#4802);
- the session summary never refreshing (#4803);
- a hazards subscription error ignored (#4802).

**Access probes** (ArtifactData, as the owner's account acting at a lower level):

| Target | interact | admin | owner |
|---|---|---|---|
| v2 preview | write refused | write refused | write committed (control), then deleted |
| Live v1 | refused (earlier) | refused | not attempted |

The live v1 database still holds 0 answers.

**Screenshots:** `screenshots/` (phone 412×915, desktop 1440×900, and per-device test captures).

**Not yet done:** a check on Mike's own phone. Emulated viewports are not a real device.

## Rebuild and test

```bash
python3 build.py --out dist --preview --pdf-dir <dir holding the 19 OEM PDFs>   # page images matched by sha256
python3 build.py --out dist
cd test && npm i && npx playwright install chromium webkit && npx playwright test && python3 red_runs.py
```
