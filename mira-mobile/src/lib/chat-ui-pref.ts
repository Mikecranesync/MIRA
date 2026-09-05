// Which conversation surface the technician gets (PRD §12.4 feature flag,
// mobile lane). Device-local, readable synchronously after first load, and
// purged on sign-out with every other `flm.*` key.
//
// Default ON only INSIDE the server-authorized `chat_v2` capability. More →
// "Chat style" is a device preference; it can opt an allowed user back to the
// classic surface, but it can never grant ChatV2 or override a fleet rollback.
import { preferencesStore } from "./offline-queue";
import { useEffect, useState } from "react";

export const CHAT_UI_KEY = "flm.chatui.v1";

/** "v2" (default) or "legacy". Unknown/absent values read as v2. */
export type ChatUiChoice = "v2" | "legacy";

export function parseChoice(raw: string | null | undefined): ChatUiChoice {
  return raw === "legacy" ? "legacy" : "v2";
}

export async function readChatUiChoice(): Promise<ChatUiChoice> {
  try {
    return parseChoice(await preferencesStore.get(CHAT_UI_KEY));
  } catch {
    return "v2";
  }
}

export async function writeChatUiChoice(choice: ChatUiChoice): Promise<void> {
  try {
    await preferencesStore.set(CHAT_UI_KEY, choice);
  } catch {
    /* a preference that won't persist must never break the conversation */
  }
}

/** Null while the preference is still loading, so the screen renders one
 *  surface — never a flash of the other. */
export function useChatV2Enabled(available: boolean): boolean | null {
  const [choice, setChoice] = useState<ChatUiChoice | null>(null);
  useEffect(() => {
    let live = true;
    void readChatUiChoice().then((c) => {
      if (live) setChoice(c);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!available) return false;
  return choice === null ? null : choice === "v2";
}
