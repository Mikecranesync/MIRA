/**
 * Build a fidelity run.json from plain-text transcripts of the synthetic alarm screens
 * (#4404), so a general AI chat — or any other reader — is scored with the same grader
 * (score-run.ts) as MIRA's photo step.
 *
 * Put one transcript per photo in a folder, named <id>.<screen>.txt where <screen> is
 * failsafe, rtd or history (e.g. chatgpt-1.failsafe.txt). Ask the reader to "transcribe
 * this alarm list exactly, one screen line per line". Synthetic screens only — never a
 * photo of a real plant screen.
 *
 * Run:  cd mira-hub && npx vite-node ../tools/alarm-fidelity/transcripts-to-run.ts <dir> > run.json
 *       npx vite-node ../tools/alarm-fidelity/score-run.ts run.json
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { photoFromTranscript, type RunPhoto } from "../../mira-hub/src/capabilities/alarm-fidelity-transcripts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: transcripts-to-run.ts <folder of <id>.<screen>.txt files>");
  process.exit(2);
}
const photos = readdirSync(dir)
  .sort()
  .map((name) => photoFromTranscript(name, readFileSync(join(dir, name), "utf8")))
  .filter((p): p is RunPhoto => p !== null);
if (photos.length === 0) {
  console.error(`no <id>.<screen>.txt transcripts in ${dir}`);
  process.exit(2);
}
process.stdout.write(`${JSON.stringify({ photos }, null, 2)}\n`);
