# Alarm-screen reasoning on the phone — design (slice 1: RTD family)

**Status:** design approved in chat 2026-10-12 (Mike); this written spec awaits his review.
Next, after approval: implementation plan (writing-plans).
**Owner of the decision:** Mike Harper.
**Path:** architectural (crosses the LOOK route, the notebook chat turn, a new reference pack,
and the phone answer).

## 1. Why

A technician photographs a ride HMI alarm list. Today MIRA's photo step returns a plain-language
description ("a red alarm about a motor"), which loses the alarm tag, and nothing turns an alarm
line into a technician's first read of it.

A worked evaluation of a real ride-brake RTD alarm (kept private and local; nothing from it is in
this repo) showed the reasoning that makes such a read useful is a small set of **stable
rules**, not model eloquence:

1. Read the alarm line **exactly** and parse it: the reference designation (track, function,
   location, device) and the message kind — an analog measurement compared to a limit, a discrete
   switch trip, a resistance test, an I/O diagnostic.
2. Apply a **sensor failure-mode table**: an RTD measurement reading high is either a real high
   temperature or an open / high-resistance loop (which also raises a wire-break or overrange
   diagnostic on the input card); reading low points to a short.
3. Answer with an **honesty skeleton**: what the alarm is, two hypotheses, the first checks, what
   the photo does not prove, and what could not be read.

Per `.claude/rules/zero-token-architecture.md` (Hard Rule 2) stable reasoning is exported as
deterministic code and data; runtime inference stays only for perception (reading the photo).

## 2. Goal and success criteria

When a technician sends a phone photo of an HMI alarm list to an equipment notebook and asks about
it, MIRA returns an **alarm card**:

- **Alarm** — tag and text exactly as transcribed, labelled "as read from your photo".
- **What it means** — the message kind in one sentence.
- **Two hypotheses** — from the sensor pack.
- **Next three checks** — look-only (see §6), followed by one fixed site-procedure line.
- **Expandable:** "What this does not prove" and "What I could not read".

Success for slice 1:

- Transcription fidelity measured on photographed synthetic alarm screens (§9): reference
  designations reproduced exactly on ≥ 90 % of all alarm lines across **every** photo in the run.
  The capture protocol (handheld, screen filling at least half the frame, angles and lighting
  listed in the run sheet) is fixed before the run; no photo is excluded afterwards. Below 90 %,
  slice 1 does not ship the card; the fallback in §4.3 is taken instead.
- The parser classifies every line of the synthetic golden set correctly and lets every line of the
  negative set fall through (§9).
- Every card passes the existing answer checker, `validateAnswer` in
  `mira-hub/src/capabilities/answer-validation.ts`, unmodified. The checker is never weakened to
  let a card through (see §7 for what the card does instead).
- The safety reviewer agent passes the card template; the energized-step check
  (`mira-hub/src/capabilities/step-energy.ts`) finds nothing in any card.

## 3. Non-goals (deferred, named)

- **Correlating alarms across photos over time** (history screens, earlier visits). Notebook
  follow-up slice.
- **Other sensor families:** thermocouple, 4–20 mA, discrete switch / thermal-switch-only, resistance-test
  semantics beyond recognition. Each is its own pack.
- **Reference numbers** (IEC 60751 PT100 table, copper temperature coefficient) — only with a cited
  reference artifact the answer checker accepts.
- **The Telegram / Supervisor path** (`mira-bots`). The pack format is language-neutral JSON so the
  Python engine can read the same file later (ADR-0033, one brain); not built now.
- **A dedicated card component and an "Explain this alarm" chip** in the unified mobile shell
  (slice 2; needs a work claim on the shared-UI lane).
- Any site-specific display rule (e.g. "this HMI prints zeros in the active view") as a universal
  rule. Site knowledge is evidence, not code.

## 4. Unit 1 — verbatim screen text from the photo

### 4.1 Change

The LOOK route (`mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts`) already makes one
vision call with `INSPECTION_PROMPT` and parses a JSON object `{observation, hazards}`. Add one
field to that same JSON contract:

```
"screen_text_lines": string[]   // on-screen text, transcribed verbatim, one entry per visual line,
                                // top to bottom; empty when no screen/display text is visible;
                                // characters that cannot be read are written as "?"
```

This is an observation (what is written on the screen), not a diagnosis, so LOOK's
"observations only" contract is unchanged. No extra vision call.

### 4.2 Persistence

`recordLookObservation` (`mira-hub/src/lib/visual-evidence-context.ts`) already writes structured,
server-side vision output (`hazards`) into `evidence_item.capture_meta` (JSONB). The lines are
stored there as `screen_text_lines`, normalized (trimmed, length-capped, count-capped). **No
migration.** Later turns read the stored lines; the photo is never re-sent to a vision model for
this purpose (`.claude/rules/materialized-evidence.md` rules 1, 3, 14). The field is never accepted
from the client.

### 4.3 Fidelity gate and fallback

Measured first (§9). If the vision model does not reproduce reference designations reliably, the
fallback is the existing server OCR path (`PHOTO_OCR_ENABLED`, `ask_api/ocr_extract.py`) for the
line text, decided by measurement, not assumed.

## 5. Unit 2 — the alarm-line parser

A pure, dependency-free module: `mira-hub/src/capabilities/alarm-line.ts`.

```
parseAlarmLine(raw: string): AlarmLine | null

type AlarmLine = {
  raw: string;                       // exactly as transcribed
  designation: {                     // IEC 81346-style reference designation, when present
    track: string | null;            // "=1." / "=2." / "=x." prefix
    func: string | null;             // e.g. "BRK"   (examples here are invented)
    location: string | null;         // e.g. "+12"
    device: string | null;           // e.g. "-TE3"
  } | null;
  kind: "measurement_limit" | "switch_trip" | "resistance_test" | "io_diagnostic"
      | "state" | "unknown";
  quantity: "temperature" | "resistance" | "voltage" | "current" | "pressure" | null;
  subject: string | null;            // e.g. "RIGHT WINDING"
  direction: "high" | "low" | null;
  value: { shown: true; number: number; unit: string | null }
       | { shown: false; reason: "not_displayed" | "zero_and_zero_limit" | "unreadable" };
  limit: { number: number; unit: string | null } | null;
}
```

Rules:

- A line parses only when it carries a recognizable designation **and** a message; anything else
  returns `null` and is reported under "could not read" when it looks alarm-like.
- `value` with both value and limit equal to 0 (or blank) becomes
  `{shown:false, reason:"zero_and_zero_limit"}`: the reading is not on this view. This is generic
  (a zero reading against a zero limit cannot have tripped a compare), not a rule about one HMI.
- OCR-style misreads are not "corrected" into a tag. A designation with `?` characters is kept as
  read and flagged.
- Vocabulary is data (a small keyword table in the same module): "temperature measurement",
  "resistance measurement", "too high", "too low", "tripped", "wire break", "overrange",
  "underrange", "passivated", plus German equivalents seen on European ride HMIs
  ("Drahtbruch", "Überlauf", "zu hoch", "zu niedrig").

## 6. Unit 3 — the RTD sensor pack

A versioned data file: `mira-hub/src/capabilities/sensor-packs/rtd.v1.json`, loaded and validated
by `mira-hub/src/capabilities/sensor-packs/loader.ts` (pattern: `mira-hub/src/lib/drive-packs/`).

Keyed by `(kind, quantity, direction)`. Slice 1 entries:

| Key | Hypothesis 1 | Hypothesis 2 |
|---|---|---|
| measurement_limit · temperature · high | the measured point really is above its limit | the RTD loop is open or high-resistance (lead, terminal, joint, element); this also raises a wire-break / overrange diagnostic on the input channel |
| measurement_limit · temperature · low | the measured point really is below its limit | the RTD or its leads are shorted, or the channel is configured for the wrong sensor type |
| io_diagnostic · wire break (analog input) | open circuit in the field loop | wrong channel configuration or a failed input channel |

Each entry also carries:

- **checks** — exactly three, look-only, in order:
  1. Read the actual value and the time of the alarm from the alarm history or diagnostic view.
  2. Compare the sibling channel at the same location (e.g. the other sensor of a left/right pair).
  3. Read the input channel's diagnostic on the controller (wire break / overrange / underrange).
- **site_procedure_line** — fixed text, always the **last line of the card** (after every other
  section, see §7):
  "Anything that opens an enclosure or touches the circuit follows your site's lockout procedure
  with the equipment out of service."
- **does_not_prove** — e.g. "a sensor fault", "an over-temperature", "the cause".
- **pack metadata** — `pack_id`, `version`, `source: "MIRA engineering reference"`,
  `invalidated_by` (e.g. a reviewed edit to the entries).

No numeric reference values in slice 1. No bypass, jumper, substitution, forcing, reset or
"clear the alarm" steps, ever; the pack loader rejects entries whose text matches such verbs.

## 7. Unit 4 — the alarm card

`mira-hub/src/capabilities/alarm-card.ts`:

```
buildAlarmCard(lines: string[], pack: SensorPack): AlarmCard | null
```

Deterministic; no model in its path. Returns `null` when no line parses as an alarm the pack
covers. Rendering rules:

- One card per photo; it leads with the first alarm line the pack covers. Other covered alarm
  lines are listed under "Also on this screen". Lines that are alarm-like but unparsed go under
  "What I could not read".
- The alarm is quoted verbatim with "as read from your photo". Values are shown only when
  `value.shown` is true; otherwise "The reading isn't shown on this screen — read it from the
  alarm history."
- **Answer-checker compatibility (decided by test, not assumed).** Every card goes through
  `validateAnswer` like any other answer. The card's own interpretive sentences never contain the
  designation token (it appears only inside the quoted alarm line), so no sentence asserts what a
  code "means". If the checker blocks a quoted value or unit, the card omits the value and says
  "the value is on your photo" instead; the checker is not changed.
- **Section order is fixed:** Alarm → What it means → Two hypotheses → Next three checks → Also on
  this screen → What this does not prove → What I could not read → site-procedure line. The
  site-procedure line comes last so the energized-step check (`step-energy.ts`), which treats an
  isolation statement as in force for everything after it, never reads quoted alarm text as a step
  performed under lockout. A snapshot case with realistic co-alarms (automatic stop, e-stop reset)
  pins this.
- **Absence is never asserted.** When the pack names a companion signal (e.g. a thermal-switch
  trip at the same location) and none is on the screen, the card says "No matching
  thermal-switch trip is visible in this photo", never "not tripped".
- The card cites the photo (existing visual-evidence marker) and the pack ("MIRA engineering
  reference — RTD v1").

## 8. Unit 5 — where it runs

A fast path in the notebook chat turn
(`mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`), following
`.claude/rules/fast-path-optimization.md`:

- **Trigger:** the turn carries a verified visual observation (`verifyVisualEntry`) whose stored
  `screen_text_lines` produce a card, **and** the question is about the photo: it is empty, or
  it quotes a designation that appears in the lines, or it matches a short fixed list of
  alarm-intent phrases ("this alarm", "what does this mean", "why is this alarming",
  "what is this fault"). Any other question falls through to the normal answer.
- **Client path (verified on main 2026-10-12):** the unified phone shell's attachment flow
  (`mira-mobile/src/unified/attachments.ts`) calls LOOK, then sends the question with a
  `visualEvidence: {fileId, capturedAt}` rider, which the chat route verifies. No client change
  is needed for slice 1.
- **Read-only:** no writes beyond the existing turn ledger.
- **Reuses seams:** visual-evidence loading, the turn ledger, `answer-validation.ts`,
  `step-energy.ts`, the existing answer renderer on the phone.
- **Falls through** on any miss or error to the normal grounded answer, unchanged.
- **Evidence:** a typed entry `{kind:"alarm_reading", fileId, packId, packVersion, lines:[…parsed]}`
  rides in the turn's `evidence[]` next to the existing `visual_observation` entry (same
  discriminated-union pattern as `notebook-chat-types.ts`; readers that do not know the kind skip
  it).

Slice 1 delivers the card as the turn's answer text with fixed section headings through the
existing renderer. No change to guarded legacy UI paths.

## 9. Testing

Hermetic, no network, no customer material (Mike's decision 2026-10-12: synthetic strings only).

- **Golden set:** ~30 synthetic alarm lines covering every `kind`, both directions, shown and
  not-shown values, `=1.` / `=2.` / `=x.` tracks, German vocabulary, `?` misreads. Invented
  designations only (no customer plant codes beyond the generic IEC shapes).
- **Negative set:** ordinary screen text (menus, timestamps, operator banners, part numbers) that
  must never produce a card.
- **Card snapshots** for each golden case.
- **Guards:** every card passes `answer-validation.ts` (no unsourced number) and has zero
  `step-energy.ts` findings; a test asserts the pack loader rejects bypass/forcing verbs.
- **Route tests:** fast path claims the turn when lines parse; falls through on no lines,
  unparsable lines, an unrelated question, or a thrown error.
- **Fidelity measurement (one run, declared cap $1.00):** a synthetic HMI alarm page shown on a
  laptop/tablet and photographed with the Pixel (angles, glare, moiré), sent through the LOOK
  vision call; report the exact-designation rate per photo. Re-run only when the vision model or
  `INSPECTION_PROMPT` changes.
- **Safety review:** the `safety-reviewer` agent reviews the pack text and the card template before
  merge.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Vision transcription paraphrases or drops characters in tags | Fidelity gate (§4.3) before shipping; `?` for unreadable characters; never "correct" a tag |
| A card reads as permission to work on the circuit | Look-only checks; fixed site-procedure line; banned verbs in the loader; safety review |
| Absence on a partial screen read as proof | "Not visible in this photo" wording rule, tested |
| Over-triggering on non-alarm screens | Designation **and** message required; negative set |
| Pack drifts into a second registry | One pack folder under capabilities, one loader, same pattern as drive packs; no new table |

## 11. Rollback

Each unit is additive. Removing the fast-path call restores today's behaviour; the extra
`screen_text_lines` field is ignored by every existing reader.

## 12. Implementation order

1. `screen_text_lines` in the LOOK contract + persistence, then the fidelity run (§9). Stop if the
   gate fails and switch to the OCR fallback.
2. `alarm-line.ts` + golden/negative tests.
3. `sensor-packs/rtd.v1.json` + loader + banned-verb guard + safety review.
4. `alarm-card.ts` + snapshots + answer-validation / step-energy guards.
5. Chat-route fast path + route tests.
