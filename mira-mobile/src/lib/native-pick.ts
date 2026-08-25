/**
 * The picker seam: ask the PHONE for a file, not the WebView.
 *
 * Why this exists. The nameplate photo and the PDF attach both used a hidden
 * `<input type="file" accept="image/*" capture="environment">`. In a browser
 * that is the right thing. Inside an Android WebView it is a request, not an
 * instruction — the system decides what surface to show, and it showed a
 * chooser rather than the phone's own picker (#3353). A technician on a plant
 * floor should get the picker their phone always gives them.
 *
 * So on device we call the platform picker directly and hand the caller a plain
 * `File`. Off device we return null and say so via `canPickNatively()`, and the
 * caller keeps its existing `<input>` — the web build is unchanged.
 *
 * Bytes, in preference order:
 *   1. `blob`  — the plugin already read it (this is the web implementation).
 *   2. `path`  — a device path. `Capacitor.convertFileSrc` turns it into a URL
 *                the WebView may fetch, which streams instead of materialising
 *                a base64 copy. An 80 MB manual should not become a ~107 MB
 *                string on the way in.
 *   3. `data`  — base64, last resort.
 *
 * Cancelling is not an error. Every failure path returns null so a caller can
 * never be left with a spinner it cannot clear.
 */
import { Capacitor } from "@capacitor/core";
import { FilePicker } from "@capawesome/capacitor-file-picker";

export const PDF_MIME = "application/pdf";

/** Shape we rely on; the plugin returns more than this. */
interface PickedFile {
  name?: string;
  mimeType?: string;
  path?: string;
  data?: string;
  blob?: Blob;
}

/** True when the platform picker is available — i.e. we are on the device. */
export function canPickNatively(): boolean {
  return Capacitor.isNativePlatform();
}

/** Returns an ArrayBuffer, not a view: a view's buffer may be shared, which is
 *  not a BlobPart. */
function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return buf;
}

async function toFile(picked: PickedFile, fallbackName: string, forceMime?: string): Promise<File | null> {
  const name = picked.name?.trim() || fallbackName;
  const type = forceMime ?? picked.mimeType ?? "application/octet-stream";

  if (picked.blob) return new File([picked.blob], name, { type });

  if (picked.path) {
    // A device path is not fetchable as-is; convertFileSrc makes it readable.
    const res = await fetch(Capacitor.convertFileSrc(picked.path));
    return new File([await res.blob()], name, { type });
  }

  if (picked.data) return new File([base64ToBytes(picked.data)], name, { type });

  return null;
}

async function pickOne(
  run: () => Promise<{ files?: PickedFile[] }>,
  fallbackName: string,
  forceMime?: string,
): Promise<File | null> {
  if (!canPickNatively()) return null;
  try {
    const res = await run();
    const first = res?.files?.[0];
    if (!first) return null; // backed out
    return await toFile(first, fallbackName, forceMime);
  } catch {
    // Cancel surfaces as a rejection on some hosts, and a genuine failure must
    // not strand the caller either. Both mean "no file".
    return null;
  }
}

/** The nameplate photo, from the phone's own image picker. */
export function pickNameplatePhoto(): Promise<File | null> {
  return pickOne(() => FilePicker.pickImages({ limit: 1 }), "nameplate.jpg");
}

/**
 * A PDF, from the phone's own document picker. The mime is forced: Android
 * hands back `application/octet-stream` often enough that trusting it would
 * route a real manual down the "stored, not indexed" path.
 */
export function pickPdf(): Promise<File | null> {
  return pickOne(() => FilePicker.pickFiles({ types: [PDF_MIME], limit: 1 }), "document.pdf", PDF_MIME);
}
