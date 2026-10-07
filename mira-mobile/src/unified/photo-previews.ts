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
 * URL is revoked on unmount; a photo that fails to load keeps the file row.
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

/** Fetch each photo once and hold its `blob:` URL until unmount. */
export function usePhotoPreviews(fileIds: readonly string[]): ReadonlyMap<string, string> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(() => new Map());
  const requested = useRef(new Set<string>());
  const urls = useRef<string[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
      requested.current.clear();
    };
  }, []);
  useEffect(() => {
    // No object-URL API, no picture: the card keeps its file row.
    if (typeof URL.createObjectURL !== "function") return;
    for (const id of fileIds) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      void requestBinary(fileBytesPath(id))
        .then((r) => {
          if (!alive.current || !r.contentType.startsWith("image/")) return;
          const url = URL.createObjectURL(new Blob([r.bytes.slice().buffer as ArrayBuffer], { type: r.contentType }));
          urls.current.push(url);
          setPreviews((prev) => new Map(prev).set(id, url));
        })
        .catch(() => {
          // A photo that cannot be fetched stays a file row; nothing else depends on it.
        });
    }
  }, [fileIds]);
  return previews;
}
