import { PhotoThumb } from "@factorylm/ui";
import { useFileBytes } from "../api/use-file-bytes";

/** Platform owns authenticated bytes; shared UI owns photo presentation. */
export function OriginalPhoto({ fileId }: { fileId: string }) {
  const { state, bytes } = useFileBytes(fileId);
  if (state === "error") return <p role="alert">Could not load the original photo. Close and reopen the review to retry.</p>;
  if (state !== "ready" || !bytes) return <p role="status">Loading the original photo…</p>;
  if (!bytes.contentType.startsWith("image/")) return <p role="alert">The original file is not an image.</p>;
  return <PhotoThumb className="fl-photo" src={bytes.url} alt="Original photo" />;
}
