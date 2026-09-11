/**
 * PlatformAdapter for the unified shell inside the Capacitor app.
 *
 * Every capability routes to the screen's EXISTING flows (LOOK photo path,
 * two-step PDF source upload, citation sheet) — the shell never fetches,
 * uploads, or persists. Photo/file return `null` because those flows own the
 * attachment end to end (they upload and ask); the shell therefore shows no
 * "pending" chip for them, which is the honest state.
 */
import { Share } from "@capacitor/share";
import type { PlatformAdapter } from "@factorylm/interaction";

export interface UnifiedAdapterHandlers {
  readonly onAttachPhoto: () => void;
  readonly onAttachFile: () => void;
  /** Capture photo from native camera (not gallery). */
  readonly onAttachCamera: () => void;
  /** Present when the notebook is not yet bound and the app can scan a machine QR. */
  readonly onScanMachine?: () => Promise<string | null> | string | null;
  /** Text to share for an artifact id (handoff/report) — the screen owns the content. */
  readonly shareText?: (artifactId: string) => string | null;
}

export function createCapacitorAdapter(handlers: UnifiedAdapterHandlers): PlatformAdapter {
  return {
    attachPhoto: async () => {
      handlers.onAttachPhoto();
      return null;
    },
    attachFile: async () => {
      handlers.onAttachFile();
      return null;
    },
    attachCamera: async () => {
      handlers.onAttachCamera();
      return null;
    },
    scanMachine: async () => (handlers.onScanMachine ? await handlers.onScanMachine() : null),
    shareArtifact: async (artifactId) => {
      const text = handlers.shareText?.(artifactId) ?? null;
      if (!text) return "cancelled";
      try {
        await Share.share({ text });
        return "shared";
      } catch {
        return "cancelled";
      }
    },
    // The app-level backButton listener drains lib/transient-layer.ts first;
    // UnifiedChat registers open shell layers there, so by the time the shell
    // consults the adapter nothing is open and the tab stack should decide.
    onBack: () => "pass",
  };
}
