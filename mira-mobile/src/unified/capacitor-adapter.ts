/**
 * PlatformAdapter for the unified shell inside the Capacitor app.
 *
 * Attachment capabilities RETURN the attachment they captured, so the shell's
 * composer can show a pending chip and the user decides when to send — the
 * ChatGPT-shaped flow. They used to return `null` unconditionally because the
 * screen's flows uploaded AND asked in one motion, which left the technician no
 * chance to type the question that goes with the photo.
 *
 * The screen still owns every byte: these handlers call the screen's existing
 * upload doors (LOOK for photos, the namespace files endpoint for documents),
 * so there is still exactly one upload path and the shell never fetches,
 * uploads, or persists anything itself.
 */
import { Share } from "@capacitor/share";
import type { Attachment, PlatformAdapter } from "@factorylm/interaction";

/** What a screen's attach handler resolves to: the captured attachment, or
 *  `null` when the user backed out of the native picker or it failed. */
export type AttachResult = Attachment | null;

export interface UnifiedAdapterHandlers {
  readonly onAttachPhoto: () => Promise<AttachResult> | AttachResult;
  readonly onAttachFile: () => Promise<AttachResult> | AttachResult;
  /** Capture photo from native camera (not gallery). */
  readonly onAttachCamera: () => Promise<AttachResult> | AttachResult;
  /** Present when the notebook is not yet bound and the app can scan a machine QR. */
  readonly onScanMachine?: () => Promise<string | null> | string | null;
  /** Text to share for an artifact id (handoff/report) — the screen owns the content. */
  readonly shareText?: (artifactId: string) => string | null;
}

export function createCapacitorAdapter(handlers: UnifiedAdapterHandlers): PlatformAdapter {
  return {
    attachPhoto: async () => (await handlers.onAttachPhoto()) ?? null,
    attachFile: async () => (await handlers.onAttachFile()) ?? null,
    attachCamera: async () => (await handlers.onAttachCamera()) ?? null,
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
