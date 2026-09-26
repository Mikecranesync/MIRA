# MIRA photo and conversation repair report

Updated September 25, 2026. Written for readers who do not work with software.

## The main finding

**MIRA is getting better at handling photos and saved conversations, but it still sometimes gives incorrect explanations of what a photo shows. It is not ready to be called reliable for this test.**

There are two separate questions: **Does the app work?** and **Is its answer right?** A photo can upload correctly, a conversation can save correctly, and the answer can still be wrong. Our reports now keep those results separate.

The previous work session stopped because Codex, the tool doing the development work, received a sign-in error called “401 Unauthorized.” That interruption did not erase the repair work. It is separate from MIRA’s incorrect photo answers.

## What we tested

The earlier session used the real Pixel phone. After it disconnected, we used an **Android emulator**, which is a simulated phone running on the Mac. Both used a separate test setup, not the customer-facing app.

We supplied the original equipment photos through the app’s normal photo picker and used neutral questions such as “What can you tell from this photo?” We did not give MIRA the known diagnosis or tell it what answer to produce. We also compared its first description of each photo with its final written answer. This helped us find where incorrect information entered the process.

The latest emulator work tested a control-panel photo, a wiring drawing, and a question combining both. We have **not** completed the full five-photo acceptance test on the final changes.

## What now works in the tests

| User action | What we observed | Limit of that result |
| --- | --- | --- |
| Open the project’s Sources area | The panel for adding documents opens. | Earlier Pixel test; the complete document-upload journey still needs testing. |
| Send a photo | A progress message appears promptly while MIRA prepares the photo. | Observed on the Pixel and emulator test builds. |
| View the original photo | The app opens the saved, full-size photo. | This proves viewing works, not that MIRA read it correctly. |
| Retry after a failed photo upload | The earlier Pixel test retained the photo/question and sent it once after retry. | Needs repeating on the final candidate. |
| Return to saved conversations | Earlier phone conversations remained available. The emulator restored both photos and the follow-up after reopening the saved conversation. | After restarting, the emulator initially showed an empty view; automatic reopening of the last conversation was not proven. |
| Handle a sideways drawing | The corrected image step turned the test drawing upright and left the other four upright photos alone. | This improved the reading but did not eliminate all reading errors. |

## What went wrong, in plain language

### 1. MIRA sometimes reads the wrong words

The earlier phone test turned “CURRENT SENSOR” into “FLAME SENSOR.” These are different things, so this was a real error, not a wording preference.

The emulator found that the unfinished image-processing code sometimes left the drawing sideways. We corrected the way it prepares a smaller image for deciding which way is up. The main labels became much more accurate afterward.

**Still unresolved:** the latest answer includes unreliable small-print text such as “120VAC ISOLTRAL.” Better performance on large labels does not mean all the drawing is being read correctly. See [issue #3997](https://github.com/Mikecranesync/MIRA/issues/3997).

### 2. MIRA can put a correct label on the wrong component

One answer gave the current relay’s model number to the power supply. The words existed in the picture, but MIRA attached them to the wrong object.

We changed its photo-reading instructions so each label stays connected to the component or location where it appears. The next saved photo description handled those associations better.

**Still unresolved:** a later answer grouped components from different manufacturers under Allen-Bradley. That means the step that writes the final answer can still introduce a mistake even when the earlier photo description is better. This is part of the incorrect-photo-reasoning work in [#3992](https://github.com/Mikecranesync/MIRA/issues/3992).

### 3. Finding a manual could make the photo answer less careful

MIRA has rules that say a lit indicator does not prove the actual voltage, and that a drawing does not prove the condition of installed equipment.

We found that these rules were missing from one answer path: when MIRA also found a manual excerpt, it switched to a different set of instructions. In that path, an answer invented a PowerFlex cabinet identity and treated a green indicator as proof that voltage was present.

We connected the existing photo rules to that path too. We also made clear that finding a manual does not prove that the equipment in the photo is the model described by that manual.

A new automated check demonstrated the missing rules before the repair and passed afterward. A separate check confirms ordinary manual-only questions keep their existing behavior. The next hardware-photo replay avoided the invented cabinet identity and the unsupported voltage claim.

**Limit:** this repairs a missing instruction path. It is not a guarantee that the model can no longer invent facts.

### 4. Earlier answers included unsafe or unsupported advice

The earlier tests found electrical testing advice under a heading that said the equipment should be powered off. They also found suggestions to change settings that were not supported by the available evidence. These problems are serious even if the screen looks polished.

The repair work adds checks around these answers and suggestions. Those software checks pass, but we have not declared the complete real-world safety problem solved. See [unsafe advice #3991](https://github.com/Mikecranesync/MIRA/issues/3991), [unsupported setting suggestions #3993](https://github.com/Mikecranesync/MIRA/issues/3993), and the still-open [safety issue #3984](https://github.com/Mikecranesync/MIRA/issues/3984).

### 5. The app made some normal actions confusing or unreliable

Earlier problems included conversations disappearing from navigation, photo cards that could not open their original image, a long wait with no progress message, and a failed photo send with no useful retry action. The candidate contains repairs for these behaviors.

These are tracked separately: [saved conversations #3994](https://github.com/Mikecranesync/MIRA/issues/3994), [opening photos #3995](https://github.com/Mikecranesync/MIRA/issues/3995), [progress messages #3996](https://github.com/Mikecranesync/MIRA/issues/3996), and [retry #3998](https://github.com/Mikecranesync/MIRA/issues/3998).

### 6. Other related problems remain tracked

- [#4000](https://github.com/Mikecranesync/MIRA/issues/4000): an answer that stopped halfway through could be recorded as finished. The candidate now rejects incomplete output; the earlier focused checks passed.
- [#3962](https://github.com/Mikecranesync/MIRA/issues/3962): a photo can be available to the answer-writing step but still be ignored. Keeping photo history available is necessary, but it does not prove that every answer uses it correctly.
- [#3982](https://github.com/Mikecranesync/MIRA/issues/3982): a safety check can also reject safe requests by mistake. We must test both unsafe requests that should be blocked and safe requests that should remain usable.

All these issues were still open when this report was prepared. A passing test does not automatically close an issue.

## What the test numbers mean

The latest local Hub test run passed **3,921 automated checks across 298 test files**. The image-orientation check also passed four rotated versions of the drawing and four upright-photo controls.

An automated check is a repeatable software test. It is useful for catching broken behavior, but many of these checks use controlled examples rather than asking a real AI model to interpret a new photograph. **3,921 passing checks does not mean 3,921 correct diagnoses.**

The code checker still reports **33 existing problems**. We compared them with the saved earlier result and found no new ones from this work. The code checker is therefore not completely clean.

Earlier records also report 793 passing mobile-app checks and 252 passing shared-screen checks. Those belong to the earlier phone candidate; they were not rerun during this emulator session.

## What is on GitHub, and what is only on the Mac

| Item | Current status |
| --- | --- |
| [Draft PR #3999](https://github.com/Mikecranesync/MIRA/pull/3999) | The proposed repair package already on GitHub. “Draft” means it is still being worked on. |
| Earlier phone repairs | Included in the GitHub code at revision `c50f7ba9ca9c83523eee4b947db6d0f98a95fc1c`. |
| New emulator changes | Saved locally on the Mac. They are **not yet committed or pushed as code** to PR #3999. The 3,921-check result describes these local changes. |
| This report | Published on GitHub as a PR comment and linked from the PR description. |
| Original photos and complete conversations | Kept private on the Mac. This public-facing explanation summarizes findings without uploading that evidence. |
| Customer-facing release | Not updated by this testing. No merge or deployment was performed. |

A **revision** is an exact saved version of the code. A **pull request (PR)** is a proposal to add changes. **Merging** accepts that proposal into the main code, while **deploying** makes a version run in a shared or customer-facing environment. None of those words means the same thing as “we tried it on a test phone.”

## What needs to happen next

1. Stop the final-answer step from moving labels or manufacturer names between unrelated components. Compare its answer against the saved photo description, not just against earlier AI answers.
2. Improve or clearly mark uncertain small-print readings. Do not make the system pass by giving it the hidden diagnosis or the correct labels during the test.
3. Repeat the complete five-photo conversation, including a different photo order, on one unchanged test version.
4. Reconnect the Pixel and repeat the important checks on the real phone.
5. Open the same conversation on the web, continue it there, and confirm it returns correctly to the phone.
6. Review and publish the remaining code changes before considering a release. Keep the serious safety issues open until their required tests actually pass.

**Current decision: keep PR #3999 in draft. The app-handling improvements are useful, but answer accuracy has not passed the final test.**

## If you are reading this with ChatGPT

Ask: “Explain this report to me without software jargon. Separate what works, what still fails, what was tested on the real phone versus the emulator, what code is actually on GitHub, and the next action. Do not treat automated tests as proof that the AI answers are correct.”

The key remaining distinction is between **having the right photo available**, **reading it correctly**, and **writing an answer that stays faithful to that reading**. Each step needs its own proof.
