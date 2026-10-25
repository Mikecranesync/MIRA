import type { ReactNode } from "react";
import { splitLeadingSafetyNotes } from "./hub-host-logic";

/**
 * #4690: an answer whose leading ⚠️ lines (the server's safety banners) render
 * in the shell's warning block, set apart from the answer below. Without one,
 * the answer renders exactly as before. `markdown` renders each piece with the
 * turn's own citation marks.
 */
export function AnswerWithSafety({ text, markdown }: { text: string; markdown: (content: string) => ReactNode }): ReactNode {
  const { notes, body } = splitLeadingSafetyNotes(text);
  if (!notes) return markdown(text);
  return (
    <>
      <div className="fl-safety fl-safety--text" role="note" aria-label="Safety warning">{markdown(notes)}</div>
      {body ? markdown(body) : null}
    </>
  );
}
