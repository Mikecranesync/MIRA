import { Alert } from "react-native";
import { keepMobilePhoto } from "../unified/keep-photo";

export function keepUnifiedChatPhoto(
  fileId: string,
  meta: { notebookId: string },
  attachmentThreadId: string | null | undefined,
  request: MobileKeepPhotoDeps["request"],
  refreshPromotedScope: () => Promise<boolean | null>,
): Promise<void> {
  return keepMobilePhoto(fileId, {
    notebookId: meta.notebookId,
    threadId: attachmentThreadId ?? null,
    request,
    refresh: refreshPromotedScope,
    review: (proposed) => new Promise((resolve) => {
      const title = "Check this reading against the photo. Edit any wrong tags before keeping.";
      if (typeof Alert.prompt === "function") {
        Alert.prompt(
          title,
          undefined,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
            { text: "Keep", onPress: (text?: string) => resolve(text == null ? proposed.reading : text) },
          ],
          "plain-text",
          proposed.reading,
        );
        return;
      }
      Alert.alert(title, proposed.reading, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        { text: "Keep", onPress: () => resolve(proposed.reading) },
      ]);
    }),
  });
}

import type { MobileKeepPhotoDeps } from "../unified/keep-photo";
