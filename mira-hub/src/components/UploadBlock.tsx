"use client";

import { useState } from "react";
import { X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export type UploadBlockData = {
  id: string;
  provider: "google" | "dropbox" | "local";
  filename: string;
  sizeBytes: number | null;
  externalCreatedAt: string | null;
  status: "queued" | "fetching" | "parsing" | "parsed" | "failed" | "cancelled";
  statusDetail: string | null;
  kbChunkCount: number | null;
};

const PROVIDER_LABEL: Record<UploadBlockData["provider"], string> = {
  google: "Google Drive",
  dropbox: "Dropbox",
  local: "This device",
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function UploadBlock({
  upload,
  onDelete,
}: {
  upload: UploadBlockData;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const parsed = upload.status === "parsed";
  const failed = upload.status === "failed";

  const statusLine = (() => {
    switch (upload.status) {
      case "queued":
        return { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, text: "Queued…", color: "var(--foreground-muted)" };
      case "fetching":
        return { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, text: `Fetching from ${PROVIDER_LABEL[upload.provider]}…`, color: "var(--foreground-muted)" };
      case "parsing":
        return { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, text: "Parsing to KB…", color: "var(--foreground-muted)" };
      case "parsed":
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5" />,
          text: `Parsed${upload.kbChunkCount != null ? ` · ${upload.kbChunkCount} chunks` : ""}`,
          color: "#16A34A",
        };
      case "failed":
        return {
          icon: <AlertCircle className="w-3.5 h-3.5" />,
          text: `Failed${upload.statusDetail ? `: ${upload.statusDetail}` : ""}`,
          color: "#DC2626",
        };
      case "cancelled":
        return { icon: null, text: "Cancelled", color: "var(--foreground-subtle)" };
    }
  })();

  return (
    <div
      className="card p-4 flex items-start gap-3"
      style={parsed ? { opacity: 0.6 } : failed ? { borderColor: "#DC262650" } : undefined}
    >
      <div
        className="flex-1 min-w-0"
        style={parsed ? { textDecoration: "line-through" } : undefined}
      >
        <p className="text-sm font-semibold leading-snug" style={{ color: "var(--foreground)" }}>
          {upload.filename}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
          {PROVIDER_LABEL[upload.provider]} · {formatSize(upload.sizeBytes)} · {formatDate(upload.externalCreatedAt)}
        </p>
        <div className="flex items-center gap-1.5 mt-2">
          {statusLine.icon}
          <span className="text-[11px]" style={{ color: statusLine.color }}>
            {statusLine.text}
          </span>
        </div>
      </div>

      <button
        onClick={async () => {
          setDeleting(true);
          try {
            await onDelete(upload.id);
          } finally {
            setDeleting(false);
          }
        }}
        disabled={deleting}
        className="p-1 rounded-lg hover:bg-[var(--surface-1)] transition-colors disabled:opacity-50"
        title={parsed ? "Remove from knowledge base" : "Cancel"}
      >
        <X className="w-4 h-4" style={{ color: "var(--foreground-muted)" }} />
      </button>
    </div>
  );
}
