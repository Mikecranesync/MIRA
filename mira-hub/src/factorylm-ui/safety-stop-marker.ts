/**
 * #5670 review 5 F14: the canonical Hub keeps a stop when the stream breaks.
 *
 * The chat route names a terminal stop in `X-Safety-Stop` before any body byte
 * (the bypass refusal live, every terminal stop on replay). The canonical host
 * read the body only, so a stream cut after that header and before the `safety`
 * frame threw an interruption with no safety marker: the turn fell back to the
 * ordinary failure (Retry, the question back in the composer) and the stop the
 * server had already persisted was never shown.
 *
 * The marker reaches the client in one of two places:
 * - the direct response's own `X-Safety-Stop` header;
 * - on the progress transport (`x-mira-progress: 1`), the `{kind:"headers"}`
 *   frame that forwards the inner response's `x-safety-*` headers, written
 *   before any byte of the inner body (`capabilities/chat-progress.ts`).
 *
 * The tracker reads both, IN LINE with the reader the stream parser consumes
 * (no side branch that could lose a race with the interruption), and hands the
 * marker to the two places the host decides what the technician sees: the
 * parser's initial notice / a finished-but-truncated result, and the thrown
 * interruption. It only fills an ABSENT notice, so a stream whose safety frame
 * did arrive keeps exactly that one notice.
 */
import { isSafetyNoticeEntry, type SafetyNoticeEntry } from "@/lib/notebook-chat-types";

const STOP_HEADER = "x-safety-stop";

function stopEntry(trigger: unknown): SafetyNoticeEntry | null {
  return typeof trigger === "string" && trigger.trim() ? { kind: "safety_notice", trigger: trigger.trim() } : null;
}

/** The stop a forwarded `{kind:"headers"}` frame names, if any (header names are case-insensitive). */
function stopFromHeadersFrame(frame: unknown): SafetyNoticeEntry | null {
  if (!frame || typeof frame !== "object" || (frame as { kind?: unknown }).kind !== "headers") return null;
  const headers = (frame as { headers?: unknown }).headers;
  if (!headers || typeof headers !== "object") return null;
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (name.toLowerCase() === STOP_HEADER) return stopEntry(value);
  }
  return null;
}

export type SafetyStopTracker = {
  /** The stop this response has named so far, or null. */
  current(): SafetyNoticeEntry | null;
  /** Wrap the reader the stream parser consumes; every chunk is scanned before the parser sees it. */
  watch(reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStreamDefaultReader<Uint8Array>;
  /** A read that ended without throwing keeps the stop even if its safety frame never came. */
  settle<T extends { safetyNotice: SafetyNoticeEntry | null }>(result: T): T;
  /** A thrown interruption carries the stop, unless it already carries a safety notice. */
  carry<E>(err: E): E;
};

export function trackSafetyStop(headers: { get(name: string): string | null }): SafetyStopTracker {
  let marker: SafetyNoticeEntry | null = stopEntry(headers.get("X-Safety-Stop"));
  return {
    current: () => marker,
    watch(reader) {
      const dec = new TextDecoder();
      let buf = "";
      // The headers frame precedes the inner body, so scanning ends at the first other frame.
      let scanning = marker === null;
      const scan = (bytes: Uint8Array) => {
        buf += dec.decode(bytes, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const t = block.trim();
          if (!t.startsWith("data:")) continue;
          const data = t.slice(5).trim();
          let frame: unknown;
          try {
            frame = JSON.parse(data);
          } catch {
            continue;
          }
          const kind = frame && typeof frame === "object" ? (frame as { kind?: unknown }).kind : undefined;
          if (kind === "headers") {
            marker = marker ?? stopFromHeadersFrame(frame);
          } else if (kind !== "progress") {
            scanning = false;
          }
          if (!scanning || marker) {
            scanning = false;
            buf = "";
            return;
          }
        }
      };
      const wrapped = {
        async read() {
          const r = await reader.read();
          if (scanning && !r.done && r.value) scan(r.value);
          return r;
        },
        cancel: (reason?: unknown) => reader.cancel(reason),
        releaseLock: () => reader.releaseLock(),
        get closed() {
          return reader.closed;
        },
      };
      return wrapped as ReadableStreamDefaultReader<Uint8Array>;
    },
    settle(result) {
      return result.safetyNotice || !marker ? result : { ...result, safetyNotice: marker };
    },
    carry(err) {
      if (!marker || !err || typeof err !== "object") return err;
      const interrupted = err as Record<string, unknown>;
      if (!isSafetyNoticeEntry(interrupted.safetyNotice)) interrupted.safetyNotice = marker;
      return err;
    },
  };
}
