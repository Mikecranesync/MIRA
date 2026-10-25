// Authenticated original bytes, shared by canonical and compatibility presentation.
import { useEffect, useState } from "react";
import { requestBinary } from "./client";
import { fileBytesPath } from "./resources";

interface Bytes {
  url: string;
  contentType: string;
  sizeBytes: number;
}

export function useFileBytes(fileId: string | null | undefined): {
  state: "idle" | "loading" | "ready" | "error";
  bytes: Bytes | null;
  error: unknown;
} {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [bytes, setBytes] = useState<Bytes | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!fileId) {
      setState("idle");
      setBytes(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    setState("loading");
    setError(null);
    void requestBinary(fileBytesPath(fileId))
      .then((r) => {
        if (cancelled) return;
        const blob = new Blob([r.bytes.slice().buffer as ArrayBuffer], { type: r.contentType });
        url = URL.createObjectURL(blob);
        setBytes({ url, contentType: r.contentType, sizeBytes: r.bytes.length });
        setState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e);
        setState("error");
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId]);

  return { state, bytes, error };
}

