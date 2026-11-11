import type { ReactNode } from "react";
import { generalSafetyReminder } from "@/capabilities/general-safety-reminder";
import { splitLeadingSafetyNotes } from "./hub-host-logic";

/**
 * #4690: an answer whose leading ⚠️ lines (the server's safety banners) render
 * in the shell's warning block, set apart from the answer below. Without one,
 * the answer renders exactly as before. `markdown` renders each piece with the
 * turn's own citation marks. Exact historical generic banners are normalized
 * for display (#5408); stored text and manual quotations are left intact.
 */
export function AnswerWithSafety({ text, markdown }: { text: string; markdown: (content: string) => ReactNode }): ReactNode {
  const { notes, body } = splitLeadingSafetyNotes(text);
  if (!notes) return markdown(text);
  // Historical generic banners may have borrowed a retrieved page (#5408).
  // Render them honestly without rewriting the saved turn or manual notices.
  const reminders = notes.split(/\n(?:[ \t]*\n)+/).map(generalSafetyReminder).join("\n\n");
  return (
    <>
      <div className="fl-safety fl-safety--text" role="note" aria-label="Safety warning">{markdown(reminders)}</div>
      {body ? markdown(body) : null}
    </>
  );
}
