/**
 * The technician's photo shows as a picture on the phone, as it does on /v3
 * (parity row 4, Pixel acceptance 2026-10-07): a thumbnail on their own
 * question, and the picture on the answer's photo-observation card instead of
 * a raw file id.
 *
 * /v3 points an <img> at the authenticated file route, which its session
 * cookie unlocks. The phone's session lives in the native cookie jar, not the
 * WebView's, so that URL would not load here. The bytes come through the ONE
 * binary door (`requestBinary`) and are shown from a local `blob:` URL — the
 * pattern FilePreview's `useFileBytes` already uses for a single file. Every
 * URL is revoked on unmount; a photo that fails to load keeps the file row,
 * and is fetched again when the thread refreshes or the device comes back
 * online, up to MAX_PHOTO_ATTEMPTS times.
 */
import { useEffect, useRef, useState } from "react";
import type { InteractionPart, InteractionThread, InteractionTurn } from "@factorylm/interaction";
import { requestBinary } from "../api/client";
import { fileBytesPath } from "../api/resources";

/** Every photo the thread's observation cards carry, once each. */
export function observationFileIds(thread: InteractionThread): string[] {
  const ids = new Set<string>();
  for (const turn of thread.turns) {
    for (const part of turn.parts) if (part.type === "visual_observation") ids.add(part.observation.fileId);
  }
  return [...ids];
}

function photosOf(turn: InteractionTurn): string[] {
  return turn.parts.flatMap((part) => (part.type === "visual_observation" ? [part.observation.fileId] : []));
}

/** Loaded pictures → the thread /v3 renders: `previewUrl` on the observation
 *  card, and the photo as an attachment on the question that carried it
 *  (mira-hub/src/factorylm-ui/to-interaction.ts `questionPhotoPart`). */
export function withPhotoPreviews(thread: InteractionThread, previews: ReadonlyMap<string, string>): InteractionThread {
  if (previews.size === 0) return thread;
  const turns = thread.turns.map((turn, i): InteractionTurn => {
    if (turn.role === "user") {
      const next = thread.turns[i + 1];
      const has = new Set(turn.parts.flatMap((p) => (p.type === "attachment" ? [p.attachment.id] : [])));
      const added: InteractionPart[] = (next?.role === "assistant" ? photosOf(next) : [])
        .filter((id) => previews.has(id) && !has.has(id))
        .map((id) => ({
          type: "attachment",
          attachment: { id, name: "Photo", mediaType: "image/*", kind: "photo", status: "ready", previewUrl: previews.get(id)! },
        }));
      return added.length > 0 ? { ...turn, parts: [...turn.parts, ...added] } : turn;
    }
    if (!turn.parts.some((p) => p.type === "visual_observation" && previews.has(p.observation.fileId))) return turn;
    return {
      ...turn,
      parts: turn.parts.map((p) => {
        const url = p.type === "visual_observation" ? previews.get(p.observation.fileId) : undefined;
        return url && p.type === "visual_observation" ? { ...p, observation: { ...p.observation, previewUrl: url } } : p;
      }),
    };
  });
  return { ...thread, turns };
}

/** How many times one photo is fetched before the card settles for its file row. */
export const MAX_PHOTO_ATTEMPTS = 3;

/** Fetch each photo and hold its `blob:` URL until unmount. A failed fetch is
 *  tried again on the next thread refresh or when the device comes back
 *  online, so a network blip does not cost the picture for the whole session. */
export function usePhotoPreviews(fileIds: readonly string[]): ReadonlyMap<string, string> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(() => new Map());
  // In flight, loaded, or settled (not an image): never asked for again.
  const requested = useRef(new Set<string>());
  const attempts = useRef(new Map<string, number>());
  const urls = useRef<string[]>([]);
  const alive = useRef(true);
  const [online, setOnline] = useState(0);
  useEffect(() => {
    alive.current = true;
    const onOnline = () => setOnline((n) => n + 1);
    window.addEventListener("online", onOnline);
    return () => {
      alive.current = false;
      window.removeEventListener("online", onOnline);
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
      requested.current.clear();
      attempts.current.clear();
    };
  }, []);
  useEffect(() => {
    // No object-URL API, no picture: the card keeps its file row.
    if (typeof URL.createObjectURL !== "function") return;
    for (const id of fileIds) {
      if (requested.current.has(id)) continue;
      const tried = attempts.current.get(id) ?? 0;
      if (tried >= MAX_PHOTO_ATTEMPTS) continue;
      requested.current.add(id);
      attempts.current.set(id, tried + 1);
      void requestBinary(fileBytesPath(id))
        .then((r) => {
          if (!alive.current || !r.contentType.startsWith("image/")) return;
          const url = URL.createObjectURL(new Blob([r.bytes.slice().buffer as ArrayBuffer], { type: r.contentType }));
          urls.current.push(url);
          setPreviews((prev) => new Map(prev).set(id, url));
        })
        .catch(() => {
          // The card keeps its file row for now; the next refresh or
          // reconnect may fetch the photo again.
          if (alive.current) requested.current.delete(id);
        });
    }
  }, [fileIds, online]);
  return previews;
}
