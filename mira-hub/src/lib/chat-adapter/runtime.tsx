"use client";
/**
 * MIRA ExternalStoreRuntime wiring (spike criteria 3/5/6 harness).
 *
 * MIRA owns message state, transport, and the STRM-2 stopped semantics; the
 * library renders. The transport is injectable: the spike page uses a
 * fixture transport that replays recorded contract-shaped SSE transcripts
 * incrementally (PRD §17 "contract tests using recorded server event
 * fixtures"); the production transport is `postNotebookChat` against
 * POST /api/equipment-notebooks/[id]/chat/ (same frame semantics — the
 * incremental fold below re-parses the accumulated raw stream exactly the
 * way readNotebookStream splits it).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { AdapterMessage } from "./contract";
import {
  foldFrames,
  hydrateMessages,
  liveAssistantMessage,
  parseSseTranscript,
  stoppedAssistantMessage,
} from "./frames-to-parts";
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import { toThreadMessage } from "./convert";

/** Delivers raw SSE text chunks. Resolves when the stream ends; must stop
 *  promptly when `signal` aborts. */
export type SpikeTransport = (
  message: string,
  signal: AbortSignal,
  onRawChunk: (rawSoFar: string) => void,
) => Promise<void>;

let nextId = 0;
const genId = (prefix: string) => `${prefix}-${++nextId}`;

export function useMiraChatRuntime(opts: {
  transport: SpikeTransport;
  initialRows?: PersistedTurn[];
}) {
  const [messages, setMessages] = useState<AdapterMessage[]>(() =>
    hydrateMessages(opts.initialRows ?? []),
  );
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const transportRef = useRef(opts.transport);
  useEffect(() => {
    transportRef.current = opts.transport;
  }, [opts.transport]);

  const onNew = useCallback(async (message: { content: readonly unknown[] }) => {
    const textPart = message.content.find(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" && p !== null && (p as { type?: string }).type === "text",
    );
    const text = textPart?.text ?? "";
    if (!text.trim()) return;

    const userMsg: AdapterMessage = {
      id: genId("u"),
      role: "user",
      parts: [{ type: "text", text, knownCitationIds: [] }],
      lifecycle: "completed",
      status: null,
    };
    const assistantId = genId("a");
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", parts: [], lifecycle: "running", status: null },
    ]);

    let lastRaw = "";
    const render = (raw: string, terminal: boolean) => {
      const fold = foldFrames(parseSseTranscript(raw));
      const msg = terminal
        ? liveAssistantMessage(assistantId, fold)
        : { ...liveAssistantMessage(assistantId, fold), lifecycle: "running" as const, status: null };
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? msg : m)));
      return fold;
    };

    try {
      await transportRef.current(text, controller.signal, (raw) => {
        lastRaw = raw;
        render(raw, false);
      });
      render(lastRaw, true);
    } catch (err) {
      if (controller.signal.aborted) {
        // STRM-2: the partial stays, no citations, lifecycle stopped.
        const fold = foldFrames(parseSseTranscript(lastRaw));
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? stoppedAssistantMessage(assistantId, fold.content) : m)),
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  parts: [...m.parts, { type: "error" as const, reason: "provider_failure" as const }],
                  lifecycle: "failed" as const,
                  status: "error" as const,
                }
              : m,
          ),
        );
        if (!(err instanceof Error)) throw err;
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, []);

  const onCancel = useCallback(async () => {
    abortRef.current?.abort();
  }, []);

  const runtime = useExternalStoreRuntime<AdapterMessage>({
    messages,
    setMessages: (msgs) => setMessages([...msgs]),
    isRunning,
    onNew,
    onCancel,
    convertMessage: toThreadMessage,
  });

  return { runtime, messages };
}

export { AssistantRuntimeProvider };
