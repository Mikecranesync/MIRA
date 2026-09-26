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
`original`) on the same prepared bytes and observation prompt. Higher detail
preserved a decimal point lost by one lower-detail reading and improved a truncated
word. This is limited evidence, not an accuracy-rate estimate. The adapter now
requests original detail; the request regression failed before the change, then
46 adapter/preprocessing/LOOK tests passed. A new frozen product replay is required.
The provider documents original detail for small text and dense images:
[OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision).
No additional model calls or parallel reasoning architecture were added to the app.

GitHub's legacy guard separately requires an independent exact-head, exact-body
Codex review. Claude's completed source review does not satisfy that separate gate.
No exception label or approval was inferred from successful tests.
