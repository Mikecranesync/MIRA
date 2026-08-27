// Platform file handoff (Commodity PRD §8, Phase 3 item 3).
//
// The audit's mechanism finding (docs/architecture/mobile-commodity-convergence.md
// §3.2): the "Open with another app" / "Open in your PDF viewer" buttons were
// blob-URL `<a download>` anchors — Android WebView ignores those without a
// native DownloadListener, so on device they did NOTHING (same silent-dead-
// button class as #3427). Commodity-before-custom says the OS owns "open this
// file": write the bytes to app cache and present the system share sheet
// (viewer apps included) via the official plugins — @capacitor/filesystem +
// @capacitor/share, both MIT.
//
// Size honesty: native writeFile takes base64 (Blob is web-only), which
// materializes ~4/3 of the file as a string on the way through the bridge —
// the exact copy native-pick.ts avoids on the way IN. A 64 MB cap keeps the
// worst case bounded; a larger file reports "too large to hand off" instead
// of freezing the WebView. Streaming handoff is a future upgrade if real
// manuals hit the cap.
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export const HANDOFF_MAX_BYTES = 64 * 1024 * 1024;

export function handoffTooLarge(sizeBytes: number): boolean {
  return sizeBytes > HANDOFF_MAX_BYTES;
}

/** Cache filenames come from server data — keep them filesystem-safe without
 *  losing the extension the viewer app picks its handler by. */
export function safeHandoffName(filename: string): string {
  const cleaned = filename.replace(/[^\w.-]+/g, "_").replace(/^[_.]+/, "");
  return cleaned || "document";
}

/** True when the platform share/open door exists — i.e. we are on the device.
 *  Web keeps its `<a download>` anchor, which browsers handle natively. */
export function canHandOffNatively(): boolean {
  return Capacitor.isNativePlatform();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(blob);
  });
}

export type HandoffResult = "shared" | "too_large" | "failed";

/**
 * Hand authenticated bytes (a blob: URL from useFileBytes) to the OS.
 * "shared" covers user-cancel too — the sheet was presented, the choice is
 * theirs. The caller keeps an honest message for the other outcomes.
 */
export async function openWithDevice(blobUrl: string, filename: string): Promise<HandoffResult> {
  try {
    const blob = await (await fetch(blobUrl)).blob();
    if (handoffTooLarge(blob.size)) return "too_large";
    const written = await Filesystem.writeFile({
      path: `handoff/${safeHandoffName(filename)}`,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    try {
      await Share.share({ title: filename, url: written.uri });
    } catch {
      // Android rejects on user cancel — the handoff surface was still
      // presented, which is all this function promises.
    }
    return "shared";
  } catch {
    return "failed";
  }
}
