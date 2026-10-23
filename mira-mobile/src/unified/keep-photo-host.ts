/**
 * UnifiedChat Keep host: review-before-store + failed-refresh honesty.
 * Kept out of UnifiedChat.tsx so the screen file does not import mira-hub.
 */
import { Alert } from "react-native";
import { keepMobilePhoto, type MobileKeepPhotoDeps } from "./keep-photo";

export async function onKeepUnifiedPhoto(
  fileId: string,
  deps: Omit<MobileKeepPhotoDeps, "review">,
): Promise<void> {
  if (!deps.notebookId) throw new Error("no_notebook");
  await keepMobilePhoto(fileId, {
    ...deps,
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
      Alert.alert(
        title,
        proposed.reading,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
          { text: "Keep", onPress: () => resolve(proposed.reading) },
        ],
      );
    }),
  });
}
