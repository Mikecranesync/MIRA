# MIRA overnight owner report — September 26

## Safety-check wiring repair — next candidate

Source `2cff474bf` narrows the OpenAI comparison flag to notebook answers. The
existing safety judge keeps its original providers, request format, rules, and
fail-closed behavior. Before repair, three new protocol checks failed. After
repair, the selected suites passed all 507 checks; the real chat-handler suite
then passed all 21 checks including the newly added answer-plus-safety wiring
case. The local production build gate passed. These are deterministic checks,
not proof that the model will judge every real request correctly.

Claude review and a newly frozen product replay remain pending. The prior frozen
backend is still `b5b5314f2`; do not attribute its results to this repair. The
emulator console reports its virtual device stopped after the disk incident;
its control interface is alive. No app data was reset. No further OpenAI calls
were used for this repair.

## Latest checkpoint — local build recovery and comparison review

Both the repair branch and shared workspace local build gates now pass. Its earlier failure was a full
host disk (`ENOSPC`), not a compiler error. Generated build output and downloaded
installer caches were removed; source, installed applications, private photos,
recorded failures and frozen test images were preserved. No gate was bypassed.

Candidate backend source: `b5b5314f2a4701dcd48a3a2786c15f36ae7493e4`.
The opt-in OpenAI notebook comparison has 75 passing focused checks and a passing
Docker build. Default production routing was not changed. These checks do not
prove answer quality or safety acceptance.

Claude's read-only review found that the existing safety checker builds its own
request using older parameter names. The new OpenAI selection also reaches that
checker, so the local guard rejects that request before it is sent. Code inspection
confirmed the mismatch. The checker fails closed: it cannot supply a valid verdict.
This comparison remains unaccepted pending a bounded compatibility repair and
safe/unsafe opposite controls. Tight reasoning budgets and operator flag mismatch
also need explicit validation. The review process was stopped after its findings
were saved because its stop hook repeatedly retriggered the same disk failure.

The five-photo emulator run **M is UNKNOWN/incomplete**: disk exhaustion interrupted
recording during photo 2. Its partial results and failure log were preserved; no
successful replay is claimed. Emulator and Pixel both have mobile build 15, source
`054d6c9283f7eca29a91a5a00d3812b5cd2b96c7`. The physical Pixel is securely locked,
so a fresh physical run awaits Mike unlocking it. Web continuity still needs the
existing browser handoff. Local health also reports missing `INGEST_URL`; complete
service readiness has not been established.

OpenAI accounting now reserves **$3.412805 of $8** across 43 calls,
including the earlier $1 reserve and any calls without confirmed usage. Reservations
are retained after interruption. No more calls were needed for build recovery.
Jev remains an observer, never a release or safety approval authority.

Next bounded mission: repair the comparison/safety-check request compatibility,
prove both allowed and disallowed cases, freeze again, then replay without replacing
failed evidence. The original J/K/L synthesis failures remain open. No merge,
production deployment, or safety-issue closure occurred.


**The app is easier to recover and reopen. Its photo summaries still make claims
that the evidence does not prove. It is not ready to be called fully working.**

This report covers the plugged-in Pixel and private test backend, not a customer
release. [PR #3999](https://github.com/Mikecranesync/MIRA/pull/3999) remains a draft.

## What improved

- A failed photo send kept the question. After restoring the test connection,
  **Try again** produced one answer with its photo.
- Restarting the app and reopening the saved conversation preserved all six
  answers and five photo links, with identical answer text.
- The home screen no longer misleadingly displays the previous project's name.
- Reopened photo answers now retain the **unconfirmed reading** caption. The
  physical Pixel verified all six captions after installing the repaired build.
- Original-photo viewing loaded the actual 4000 × 3000 image on the Pixel.
- The latest summary stopped claiming that lit indicators prove actual voltage
  or current. That is an improvement, not a complete accuracy pass.

## What still fails or needs proof

Three complete frozen-build conversations were recorded: original order **J**,
reverse order **K**, and the summary repair **L**. Each used five photos plus a
combined question. **All three remain FAIL.** The latest summary still claims
that hardware matches the drawings without proving the match. Some small-print
readings also remain uncertain. A believable answer is not enough.

Phone → web → phone continuity remains **UNKNOWN**. The local browser requires
Mike's decision on its certificate warning; the existing secure staging website
requires sign-in. Neither has been counted as a successful web test.

Safety issue [#3984](https://github.com/Mikecranesync/MIRA/issues/3984) stays open.
No safety release clearance, merge, or production deployment occurred.

## Extra cases from the phone

| Case | Observed result | Limit |
| --- | --- | --- |
| Voltage-tester label | Identified the device; a follow-up correctly said the photo cannot prove the circuit safe to touch. | This does not validate every electrical-safety response. |
| Sideways contactor label | Described printed ratings, without treating them as live measurements. | Not an independent verification of every tiny character. |
| Terminal wiring | Described visible connections without inventing a missing-wire fault. | Hidden terminations and actual electrical condition remain unknown. |

All originals and full conversations remain private. Earlier failures were retained.

## Jev and OpenAI

Jev remains an observer, not an approval authority. It flagged all three summaries
for overreach. Across each six-answer run, median review time was **241 ms (J),
191 ms (K), and 233 ms (L)**. These small samples support using it to prioritize
human/evidence review; they do not establish an accuracy rate or a cost estimate.

Useful Jev applications: flag summaries that turn guesses into facts; flag
unrelated retrieved material; help review pairs of safe and unsafe requests.
Defer automatic fixes or verdicts until judged examples establish their reliability.
Use deterministic checks for missing photos, lost turns and broken links. Never
use Jev to approve safety, permissions, billing, or releases.

The OpenAI ledger accounts for **$3.048 of the $8 limit**: $2.047985 from 39 measured
requests plus a $1 reserve for earlier calls without captured usage. The guard
reserves cost before each call. OpenAI comparisons are another opinion, not an
answer key. An earlier claim that higher detail fixed a decimal point was
corrected: the readings differed, and that difference alone proved no improvement.

The latest Pixel repeat still invents a match between drawing symbols and the
installed hardware. Capturing the actual model input confirmed all five photo
observations arrived. Removing history, adding attribution wording, removing a
topic hint, and increasing reasoning did not yield an acceptable repair. Those
experiments are preserved; none was installed. One OpenAI comparison using the
same reconstructed context handled the separation better, but it is not proof
that the app works or a decision to switch its production model.

Further review found no demonstrated small prompt-only repair. Source-type tags,
more image pixels, a small-print uncertainty instruction, and another model on
the existing provider also failed their checks. All remain experiments, not
installed fixes. Small-print characters still need independent confirmation.

## Software checks and review

- 131 focused Hub context checks passed after the summary change and review fixes.
- 67 mobile adapter checks passed after the saved-caption repair; the mobile build passed.
- Claude reviewed the frozen summary change. Its test-coverage findings were addressed.
  A Pixel control with a new photo plus a question about an earlier drawing correctly
  kept both references separate. That narrow pass does not prove every ambiguous follow-up.
- CI exposed a database dependency changing its default driver. The same error
  reproduced locally. Keeping the existing supported SQLAlchemy series restored
  all five real-Postgres isolation tests. Current GitHub checks remain separate;
  not all review/check gates are green.

## Exact versions for follow-up

A source ID identifies the code; an image/APK hash identifies the built file.

| Evidence | Identity |
| --- | --- |
| J/K backend and phone source | `500cf18e94ae436cc537aca01a08837483fad650`; phone build 14 |
| L and later controls backend | `0b631a1c80076b9786b0db7b6dabab2d453dbfd9` |
| Frozen backend image | `sha256:64f31ea06e621a946bb5588655c378d2b16c8ed2f9d0f13f5f03cf689d6586d5` |
| Caption repair on Pixel | `054d6c9283f7eca29a91a5a00d3812b5cd2b96c7`; `1.2.1-fireplace-054d6c928`, build 15 |
| Installed build-15 APK | `aa775242b4d86da06974a01fa5d9d8672dbfb7d27a9855fe2d0d759060e23e39` |
| Vision / final-answer models | OpenAI `gpt-5.5-2026-04-23` / Groq `openai/gpt-oss-120b` |

L's full generative replay used phone build 14. Build 15 was verified for saved
conversation/caption restoration; it is not a new full generative acceptance run.

**Next bounded mission:** trace the remaining drawing-to-hardware claim through
the assembled answer context and existing validation path, then repair that
specific failure. Finish the mixed-topic control and web continuity proof. Keep
all uncertainty visible; do not build a new agent architecture to avoid the issue.

[Detailed chronology](OVERNIGHT-20260926.md) ·
[Owner Proxy governing lane](https://github.com/Mikecranesync/MIRA/pull/4001)
