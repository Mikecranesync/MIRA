import type { ReactNode } from "react";

/**
 * #4751: the sent bubble rendered the technician's own text as a single
 * run-on paragraph — a Shift+Enter line break or a pasted numbered list both
 * collapsed, because a plain text node's default CSS whitespace handling
 * drops them. Plain text only (no markdown, no dangerouslySetInnerHTML — a
 * pasted "1. …" list must read back exactly as typed, not become a list);
 * `white-space: pre-wrap` is set inline here, not in shared `conversation.css`
 * (#4677 has a live diff on `.fl-part--text` there).
 */
export function UserTurnText({ text }: { readonly text: string }): ReactNode {
  return <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>;
}
