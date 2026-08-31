// Which conversation surface the technician gets (PRD §12.4 feature flag,
// mobile lane). Device-local, readable synchronously after first load, and
// purged on sign-out with every other `flm.*` key.
//
// Default ON: the new surface is the product direction, and the legacy screen
// stays reachable from More → "Chat style" so a single tap gets the old one
// back if anything looks wrong on the floor. That is the rollback lever on the
// device; the server-side capability gate (`chat_v2` on /api/me) remains the
// lever for a fleet, and is deliberately NOT invented here — this build ships
// to one phone under a device-test carve-out, and a fake capability check
// would be a second, lying flag surface.
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
export function useChatV2Enabled(): boolean | null {
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
  return choice === null ? null : choice === "v2";
}
