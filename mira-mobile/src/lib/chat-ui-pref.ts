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

/** "v2" (default), "legacy", or "unified" (the shared FactoryLM shell,
 *  FLM-UI-4000 Phase 2). Unknown/absent values read as v2. */
export type ChatUiChoice = "v2" | "legacy" | "unified";

export function parseChoice(raw: string | null | undefined): ChatUiChoice {
  return raw === "legacy" ? "legacy" : raw === "unified" ? "unified" : "v2";
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

/** Which surface to render. Null while the preference loads (render nothing,
 *  never a flash of the other surface). Without the server capability every
 *  choice collapses to "legacy" — the flag reveals, it never grants. */
export function useChatUiChoice(available: boolean): ChatUiChoice | null {
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
  // The unified shell is a device-local BETA opt-in that uses the classic
  // send path; it needs no server capability. v2 still requires `chat_v2`.
  if (!available) return choice === null ? null : choice === "unified" ? "unified" : "legacy";
  return choice;
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
