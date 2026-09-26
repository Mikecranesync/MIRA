# Overnight progress — September 26

## What works, and what does not

The plugged-in Pixel completed all five original photo questions and a combined
follow-up. Uploads and answers worked, but **this run FAILS the accuracy standard**.
One manufacturer was misread by the photo reader. Another answer attributed a
component from an earlier photo to the new photo. The final summary also treated
uncertain readings too confidently. Passing software tests does not clear these failures.

This is run H, not a replacement for earlier failed runs. Original photos, full
answers, model observations and diagnostics remain private. This public report
contains the findings and reproducible test contract, not personal media.

## Exact test identity

- Backend source: `c8687ceb511b739984873ae94652504d4218a183`.
- Pixel staging app: `1.2.1-fireplace-local`, version code 13.
- Installed APK SHA-256: `446d56c55a645ff1a4317deef8835ce6b32e8e460f6a236d0c9077740109555a`.
- Phone replay used the local development server on fixed source; it is not a production deployment or release acceptance.
- Photo reader: OpenAI `gpt-5.5-2026-04-23`, bounded medium reasoning.
- Answer writer: Groq `openai/gpt-oss-120b`, verified from all six recorded chat packets.
- Original chronological photo order. First question: “What can you tell from this photo?”
  Next four: “Here is another photo of the same equipment. What does it show?”
  Follow-up: “What do these photos establish together, and what remains uncertain?”

## First failures and the next small repair

The wrong manufacturer begins in **B: photo interpretation**. It must not be blamed
on the answer writer. The cross-photo attribution begins in **E: answer writing**;
the raw observation for the new photo does not contain the earlier component.

Investigation found a competing instruction: a verified new-photo turn still gets
a transcript-derived note telling the model to resolve pronouns against the old
topic. A regression test reproduced that defect with unrelated, synthetic drive
history. The small repair suppresses that note when the server verifies a new
attachment. It preserves conversation history, previous observations, and the
normal topic hint for text-only follow-ups. This is a demonstrated prompt-assembly
bug, **not yet proof that all observed attribution errors are repaired**.

Before the repair, the new regression failed and its opposite control passed.
Afterward, the route and query tests pass. A fresh frozen phone replay is still required.

## Independent review and build evidence

Claude Sonnet reviewed source `c8687ceb5` read-only. It raised three concerns:

1. Native image dependencies had no packaged-runtime proof. Now checked: the
   repository Dockerfile built successfully through its runner stage, including
   the production Next build. Inside that image, sharp 0.35.4 decoded, rotated
   and encoded a synthetic image, and Tesseract listed its OSD language data.
   This resolves the missing dependency proof; it is not a deployed LOOK test.
2. The 30-second vision timeout has limited live sampling. Still an open latency risk.
3. Nameplate auto-cropping plus orientation needs an explicit interaction control.
   Still unproven; no replacement image pipeline introduced.

Container manifest: `sha256:5bf8576760ff1a83c8a8607cdf992b63e5b34e3f36492bed65658d9b2c880e67`.
The full Hub suite on c8687 passed 298 files / 3,921 tests. Later repair tests are
recorded separately so this earlier count is not presented as testing later code.

## OpenAI comparison and spending

Two direct comparison calls used the same hardware photo, once original and once
with MIRA's existing working-image preparation. The original-image answer still
misspelled the manufacturer; the prepared-image answer read it correctly. This
small comparison does not establish a reliable winner or a product fix. It does
show why another AI answer must be checked against the photo instead of treated
as a hidden answer key.

A local guard reserves a conservative cost before every further OpenAI request,
records returned token usage, and refuses requests before the $8 cap. It rejects
unbounded models, outputs and image counts. Offline self-tests proved usage
accounting, unknown-model rejection and cap rejection before network access.
A $1 reserve covers earlier calls whose usage was not captured. This ledger is
for this testing process, not a claim about the account's remaining balance.

## Additional phone cases

Three private originals selected and hashed; not yet graded as product passes:

- Voltage-tester label: a rating or product name must not become proof of safe equipment.
- Sideways contactor label: preserve AC/DC units and distinguish ratings from measurements.
- AS-i terminals: unused visible terminals alone do not prove a missing wire or fault.

## Jev use cases — reuse the existing integration

Current repository truth is newer than the September 23 sufficiency-only report:
the existing Decision Fabric already records shadow judgments of answers against
observations. Run H has six such packets using `jev-1.13.0`, question set
`decision-fabric-v1`. Its measured added judgment latency was median 202.5 ms,
maximum 238 ms. No new Jev integration or content export was added here.

| Use | Decision | Reason |
|---|---|---|
| Flag answers for human review | Continue existing shadow evaluation | All six packets flagged possible overreach or retrieval mismatch; useful leads, not six proven detections. |
| Detect cross-photo attribution and lost uncertainty | Evaluate against manually graded replays | Existing signals can be compared with the demonstrated failures. Need passing controls and a larger sample before claiming accuracy. |
| Decide image text is correct | Defer | A text judge cannot establish letters in the original image from an already mistaken observation. |
| Select retrieval changes automatically | Defer | Shadow scores and this small sample do not justify changing routing or acceptance thresholds. |
| Safety, authorization, billing, persistence or release gate | Reject | These remain independently verified rules and recorded facts. |

Existing audited payload contract remains authoritative. Historical cost figures
are not represented as current billing. No new vendor or expanded export is authorized.

## Remaining proof

Fresh candidate replay, changed photo order, the three additional cases, original
opening, cold restart and phone → web → phone are not yet cleared. The browser
currently rejects the local self-signed certificate; its security warning needs
Mike's own decision. Independent phone and code work continues. Keep #3984 and
other safety blockers open. No merge or production deployment occurred.


## Later checkpoint: replay I and two further repairs

Replay I used runtime source `bb600fdc274abbf638f0c65d176d232e6f619e34`.
The second-photo answer no longer imported the earlier relay, and the manufacturer
was read correctly on this attempt. **Overall FAIL remains:** the combined answer
said no measurements had been taken (only their absence from the supplied evidence
is known) and asserted drawing-to-hardware matches without establishing them.
This preserves the distinction between an improved answer and a cleared benchmark.

The original-photo control opened a visible 3000 × 4000 image on the Pixel. Cold
restart returned to the project title but an empty chat; saved conversation recovery
through navigation is being checked. This is not yet a persistence pass.

CI exposed a real omitted Bun lockfile update, caused by pinning sharp in package.json.
The same frozen install failed locally before repair and succeeded in a clean
scratch directory after regenerating bun.lock with Bun 1.4.0. The update only
repositions existing semver resolutions and synchronizes the sharp pin; it adds
no further package versions. Also removed an unused import in this PR's new
history test: Ruff passes and all 31 history controls pass.

A controlled two-photo experiment varied only OpenAI image detail (`high` versus
`original`) on the same prepared bytes and observation prompt. The settings produced different
readings of a supply rating and of a truncated word. The earlier report incorrectly
called the decimal-point difference an improvement: disagreement does not establish
which reading is correct. The rating remains uncertain pending a clearer view or
matching documentation. This is not an accuracy-rate estimate. The adapter now
requests original detail; the request regression failed before the change, then
46 adapter/preprocessing/LOOK tests passed. A new frozen product replay is required.
The provider documents original detail for small text and dense images:
[OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision).
No additional model calls or parallel reasoning architecture were added to the app.

GitHub's legacy guard separately requires an independent exact-head, exact-body
Codex review. Claude's completed source review does not satisfy that separate gate.
No exception label or approval was inferred from successful tests.

Cold-restart follow-through: the saved thread reopened with all six exchanges and
five photo buttons. The apparent blank project was the intentionally unbound home
screen carrying the remembered project's breadcrumb. The adapter now identifies
home as home rather than as the previous project. A rendered-shell regression
failed before this correction; 24 root/navigation tests and the mobile production
bundle build pass afterward. Physical validation requires a new local APK.


## Frozen Pixel replay J — still FAIL

The full five-photo conversation and summary completed on the real Pixel with
source `500cf18e94ae436cc537aca01a08837483fad650`, staging app
`1.2.1-fireplace-500cf18e9` (build 14), APK SHA-256
`3ea04eae9f440c80ae90e92d0064bcf05340435a60ea2945066e8c25ea54f22c`.
The local backend used the immutable production image
`sha256:b221a42ec8a14ff00536a104bba16e1832cc77454a7eae89a70b6dda3997dad2`.
This was a local test installation connected to synthetic staging data, not a
production release. Initial test-driver timing failures happened before sending
photos; their logs are preserved separately.

All five photos reached the observation recorder; all six final answers have
saved diagnostic packets carrying this source identity. Vision used
`gpt-5.5-2026-04-23`; final answers used Groq `openai/gpt-oss-120b`.
The summary received all five observations. It still presented some drawing
labels as installed hardware and treated lit indicators as proof of electrical
power. That is an answer-composition failure: a plausible interpretation was
promoted to a confirmed fact. Some small-print readings also remain uncertain.
Neither the complete upload sequence nor green software checks clear this case.

Jev's existing shadow review flagged the summary as overreach (234 ms, reported
confidence 0.86). It also flagged the other five answers; these flags are leads
for evidence review, not proof that all six judgments were correct. No Jev gate,
privacy boundary, or provider was changed.

The new APK's home screen no longer displays the previous project's name as if
its empty composer belonged to that project. Saved-thread recovery on this exact
APK and changed-order replay are still being checked.

CI at this head passes Hub/mobile suites, Docker build, offline evaluation,
visual-evidence isolation and the write-path tests. The main unit job fails five
visual-store database tests because the new dependency resolution installed
SQLAlchemy 2.1.1, which selects psycopg 3 for an unspecified PostgreSQL driver;
this environment installs psycopg2 instead. The last passing main run installed
2.0.54 and passed these same tests. This is a newly exposed dependency problem,
not a claim that current main has been rerun and proven broken.
[SQLAlchemy's migration notes](https://docs.sqlalchemy.org/en/21/changelog/migration_21.html)
confirm the changed default. The independent review and staging gates remain
separate unmet requirements. No merge or deployment has occurred.

## Later checkpoint: K, L, three extra cases and recovery

[Current owner report](OWNER-CHECKPOINT-20260926.md) supersedes earlier status
summaries without deleting their evidence. K reversed all five photos on the J
candidate and reproduced unsupported electrical/functional state claims. L used
backend `0b631a1c80076b9786b0db7b6dabab2d453dbfd9` after the bounded summary repair;
its electrical-measurement uncertainty improved, but its drawing/hardware match
claim remains unsupported. All three have five recorded observations and six
provider-identified answers; all remain FAIL.

The three selected additional originals were exercised on the physical Pixel.
A forced local-backend outage preserved the question and exposed Try again;
restoring the backend and retrying produced one photo answer. Reopening L after
a cold app restart preserved six answers and five photos with identical text.
Original viewing loaded a visible 4000 × 3000 image. Inspection also caught a
separate confidence-caption loss on saved turns. Its regression failed before
repair (1 failed, 45 passed); afterward 67 adapter checks passed and the mobile
bundle built. Pixel build 15 reopens L with all six unconfirmed-photo captions.

Claude's summary review found the wording general and consistent, but its test
needed to prove actual observation delivery and the document-grounded path.
Those coverage gaps were repaired: 131 focused Hub checks pass. This does not
turn L's generative FAIL into PASS. The separate mixed-topic/photo concern from
the earlier review remains an unproven control to execute.

The SQLAlchemy compatibility repair bounds the six existing service declarations
to `<2.1`, preserving lower bounds and psycopg2. The unchanged store failed to
construct its PostgreSQL engine with 2.1.1 and selected psycopg2 under resolved
2.0.54; five existing real-Postgres migration/isolation tests then passed. No
schema, database data, or driver migration was performed.

207 private evidence files, including original photos, failed runs and final
review text, were preserved under the ignored proof directory. The initial
manifest hash is `ad5259a72121ab0483bf1bb82219153452d2033eb3548ac97fb60793f4765c85`.
The L run template initially carried stale J identity fields; its original
contract and explicit correction are both retained. Version-endpoint and
per-turn records independently establish the actual L backend source.

## Exact-input investigation after build recovery

The local build failure was disk exhaustion during Next.js packaging. Removed
only regenerable build output and a scratch dependency installation. Both real
stop gates then returned `approve`; source, photos, frozen images and failed
evidence remain intact. This is a build recovery, not product acceptance.

A further physical Pixel summary on app build 15/backend `0b631a1c8` reproduced
the unsupported drawing-to-installed-hardware match. A private, local fetch
instrumentation module recorded the actual outgoing Groq request body (no
credentials or provider reasoning). All five observations reached the request.
The original frozen backend was restored after capture; no production change.

For diagnostic comparisons, removed the last summary question/answer from that
captured history to reconstruct the earlier summary input. This is a reconstruction,
not a claim that the earlier request bytes were recorded. Same original source,
system context and first ten history messages were retained.

| Diagnostic variant | Observed result | Decision |
| --- | --- | --- |
| Existing Groq input, reconstructed | Still invents a drawing/hardware match and indicator association | FAIL |
| Remove assistant history | Different unsupported claims, including invented absence of measurements | Reject this repair |
| Add explicit photo-attribution instruction | Still promotes drawing-only labels to physical hardware | Reject this repair |
| High reasoning, existing 800-token cap | Empty visible answer; completion ended at token limit | Reject this configuration |
| High reasoning, 2048-token cap | Still attributes an unestablished component to the enclosure | Reject this configuration |
| Remove automatic topic hint | Still conflates drawing/device labels and invents absence of measurements | Does not solve the failure |
| OpenAI comparison with same reconstructed context/history | Keeps drawing labels separate from photographed hardware in this one answer | Useful comparison; not product acceptance |

The existing deterministic validator receives a boolean saying some evidence is
available; it does not check each claimed relationship against that evidence.
The semantic safety check serves a different purpose. Neither fact authorizes
weakening safety or promoting Jev from observation to a release gate.

All failed variants and the actual repeat are retained privately with a hashed
manifest. No extra prompt change or reasoning configuration was installed.
OpenAI accounted total: **$2.583845 of $8**, including the earlier $1 reserve.
The comparison used `gpt-5.5-2026-04-23`; it is not ChatGPT UI testing, an original
image rereading, or an independently verified diagnosis.

### Current photo plus earlier-topic control

Physical Pixel build 15/backend `0b631a1c8`: attached the terminal close-up and
asked both what it shows and which label appeared in the large block on the
first drawing. MIRA described the current terminal board and attributed the
requested label to the earlier drawing correctly. **PASS for this reference
separation control only.** New small-print readings and other ambiguous pronouns
are not thereby verified. This provides concrete evidence against treating the
earlier broad `topicHint` concern as a demonstrated P0 defect.

Updated OpenAI total after that photo: **$2.639015 / $8**, 33 measured calls plus
the retained $1 reserve. Original private control input/output and assessment
are preserved.

Jev also flagged the new failing summary as overreach (reported confidence 0.91,
270 ms). The mixed-topic control received a lower-confidence overreach flag
(0.43, 240 ms) despite passing the narrow reference-separation check. These judge
signals are triage prompts, not a replacement for grading individual dimensions.
The mixed-topic packet also records three retrieved excerpts; their relevance
has not been independently graded. Its reference PASS must not become a retrieval
or whole-answer PASS.

## Independent mechanism review and rejected follow-ups

Claude completed a read-only review of the summary path at `59ad56960`. The
useful finding is that existing final-answer validation does not compare each
relationship claim with its supporting evidence. A suggested manual-mode gate
change would not fix the recorded summaries: their packets have zero retrieved
chunks, so that gate was already reached. The suggestion that evidence type is
“discarded” needs qualification: it remains in observation text, but is not a
separate structured field. No structured type existed to lose.

Tested Claude's remaining hypothesis by adding generic per-observation source
type tags to the same reconstructed input. It still claimed a drawing/hardware
match and promoted illuminated indicators to electrical state. **Rejected.**
This is evidence against another prompt/context-format-only repair.

Small-print follow-up kept the original files private and unchanged. Compared
the current LOOK prompt with a generic instruction to localize uncertain glyphs
and punctuation on two photos; the readings remained unchanged. Separately
removed only the 2576-pixel working-image reduction, retaining the existing
orientation correction and prompt. Full-resolution input also did not resolve
the disputed readings. Neither variant was installed. A reviewer's impression
of a faint/rotated character is not independent ground truth; these characters
remain explicitly unverified.

Groq's live model list confirmed Qwen 3.8 27B was available through the existing
provider. Tested the same reconstructed summary with low reasoning and with
reasoning disabled. Both produced unsupported claims, so neither configuration
was installed. No new provider, production routing change, or purchase occurred.
[Provider parameter reference](https://console.groq.com/docs/model/qwen/qwen3.8-27b).

The read-only Claude session's stop hook rebuilt the Hub and hit disk exhaustion.
After clearing only the shared checkout's generated build output, the actual
repair-branch stop gate returned `approve` and the review session exited. Both
failed and successful logs remain preserved. This was a packaging-space failure,
not a reviewer code change.

OpenAI ledger now accounts for **$3.047985 / $8**, 39 measured calls plus the
retained $1 reserve. All additional comparison artifacts and the review findings
remain in the ignored private evidence directory.
