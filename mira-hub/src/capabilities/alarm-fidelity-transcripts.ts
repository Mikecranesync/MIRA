/**
 * Turn a plain-text transcription of a synthetic alarm screen into the lines the fidelity
 * scorer reads (#4404), so any reader — a general AI chat asked to "transcribe this alarm
 * list exactly", or a person — is scored by the same grader as MIRA's photo step.
 *
 * Formatting only: code-fence lines, blank lines and surrounding whitespace go. Every
 * character inside a screen line is kept, so an invented or dropped character still counts.
 */
export type TranscriptScreen = "failsafe" | "rtd" | "history";
export type RunPhoto = { id: string; screen: TranscriptScreen; lines: string[] };

export function transcriptToLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("```"));
}

const TRANSCRIPT_FILE = /^(.+)\.(failsafe|rtd|history)\.txt$/;

/** `<id>.<screen>.txt` → one run.json photo; any other file name → null. */
export function photoFromTranscript(fileName: string, text: string): RunPhoto | null {
  const m = TRANSCRIPT_FILE.exec(fileName);
  if (!m) return null;
  return { id: m[1], screen: m[2] as TranscriptScreen, lines: transcriptToLines(text) };
}
