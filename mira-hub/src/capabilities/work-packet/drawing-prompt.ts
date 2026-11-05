/**
 * Work Packet — the one vision prompt for a photographed engineering drawing (title block, revision
 * history, connection tables, torque callouts, parts list), on paper or on a screen.
 *
 * Copy, never interpret: every cell is transcribed character for character, an unreadable character
 * is `[?]`, a cut-off cell keeps `[?]` for the lost part, and nothing is filled in from knowledge or
 * another row. The reply is JSON (`parseDrawingTranscription` in ./drawing). The transcription is an
 * unconfirmed reading until a technician reviews it against the photo.
 */

/** Output budget: a full connection table plus a parts list does not fit in the LOOK route's cap. */
export const DRAWING_TRANSCRIPTION_MAX_TOKENS = 4000;

export const DRAWING_TRANSCRIPTION_PROMPT = `You are transcribing ONE photograph a maintenance technician took. Return JSON only.
First classify the photo: "kind" is one of "drawing" (an engineering drawing or its title block, parts list or connection table, on paper or a screen), "nameplate", "equipment" (the machine itself), "reading" (a gauge, display or measurement), "job_sheet" (a work order, job card or checklist, including a maintenance-system screen), "manual_page", "other".
Then copy what is printed. COPY, do not interpret:
- Copy every value exactly as printed, character for character, including units, asterisks, dashes, colons, spaces and non-English text.
- If any character is unreadable, write [?] in its place. If a cell is cut off by the photo edge or blurred, write [?] for the unreadable part. Never fill a value from knowledge or from another row.
- null means the field is not in the photo at all.
JSON shape:
{"kind": string,
 "drawing": null | {
   "documentNo": string|null, "revision": string|null, "filenameShown": string|null,
   "title": string|null, "titleEnglish": string|null, "ride": string|null, "application": string|null, "sheet": string|null,
   "views": [string],
   "revisionHistory": [{"rev": string, "text": string, "date": string|null}],
   "connections": [{"id": string, "classText": string|null, "rows": [{"name": string|null, "type": string|null, "pos": string|null, "qty": string|null, "spec": string|null, "strength": string|null, "artNo": string|null}]}],
   "callouts": [{"ref": string, "torque": string|null, "notes": [string]}],
   "notes": [string],
   "bom": [{"pos": string|null, "qty": string|null, "drawingNo": string|null, "artNo": string|null, "description": string|null, "material": string|null, "standard": string|null}]
 },
 "otherText": [string],
 "unreadable": [string]}
"callouts" are leader labels such as "C3-B1 Ma=95 Nm Secure with <thread locker>": ref "C3-B1", torque "Ma=95 Nm", notes the lines printed under it. List each printed callout once per distinct ref + torque + notes.
"bom" is the parts list (item/position table) when one is in the photo; copy every row you can see, and name any rows you could not read in "unreadable". Never skip a visible table silently.
"unreadable" lists, in words, every region you could not read.`;
