/**
 * V6 PlatformAdapter for the Capacitor mobile app.
 *
 * Routes to mobile-specific capabilities (photo, file, machine scan) while
 * supporting no-machine mode — technicians can ask general questions before
 * selecting a machine.
 */
import { Share } from "@capacitor/share";
import type { PlatformAdapter } from "@factorylm/interaction";

export interface V6AdapterHandlers {
  readonly onAttachPhoto: () => void;
  readonly onAttachFile: () => void;
  /** Scan a machine QR code — available even when no machine is selected. */
  readonly onScanMachine?: () => Promise<string | null>;
  /** Text to share for an artifact id — the screen owns the content. */
  readonly shareText?: (artifactId: string) => string | null;
}

export function createV6Adapter(handlers: V6AdapterHandlers): PlatformAdapter {
  return {
    attachPhoto: async () => {
      handlers.onAttachPhoto();
      // Return null because the screen owns the upload flow end-to-end
      return null;
    },
    attachFile: async () => {
      handlers.onAttachFile();
      return null;
    },
    scanMachine: async () => (handlers.onScanMachine ? handlers.onScanMachine() : null),
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
    // Hardware back is handled at the app level via transient layers
    onBack: () => "pass",
  };
}
