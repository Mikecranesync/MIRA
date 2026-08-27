// Workspace Files — the one place a technician can see EVERY file they've put
// into the workspace, what it can do (searchable / viewable / stored-only),
// and every place it is filed.
//
// The product rule this screen enforces in its wording: a file exists ONCE and
// is FILED in many places. "Attach" adds a filing location (non-destructive).
// "Change filing location" moves filings. "Detach" removes ONE filing.
// "Delete" destroys the file and is a separate, confirmed, destructive action
// that surfaces the server's refusal reasons verbatim instead of pretending.
import { useEffect, useState } from "react";
import {
  deleteFile,
  detachFileLink,
  fileCapabilityLabel,
  getFile,
  listFiles,
  type FileCapability,
  type FileLink,
  type WorkspaceFile,
} from "../api/resources";
import { ApiError } from "../api/client";
import { AttachFileSheet } from "./AttachFileSheet";
import { FilePreview } from "./FilePreview";
import { Loading, Empty, ErrorState, load, type Loadable } from "./common";
import { Sheet } from "./Sheet";

export type FilesRoute = { name: "list" } | { name: "detail"; fileId: string };

const FILTERS: { id: "all" | FileCapability | "unfiled" | "recent"; title: string }[] = [
  { id: "all", title: "All" },
  { id: "recent", title: "Recently uploaded" },
  { id: "unfiled", title: "Unfiled" },
  { id: "indexable", title: "Searchable" },
  { id: "viewable", title: "Viewable" },
  { id: "stored", title: "Stored only" },
];

/** Photo icon for images, doc icon otherwise (pure — unit tested). */
export function fileTypeIcon(mimeType: string): string {
  return mimeType.startsWith("image/") ? "🖼" : "📄";
}

/** Human size. Bytes are the server's truth; this only formats it. */
export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Processing state, stated honestly — "not searchable" is never dressed up as
 *  "processing" for a file the pipeline will never index. */
export function processingLabel(f: Pick<WorkspaceFile, "capability" | "indexed">): string {
  // `indexed` is the server's truth: a photo whose text was read (OCR, EVID-4)
  // is searchable even though its capability stays "viewable".
  if (f.indexed) return "Searchable source · indexed";
  if (f.capability !== "indexable") return fileCapabilityLabel(f.capability);
  return "Indexing—not searchable yet";
}

export function attachedLabel(linkCount: number): string {
  if (linkCount <= 0) return "Not filed anywhere yet";
  return `Attached to ${linkCount} place${linkCount === 1 ? "" : "s"}`;
}

/** Turn a 409 body token into the technician's sentence. Anything we don't
 *  recognize falls through to the server's own text — never a guess. */
export function deleteRefusalCopy(error: unknown, linkCount: number): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status !== 409) return null;
  if (error.detail.includes("has_links"))
    return `Can't delete: this file is attached to ${linkCount} place${linkCount === 1 ? "" : "s"} — detach it first.`;
  if (error.detail.includes("verified_retained"))
    return "Can't delete: verified documents are retained.";
  return error.detail;
}

/** The inverse of AttachFileSheet: the DESTINATION is fixed and the user picks
 *  a file. Used by "Attach existing" on an asset and "From Files" in a
 *  notebook — so both surfaces show the same thing (every file, including
 *  photos and stored-only files, not just parsed documents) and label each
 *  file's real capability instead of implying everything is searchable. */
export function PickWorkspaceFileSheet({
  title,
  hint,
  excludeFileIds,
  onPick,
  onClose,
  busy,
}: {
  title: string;
  hint?: string;
  excludeFileIds?: string[];
  onPick: (file: WorkspaceFile) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<Loadable<WorkspaceFile[]>>({ state: "loading" });
  const refresh = () => {
    setState({ state: "loading" });
    void load(() => listFiles({ q: q.trim() || undefined, limit: 100 })).then(setState);
  };
  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exclude = new Set(excludeFileIds ?? []);
  const rows = state.state === "ready" ? state.data.filter((f) => !exclude.has(f.id)) : [];

  return (
    <Sheet label={title} onClose={onClose}>
        <h3>{title}</h3>
        {hint && (
          <div className="meta" style={{ marginBottom: 8 }}>
            {hint}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            refresh();
          }}
        >
          <input
            placeholder="Search files…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
        {state.state === "loading" && <Loading what="files" />}
        {state.state === "error" && <ErrorState error={state.error} onRetry={refresh} />}
        {state.state === "ready" && rows.length === 0 && (
          <Empty text="No files here yet — upload one or photograph a nameplate." />
        )}
        {rows.map((f) => (
          <button
            key={f.id}
            className="sheet-option"
            disabled={busy}
            onClick={() => onPick(f)}
            style={{ flexDirection: "column", alignItems: "flex-start", padding: "10px 16px" }}
          >
            <span>
              {fileTypeIcon(f.mimeType)} {f.filename}
            </span>
            <span className="meta">
              {fileCapabilityLabel(f.capability)} · {formatSize(f.sizeBytes)}
            </span>
          </button>
        ))}
        <button style={{ marginTop: 6 }} onClick={onClose}>
          Cancel
        </button>
    </Sheet>
  );
}

export function FilesScreen({
  route,
  setRoute,
  onBack,
}: {
  route: FilesRoute;
  setRoute: (r: FilesRoute) => void;
  onBack: () => void;
}) {
  if (route.name === "detail")
    return <FileDetail fileId={route.fileId} onBack={() => setRoute({ name: "list" })} />;
  return <FilesList onOpen={(fileId) => setRoute({ name: "detail", fileId })} onBack={onBack} />;
}

function FilesList({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [state, setState] = useState<Loadable<WorkspaceFile[]>>({ state: "loading" });

  const refresh = () => {
    setState({ state: "loading" });
    void load(() =>
      listFiles({
        q: q.trim() || undefined,
        capability:
          filter === "indexable" || filter === "viewable" || filter === "stored"
            ? filter
            : undefined,
        unfiled: filter === "unfiled" || undefined,
        limit: 100,
      }),
    ).then(setState);
  };
  useEffect(refresh, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows =
    state.state === "ready"
      ? filter === "recent"
        ? [...state.data]
            .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
            .slice(0, 20)
        : state.data
      : [];

  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onBack}>
        ← More
      </button>
      <h3 style={{ margin: "4px 0 8px" }}>Files</h3>
      <div className="meta" style={{ marginBottom: 8 }}>
        Every file in this workspace. A file lives once and can be filed in
        several places.
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          refresh();
        }}
      >
        <input
          placeholder="Search files…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      <div className="chip-row" style={{ marginTop: 10 }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`chip ${f.id === filter ? "chip-active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.title}
          </button>
        ))}
        <button className="chip" onClick={refresh}>
          ↻
        </button>
      </div>

      {state.state === "loading" && <Loading what="files" />}
      {state.state === "error" && <ErrorState error={state.error} onRetry={refresh} />}
      {state.state === "ready" && rows.length === 0 && (
        <Empty text="No files match. Upload a manual or photograph a nameplate to get started." />
      )}
      {rows.map((f) => (
        <div key={f.id} className="card" onClick={() => onOpen(f.id)}>
          <h3 style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>{fileTypeIcon(f.mimeType)}</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {f.filename}
            </span>
          </h3>
          <div className="meta">
            {f.mimeType} · {formatSize(f.sizeBytes)}
          </div>
          <div className="meta">{processingLabel(f)}</div>
          <div className="meta">{attachedLabel(f.linkCount)}</div>
          <div className="chip-row" style={{ paddingBottom: 0 }}>
            <button
              className="chip"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(f.id);
              }}
            >
              Open
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Server target-type token → the word a technician reads. */
const TARGET_TITLES: Record<string, string> = {
  cmms_asset: "Asset",
  equipment_notebook: "Notebook",
  namespace_node: "Location",
  work_order: "Work order",
};

function FileDetail({ fileId, onBack }: { fileId: string; onBack: () => void }) {
  const [state, setState] = useState<Loadable<{ file: WorkspaceFile; links: FileLink[] }>>({
    state: "loading",
  });
  const [attachOpen, setAttachOpen] = useState(false);
  const [relocating, setRelocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const refresh = () => {
    setState({ state: "loading" });
    void load(() => getFile(fileId)).then(setState);
  };
  useEffect(refresh, [fileId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.state === "loading")
    return (
      <div className="content">
        <button className="btn-link" onClick={onBack}>
          ← Files
        </button>
        <Loading what="file" />
      </div>
    );
  if (state.state === "error")
    return (
      <div className="content">
        <button className="btn-link" onClick={onBack}>
          ← Files
        </button>
        <ErrorState error={state.error} onRetry={refresh} />
      </div>
    );

  const { file, links } = state.data;

  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onBack}>
        ← Files
      </button>

      <div className="card">
        <h3>
          {fileTypeIcon(file.mimeType)} {file.filename}
        </h3>
        <div className="meta">
          {file.mimeType} · {formatSize(file.sizeBytes)}
          {file.createdAt ? ` · added ${new Date(file.createdAt).toLocaleDateString()}` : ""}
        </div>
        <div className="meta">{processingLabel(file)}</div>
        {file.verified && <div className="meta">Verified document — retained by policy.</div>}
        {showPreview ? (
          <div style={{ marginTop: 10 }}>
            <FilePreview fileId={file.id} filename={file.filename} mimeType={file.mimeType} />
          </div>
        ) : (
          <button style={{ marginTop: 10 }} onClick={() => setShowPreview(true)}>
            Open the original
          </button>
        )}
      </div>

      <div className="card">
        <h3>{attachedLabel(file.linkCount || links.length)}</h3>
        {links.length === 0 && (
          <div className="meta">
            This file isn't filed anywhere yet — attach it so it shows up where
            you work.
          </div>
        )}
        {links.map((l) => (
          <div key={l.id} className="source-row">
            <div className="grow">
              <div className="title">
                {l.displayLabel ?? `${TARGET_TITLES[l.targetType] ?? l.targetType} ${l.targetId}`}
              </div>
              <div className="meta">
                {TARGET_TITLES[l.targetType] ?? l.targetType}
                {l.role ? ` · ${l.role}` : ""}
                {l.isPrimary ? " · primary" : ""}
              </div>
            </div>
            <button
              className="detach"
              title="Remove this filing location"
              onClick={async () => {
                if (
                  !window.confirm(
                    `Detach from ${l.displayLabel ?? l.targetType}? The file stays in your workspace.`,
                  )
                )
                  return;
                try {
                  await detachFileLink(file.id, l.id);
                  setNote("Detached. The file is still in your workspace.");
                  refresh();
                } catch (e) {
                  setNote(e instanceof ApiError ? e.userMessage : "Couldn't detach — try again.");
                }
              }}
            >
              Detach
            </button>
          </div>
        ))}
        <button style={{ marginTop: 10 }} onClick={() => { setRelocating(false); setAttachOpen(true); }}>
          Attach to…
        </button>
        <button style={{ marginTop: 8 }} onClick={() => { setRelocating(true); setAttachOpen(true); }}>
          Change filing location
        </button>
        {note && <div className="meta" style={{ marginTop: 8 }}>{note}</div>}
      </div>

      <div className="card">
        <h3>Delete this file</h3>
        <div className="meta">
          Deleting destroys the file itself, everywhere. Detaching only removes
          one filing location.
        </div>
        {deleteError && <div className="warnbox">{deleteError}</div>}
        <button
          style={{ marginTop: 10, color: "var(--fl-red)", borderColor: "var(--fl-red)" }}
          onClick={async () => {
            if (
              !window.confirm(
                `Permanently delete “${file.filename}”? This cannot be undone.`,
              )
            )
              return;
            setDeleteError(null);
            try {
              await deleteFile(file.id);
              onBack();
            } catch (e) {
              setDeleteError(
                deleteRefusalCopy(e, file.linkCount || links.length) ??
                  (e instanceof ApiError ? e.userMessage : "Couldn't delete this file."),
              );
            }
          }}
        >
          Delete file
        </button>
      </div>

      {attachOpen && (
        <AttachFileSheet
          fileId={file.id}
          filename={file.filename}
          existingLinks={links}
          onClose={() => setAttachOpen(false)}
          onAttached={(added) => {
            setAttachOpen(false);
            setNote(
              relocating
                ? `Filed in ${added} more place${added === 1 ? "" : "s"} — detach the old ones below if you're moving it.`
                : `Attached to ${added} place${added === 1 ? "" : "s"}.`,
            );
            refresh();
          }}
        />
      )}
    </div>
  );
}
