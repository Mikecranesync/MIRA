# Alarm-screen reasoning on the phone — design (slice 1: RTD + fail-safe output wire break)

**Status:** revision 2, approved by Mike in chat 2026-10-12 ("go with A and continue") after he
sent a real HMI alarm-list photo that revision 1 could not have read (see §0). Next:
implementation plan (writing-plans), then build in §12 order.
**Owner of the decision:** Mike Harper.
**Path:** architectural (crosses the LOOK route, the notebook chat turn, new reference packs,
and the phone answer).

## 0. Revision 2 — what changed and why

A second real alarm screen (kept private; nothing from it is in this repo or sent to any cloud
model) showed four things revision 1 got wrong:

1. **Wrong family.** It was wire-break errors on fail-safe *output* channels of two modules,
   plus "F-I/O channel passivated" messages from the safety program. Revision 1 covered RTD only.
2. **Entries wrap.** Each alarm spans two or three visual lines: message on one line, the
   reference designation on the next. Passivation entries carry an F-runtime group and an F-I/O
   start address instead of a designation. Revision 1's parser required designation and message
   on one line, so it would have dropped every entry.
3. **Columns are cut off.** Times showed as `hh:mm:s…` and addresses as `NNN…`. A cut-off field
   is a "could not read", never a value — and a vision model tends to *complete* it.
4. **Duplicates.** Ten lines held five distinct alarms, each listed twice.

Also changed from review: check 3 of the RTD pack no longer reads as "open the panel and look at
the card" (it reads diagnostics on the HMI or online, read only), and the card leads with the
**first-out** alarm when the screen shows full times.

## 1. Why

A technician photographs a ride HMI alarm list. Today MIRA's photo step returns a plain-language
description ("a red alarm about a motor"), which loses the alarm tag, and nothing turns an alarm
list into a technician's first read of it.

Two worked evaluations of real alarm screens (kept private and local) showed that the reasoning
that makes such a read useful is a small set of **stable rules**, not model eloquence:

1. Read the alarm list **exactly**, group its visual lines into alarm records, and parse each:
   reference designation (track, function, location, device) or F-I/O address, and the message
   kind — an analog measurement compared to a limit, a channel diagnostic (wire break, overrange),
   a safety-program passivation, a discrete switch trip.
2. Apply a **failure-mode table** per family: an RTD reading high is either a real high
   temperature or an open / high-resistance loop; an output wire break is either an open circuit
   to the load or a load drawing less current than the channel needs to see it; a passivation is
   the safety program's *response* to a fault, not the fault.
3. Apply **cross-record rules**: several channels failing at the same visible time point first at
   something they share; a passivation next to wire breaks is most likely their consequence, but
   the screen never proves which passivation belongs to which channel.
4. Answer with an **honesty skeleton**: what the alarm is, two hypotheses, the first checks, what
   the photo does not prove, and what could not be read.

Per `.claude/rules/zero-token-architecture.md` (Hard Rule 2) stable reasoning is exported as
deterministic code and data; runtime inference stays only for perception (reading the photo).

## 2. Goal and success criteria

When a technician sends a phone photo of an HMI alarm list to an equipment notebook and asks about
it, MIRA returns an **alarm card**:

- **Alarm** — the leading record, text and designation exactly as transcribed, labelled "as read
  from your photo".
- **What it means** — the message kind in one sentence.
- **Two hypotheses** — from the family pack.
- **Shared cause** — only when the cross-record rule fires (§7).
- **Next three checks** — look-only and read-only (see §6), followed by one fixed site-procedure
  line.
- **Also on this screen** — the other covered records, duplicates collapsed with a count.
- **Expandable:** "What this does not prove" and "What I could not read".

Success for slice 1:

- **Transcription fidelity** measured on photographed synthetic alarm screens (§9), on three
  measures, across **every** photo in the run. The capture protocol (handheld, screen filling at
  least half the frame, angles and lighting listed in the run sheet) is fixed before the run; no
  photo is excluded afterwards.
  - (a) reference designations reproduced exactly on ≥ 90 % of alarm records — "exact" includes
    a cut-off marker (`…`) where the screen shows one;
  - (b) **zero** invented characters in cut-off fields: any completed truncation fails the gate
    on its own;
  - (c) records reproduced with the screen's boundaries and contents (case and punctuation
    ignored) on ≥ 90 % of records;
  - and the run has at least 10 photos — fewer is not a run.

  Below any threshold, slice 1 does not ship the card; the fallback in §4.3 is measured instead.
- The grouper and parser classify every record of the synthetic golden set correctly and let
  every line of the negative set fall through (§9).
- Every card passes the existing answer checker, `validateAnswer` in
  `mira-hub/src/capabilities/answer-validation.ts`, unmodified. The checker is never weakened to
  let a card through (see §7 for what the card does instead).
- The safety reviewer agent passes both packs and the card template; the energized-step check
  (`mira-hub/src/capabilities/step-energy.ts`) finds nothing in any card.

## 3. Non-goals (deferred, named)

- **Correlating alarms across photos over time** (history screens, earlier visits). Notebook
  follow-up slice.
- **Other families:** thermocouple, 4–20 mA, discrete switch / thermal-switch-only, fail-safe
  input discrepancy, PROFIsafe communication diagnostics beyond recognition, supply-voltage
  diagnostics. Each is its own pack.
- **Mapping an F-I/O start address to a module or channel.** That needs the hardware
  configuration or the drawings; the card says so instead of guessing.
- **Reference numbers** (IEC 60751 PT100 table, copper temperature coefficient, module minimum
  load currents) — only with a cited reference artifact the answer checker accepts.
- **The Telegram / Supervisor path** (`mira-bots`). The pack format is language-neutral JSON so the
  Python engine can read the same files later (ADR-0033, one brain); not built now.
- **A dedicated card component and an "Explain this alarm" chip** in the unified mobile shell
  (slice 2; needs a work claim on the shared-UI lane).
- Any site-specific display rule (e.g. "this HMI prints zeros in the active view") as a universal
  rule. Site knowledge is evidence, not code.

Not deferred but **forbidden**, in every slice: reintegration, acknowledgement, reset, forcing,
bypass, or disabling a diagnostic (§6).

## 4. Unit 1 — verbatim screen text from the photo

### 4.1 Change

The LOOK route (`mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts`) already makes one
vision call with `INSPECTION_PROMPT` and parses a JSON object `{observation, hazards}`. Add one
field to that same JSON contract:

```
"screen_text_lines": string[]   // on-screen text, transcribed verbatim, one entry per visual line,
                                // top to bottom; empty when no screen/display text is visible;
                                // characters that cannot be read are written as "?";
                                // text that is cut off on the screen keeps its "…" or "..." and
                                // is NEVER completed
```

The vision model only transcribes; grouping lines into alarm records is deterministic code (§5).
This is an observation (what is written on the screen), not a diagnosis, so LOOK's "observations
only" contract is unchanged. The existing observation and hazard instructions are unchanged. No
extra vision call; the only cost change is the transcribed lines' output tokens on photos that
show a screen.

### 4.2 Persistence

`recordLookObservation` (`mira-hub/src/lib/visual-evidence-context.ts`) already writes structured,
server-side vision output (`hazards`) into `evidence_item.capture_meta` (JSONB). The lines are
stored in that same `capture_meta` as `screen_text_lines`, normalized (trimmed, length-capped,
count-capped). **No migration.** Later turns read the stored lines; the photo is never re-sent to a
vision model for this purpose (`.claude/rules/materialized-evidence.md` rules 1, 3, 14). The field
is never accepted from the client.

`mira-hub/src/lib/**` is frozen by the lifecycle guard, so `visual-evidence-context.ts` is not
edited. A new module, `mira-hub/src/capabilities/screen-text.ts`, merges the lines into the
`capture_meta` of the evidence row `recordLookObservation` just returned (`evidence_item` allows
UPDATE for derived fields, migration 063). It reads them back by the `sessionId` of the photo's
already-verified LOOK row, so the existing verification is reused rather than re-implemented. The
write is fail-open like the observation write: without lines the card simply does not fire.

The vision call's output cap rises from 600 to 1600 tokens. A full alarm list plus the observation
does not fit in 600; a cut-off JSON reply would fail to parse and silently lose the observation.

### 4.3 Fidelity gate and fallback

Measured on the three measures of §2 (run in §9). If the vision model fails any of them, the
fallback is the existing server OCR client (`mira-hub/src/lib/photo-ocr.ts` →
`mira-bots/ask_api/ocr_extract.py`, `PHOTO_OCR_ENABLED`) producing the same `screen_text_lines`,
measured on the same photos — decided by measurement, not assumed.

## 5. Unit 2 — grouping and parsing

A pure, dependency-free module: `mira-hub/src/capabilities/alarm-line.ts`.

### 5.1 Grouping visual lines into records

```
groupAlarmRecords(lines: string[]): AlarmRecord[]

type AlarmRecord = {
  lines: string[];          // the visual lines of this record, verbatim
  number: string | null;    // the list's alarm/message number column, when present
  time: Field | null;       // e.g. "08:14:3…"
  date: Field | null;
  status: string | null;    // raw status token (I, O, IO, IA, IAO, K, KG, …), not interpreted
  text: string;             // the message text, continuation lines joined with a single space
  count: number;            // identical records collapsed (§5.3)
};
type Field = { text: string; truncated: boolean };
```

- A **record starts** at a line that begins with a row prefix (optional number, a time
  `hh:mm` / `hh:mm:ss` possibly cut off, optional date, optional status token) or with a
  message-start word (`Error:`, `Warning:`, `Fault:`, `Alarm:` and their German equivalents).
- **Every other line continues** the record above it. Lines before the first record (column
  headers such as "No. Time Date Status Text") are dropped as headers.
- A field ending in `…` or `...` is `truncated: true`. It is never completed and never parsed as
  a number.

### 5.2 Parsing a record

```
parseAlarmRecord(r: AlarmRecord): AlarmLine | null

type AlarmLine = {
  record: AlarmRecord;
  designations: Designation[];        // all designations in the text, e.g. "A / B" → two
  kind: "measurement_limit" | "switch_trip" | "resistance_test" | "io_diagnostic"
      | "safety_passivation" | "state" | "unknown";
  diagnostic: "wire_break" | "overrange" | "underrange" | null;
  channel: { io: "input" | "output"; number: number } | null;
  fGroup: string | null;              // "F-runtime group 1" → "1"
  fAddress: Field | null;             // "Start address of the F-I/O: 51…" → {text, truncated}
  quantity: "temperature" | "resistance" | "voltage" | "current" | "pressure" | null;
  subject: string | null;             // e.g. "RIGHT WINDING"
  direction: "high" | "low" | null;
  value: { shown: true; number: number; unit: string | null }
       | { shown: false; reason: "not_displayed" | "zero_and_zero_limit" | "unreadable" | "truncated" };
  limit: { number: number; unit: string | null } | null;
};

type Designation = {                  // IEC 81346-style; examples here are invented
  raw: string;                        // "=y.CTL+07-K4.1-2."
  track: string | null;               // "=1." / "=2." / "=y." prefix
  func: string | null;                // "CTL"
  location: string | null;            // "+07"
  device: string | null;              // "-K4.1-2"
};
```

Rules:

- A record parses only when it has a recognized message kind **and** an identifier: a
  designation, or (for `safety_passivation`) an F-runtime group or F-I/O address. Anything else
  returns `null` and is reported under "could not read" when it looks alarm-like.
- When a record carries several designations (`A / B`), all are kept; the most specific (longest
  device) is the one quoted first.
- `value` with both value and limit equal to 0 (or blank) becomes
  `{shown:false, reason:"zero_and_zero_limit"}`: the reading is not on this view. This is generic
  (a zero reading against a zero limit cannot have tripped a compare), not a rule about one HMI.
- OCR-style misreads are not "corrected" into a tag. A designation with `?` characters is kept as
  read and flagged.
- Vocabulary is data (a keyword table in the same module): "temperature measurement", "resistance
  measurement", "too high", "too low", "tripped", "wire break", "overrange", "underrange",
  "output channel", "input channel", "F-I/O channel passivated", "F-runtime group", "start address
  of the F-I/O", plus German equivalents. German strings are taken from vendor message texts
  during implementation and cited in the table, not guessed.

### 5.3 Duplicates

Records with the same number, text, and designations collapse into one with `count`. The card
shows "(×2)". A duplicate is not evidence of a second event: the card does not say the alarm
"came twice", because the list may simply repeat it.

## 6. Unit 3 — the alarm packs

Versioned data files under `mira-hub/src/capabilities/alarm-packs/`, one per family, loaded and
validated by one loader, `alarm-packs/loader.ts` (pattern: `mira-hub/src/lib/drive-packs/`):

- `rtd.v1.json` — RTD measurement alarms.
- `fail-safe-output.v1.json` — wire break on output channels, and safety-program passivation.

Keyed by `(kind, quantity | diagnostic, direction | io)`. Slice 1 entries:

| Key | Hypothesis 1 | Hypothesis 2 |
|---|---|---|
| measurement_limit · temperature · high | the measured point really is above its limit | the RTD loop is open or high-resistance (lead, terminal, joint, element); this also raises a wire-break / overrange diagnostic on the input channel |
| measurement_limit · temperature · low | the measured point really is below its limit | the RTD or its leads are shorted, or the channel is configured for the wrong sensor type |
| io_diagnostic · wire_break · input (analog) | open circuit in the field loop | a failed input channel |
| io_diagnostic · wire_break · output | an open circuit between the output and its load: wire, terminal, connector, or the load's own coil or element | the load is connected but draws less current than the channel needs to detect it (for example after an actuator or relay was replaced with a different type) |
| safety_passivation (alone on the screen) | a channel or module fault the module reported to the safety program | a communication fault between the controller and the module; the diagnostic buffer tells these apart |

**What a passivation means** (fixed text): "The safety program switched this channel to its
fail-safe value because of a fault it was told about: an output channel goes off, an input
channel reads as its safe value. It stays there while the fault is present." Passivation happens
on fail-safe inputs too, so the text never claims an output went off. Nothing about how it
comes back.

Each entry also carries:

- **checks** — exactly three, look-only and read-only, in order:
  - RTD:
    1. Read the actual value and the time of the alarm from the alarm history or diagnostic view.
    2. Compare the sibling channel at the same location (e.g. the other sensor of a left/right pair).
    3. Read the input channel's diagnostic (wire break / overrange / underrange) on the HMI
       diagnostics page or online in the engineering software — in view mode only — do not enter configuration or change any setting in the controller.
  - Fail-safe output:
    1. Read the full time of each alarm, to the second, from the alarm history or the
       controller's diagnostic buffer, to see which came first.
    2. Read the module and channel diagnostics on the HMI diagnostics page or online in the
       engineering software — in view mode only — do not enter configuration or change any setting in the controller.
    3. On the drawings, find what each listed channel drives and what those circuits share
       (cable, connector, junction box, load supply).
- **site_procedure_line** — fixed text, always the **last line of the card** (after every other
  section, see §7):
  "Anything that opens an enclosure or touches the circuit follows your site's lockout procedure
  with the equipment out of service."
- **does_not_prove** — e.g. "a sensor fault", "an over-temperature", "that a wire is broken",
  "which alarm came first", "what the outputs drive", "the cause".
- **pack metadata** — `pack_id`, `version`, `source: "MIRA engineering reference"`,
  `invalidated_by` (e.g. a reviewed edit to the entries).

No numeric reference values in slice 1.

**Banned in every pack, enforced by the loader** (a pack whose text matches is rejected; a test
pins each pattern, and the safety reviewer's brief lists them):

- bypass, jumper, bridge out, force, override, substitute / substitution, simulate;
- reset, clear the alarm, acknowledge, reintegrate, depassivate, `ACK_REI`;
- turning a diagnostic off: deactivate / disable wire break, disable diagnostics, parameterize
  off, change the hardware configuration or F-parameters, download;
- adding a resistor or load to satisfy the channel (load resistor, pull-down, dummy load).
- running or performing a test or diagnostic on the circuit (insulation, resistance — hands-on work);
- restoring, reactivating, enabling or bringing back a channel (safety review 2026-10-12).

The "draws too little current" hypothesis may stay; a resistor never appears as a check.

## 7. Unit 4 — the alarm card

`mira-hub/src/capabilities/alarm-card.ts`:

```
buildAlarmCard(lines: string[], packs: AlarmPack[]): AlarmCard | null
```

Deterministic; no model in its path. It groups (§5.1), parses (§5.2), collapses duplicates
(§5.3), and returns `null` when no record parses as an alarm a pack covers. Rendering rules:

- **One card per photo.** It leads with one covered record:
  - a passivation never leads when a covered cause record (e.g. a wire break) is on the screen —
    the consequence does not head the card;
  - **first-out:** when every candidate record shows a complete time to the second and they all
    show the same date (dates are not compared, because `10/8` reads two ways), lead with the
    earliest;
  - otherwise lead with the top candidate record, and the card says: "This screen cuts off the
    times, so it can't show which alarm came first — read it from the alarm history." (or, when
    the times are complete but the dates differ, that the order must be read from the history).
  - Other covered records go under "Also on this screen" with their count. Alarm-like records
    that did not parse go under "What I could not read".
- **Cross-record rules** (fixed wording, from the fail-safe output pack):
  - *Shared cause:* when two or more distinct wire-break records (different channel or different
    designation) show the same visible time, add: "Several channels came in at the same time on
    this screen — look first for something they share (cable, connector, junction box, load
    supply) before chasing separate faults." "Same visible time" compares the text as shown,
    cut-off included, and the sentence says "on this screen".
  - *Consequence:* when wire-break and passivation records are both present, add: "The passivation
    messages are most likely the safety program's response to these wire breaks. This screen
    doesn't show which passivation belongs to which channel." Passivations are never paired to a
    channel by address or by position in the list.
- The alarm is quoted verbatim with "as read from your photo". Values are shown only when
  `value.shown` is true; otherwise "The reading isn't shown on this screen — read it from the
  alarm history." Cut-off fields are listed under "What I could not read" by name ("the times are
  cut off at the seconds", "the F-I/O start addresses are cut off").
- **Answer-checker compatibility (decided by test, not assumed).** Every card goes through
  `validateAnswer` like any other answer. The card's own interpretive sentences never contain the
  designation token (it appears only inside the quoted alarm line), so no sentence asserts what a
  code "means". If the checker blocks a quoted value or unit, the card omits the value and says
  "the value is on your photo" instead; the checker is not changed.
- **Section order is fixed:** Alarm → What it means → Two hypotheses → Shared cause / consequence
  (when present) → Next three checks → Also on this screen → What this does not prove → What I
  could not read → site-procedure line. The site-procedure line comes last so the energized-step
  check (`step-energy.ts`), which treats an isolation statement as in force for everything after
  it, never reads quoted alarm text as a step performed under lockout. A snapshot case with
  realistic co-alarms (automatic stop, e-stop reset) pins this.
- **Absence is never asserted.** When a pack names a companion signal (e.g. a thermal-switch trip
  at the same location) and none is on the screen, the card says "No matching thermal-switch trip
  is visible in this photo", never "not tripped".
- **Asset context.** The turn is inside an equipment notebook (an asset-scoped surface). The card
  reads the photo only: it never asserts that a designation on the screen is the notebook's asset.
- The card cites the photo (existing visual-evidence marker) and the pack ("MIRA engineering
  reference — fail-safe output v1").

## 8. Unit 5 — where it runs

A fast path in the notebook chat turn
(`mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`), following
`.claude/rules/fast-path-optimization.md`:

- **Trigger:** the turn carries a verified visual observation (`verifyVisualEntry`) whose stored
  `screen_text_lines` produce a card, **and** the question is about the photo: it is empty, or
  it quotes a designation that appears in the lines, or it matches a short fixed list of
  alarm-intent phrases ("this alarm", "these alarms", "what does this mean", "why is this
  alarming", "what is this fault", "what is this error"). Any other question falls through to
  the normal answer.
- **Client path (verified on main 2026-10-12):** the unified phone shell's attachment flow
  (`mira-mobile/src/unified/attachments.ts`) calls LOOK, then sends the question with a
  `visualEvidence: {fileId, capturedAt}` rider, which the chat route verifies. No client change
  is needed for slice 1.
- **Read-only:** no writes beyond the existing turn ledger.
- **Reuses seams:** visual-evidence loading, the turn ledger, `answer-validation.ts`,
  `step-energy.ts`, the existing answer renderer on the phone.
- **Falls through** on any miss or error to the normal grounded answer, unchanged.
- **Evidence:** a typed entry `{kind:"alarm_reading", fileId, packIds, packVersions,
  records:[…parsed]}` rides in the turn's `evidence[]` next to the existing `visual_observation`
  entry (same discriminated-union pattern as `notebook-chat-types.ts`; readers that do not know
  the kind skip it).
- **Not live until the gate passes.** The unit-5 PR stays a draft until the fidelity run (§9)
  passes; units 1–4 change nothing a technician sees.

Slice 1 delivers the card as the turn's answer text with fixed section headings through the
existing renderer. No change to guarded legacy UI paths.

## 9. Testing

Hermetic, no network, no customer material (Mike's decision 2026-10-12: synthetic strings only).
**No customer photo is ever sent to LOOK or any cloud vision model, including for fidelity
checks.**

- **Golden set:** ~40 synthetic alarm records covering every `kind`, both directions, shown and
  not-shown values, `=1.` / `=2.` / `=y.` tracks, German vocabulary, `?` misreads, plus: wrapped
  two- and three-line records, passivation records with F-group and cut-off F-address, cut-off
  times, duplicate rows, a column-header line, and a screen with wire breaks on several channels
  across two modules. Invented designations of the same shape only (e.g. `=y.CTL+07-K4.1-2.`).
- **Negative set:** ordinary screen text (menus, timestamps alone, operator banners, part numbers)
  that must never produce a card.
- **Card snapshots** for each golden screen.
- **Guards:** every card passes `answer-validation.ts` (no unsourced number) and has zero
  `step-energy.ts` findings; the loader rejects every banned pattern of §6 (one test per pattern,
  each shown to fail when the pattern is removed from the ban list — `.claude/rules/prove-the-test-fails.md`).
- **Route tests:** fast path claims the turn when lines produce a card; falls through on no lines,
  unparsable lines, an unrelated question, or a thrown error.
- **Fidelity measurement (one run, declared cap $1.00):** a synthetic HMI alarm page — same layout
  as the real screens (wrapped entries, cut-off columns, duplicate rows, red unacknowledged rows,
  one selected row), invented tags — shown on a laptop or tablet and **photographed by Mike with
  the Pixel** following a fixed run sheet (angles, glare, moiré). The photos go through the LOOK
  vision call; report the three §2 measures per photo. The emulator has no camera, so this step is
  Mike's; it does not block units 1–4. Re-run only when the vision model or `INSPECTION_PROMPT`
  changes.
- **Safety review:** the `safety-reviewer` agent reviews both packs, the banned list, and the card
  template before merge.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Vision transcription paraphrases or drops characters in tags | Fidelity measure (a); `?` for unreadable characters; never "correct" a tag |
| Vision model completes cut-off text ("…" → invented digits) | Fidelity measure (b), zero tolerance; prompt says never complete |
| Lines grouped into the wrong records | Deterministic grouper; golden wrapped-record cases; fidelity measure (c) |
| A card reads as permission to work on the circuit | Look-only, read-only checks; fixed site-procedure line; banned list; safety review |
| A card suggests reintegrating, resetting, or turning a diagnostic off | Banned list in the loader, one test per pattern; nothing in any pack about how a passivated channel comes back |
| Passivation paired to the wrong channel | Never paired; consequence sentence says the screen doesn't show the pairing |
| Absence on a partial screen read as proof | "Not visible in this photo" wording rule, tested |
| Over-triggering on non-alarm screens | Kind **and** identifier required; negative set |
| Packs drift into a second registry | One pack folder under capabilities, one loader, same pattern as drive packs; no new table |

## 11. Rollback

Each unit is additive. Removing the fast-path call restores today's behaviour; the extra
`screen_text_lines` field is ignored by every existing reader.

## 12. Implementation order

0. **Separate small PR, first:** the LOOK route logs the declared and sniffed type when it
   rejects an image, and returns the detected type in the 415 body. It touches the same file as
   step 1, so it lands first. No phone change.
1. `screen_text_lines` in the LOOK contract + persistence, with hermetic tests on fixture vision
   replies.
2. `alarm-line.ts` (grouping, parsing, duplicates) + golden/negative tests.
3. `alarm-packs/` (`rtd.v1.json`, `fail-safe-output.v1.json`) + loader + banned-pattern guard +
   safety review.
4. `alarm-card.ts` + snapshots + answer-validation / step-energy guards.
5. Chat-route fast path + route tests — **draft until step 6 passes.**
6. Synthetic alarm page + capture run sheet → Mike photographs → fidelity run ($1.00 cap) → ship
   decision; below threshold, measure the OCR fallback on the same photos.
