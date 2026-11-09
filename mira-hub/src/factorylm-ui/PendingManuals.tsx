"use client";
/**
 * #5302: in the opened project, the manuals saved here that are not sources yet.
 * Follows a still-reading file on a bounded schedule and attaches it once readable
 * when the technician approved it at Create project in this session; otherwise
 * (after a reload, another device) it offers an explicit Add. Renders nothing
 * when there is nothing pending.
 * #5316: "still being read" is shown only while the server confirms an ingest is
 * running. A file nothing is reading says so and offers Upload again.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/config";
import { POLL_INTERVAL_MS, POLL_MAX, type SetupDeps } from "./new-project-setup-logic";
import { addPendingManual, approvedFiles, checkPendingManuals, knownSources, outstandingAttached, reuploadPendingManual, type PendingManual } from "./pending-manuals";

type Props = {
  notebookId: string;
  nodeId: string;
  sources: ReadonlyArray<{ docId: string; fileId: string | null }>;
  approved: ReadonlySet<string>;
  /** A file became a source; the host re-reads the project. */
  onAttached: (fileIds: string[]) => void;
};

const deps: SetupDeps = {
  fetch: (input, init) => fetch(input, init),
  apiBase: API_BASE,
  createNotebook: async () => null,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const box = { maxWidth: "min(360px, calc(100vw - 24px))", boxSizing: "border-box", padding: "8px 12px", boxShadow: "var(--fl-shadow)", border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)", color: "var(--fl-ink)", fontSize: "var(--fl-fs)" } as const;
const btn = { marginLeft: 8, padding: "2px 10px", border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)", color: "var(--fl-accent)", cursor: "pointer" } as const;

export function PendingManuals({ notebookId, nodeId, sources, approved, onAttached }: Props) {
  const [pending, setPending] = useState<PendingManual[]>([]);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [status, setStatus] = useState<"checking" | "idle" | "capped" | "error">("checking");
  const [run, setRun] = useState(0);
  const latest = useRef({ sources, approved, onAttached });
  useEffect(() => { latest.current = { sources, approved, onAttached }; }, [sources, approved, onAttached]);
  /** Documents this panel attached; counted as sources until the host's refresh lists them (#5325). */
  const attachedDocs = useRef(new Set<string>());
  // #5327: once the host lists a document, the host is the authority, so a later
  // detach elsewhere is not hidden by this panel's memory of attaching it.
  useEffect(() => { attachedDocs.current = outstandingAttached(attachedDocs.current, sources); }, [sources]);
  /** Files sent with Upload again in this project that the server is still reading (#5322). */
  const retried = useRef(new Set<string>());
  useEffect(() => { retried.current = new Set(); attachedDocs.current = new Set(); }, [notebookId]);
  const names = useRef(new Map<string, string>());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setStatus("checking");
      for (let poll = 1; poll <= POLL_MAX && alive; poll++) {
        const r = await checkPendingManuals({ notebookId, nodeId, sources: knownSources(latest.current.sources, attachedDocs.current), approved: approvedFiles(latest.current.approved, retried.current) }, deps, () => !alive);
        if (!alive) return;
        if (!r.ok) { setStatus("error"); return; }
        for (const [id, name] of Object.entries(r.filenames)) names.current.set(id, name);
        setPending(r.pending);
        setFailed(Object.fromEntries(r.failed.map((f) => [f.fileId, f.message])));
        if (r.attached.length) {
          for (const id of r.attached) retried.current.delete(id);
          setAdded((a) => [...a, ...r.attached.map((id) => names.current.get(id) ?? "Document")]);
          latest.current.onAttached(r.attached);
        }
        if (!r.pending.some((p) => p.state === "reading")) { setStatus("idle"); return; }
        if (poll < POLL_MAX) await deps.sleep(POLL_INTERVAL_MS);
      }
      if (alive) setStatus("capped");
    })();
    return () => { alive = false; };
  }, [notebookId, nodeId, run]);

  const add = useCallback(async (p: PendingManual) => {
    if (!p.docId) return;
    const r = await addPendingManual(notebookId, p.docId, deps);
    if (r.ok) {
      attachedDocs.current.add(p.docId);
      setPending((list) => list.filter((x) => x.fileId !== p.fileId));
      setAdded((a) => [...a, p.filename]);
      latest.current.onAttached([p.fileId]);
    } else setFailed((f) => ({ ...f, [p.fileId]: r.message ?? "" }));
  }, [notebookId]);

  // Upload again: the technician picked the PDF again; the tap is the approval to add it here.
  const reupload = useCallback(async (p: PendingManual, file: File | undefined) => {
    if (!file) return;
    setBusy(p.fileId);
    setFailed((f) => { const next = { ...f }; delete next[p.fileId]; return next; });
    const r = await reuploadPendingManual({ notebookId, nodeId, file }, deps);
    setBusy(null);
    if (r.kind === "attached") {
      attachedDocs.current.add(r.docId);
      // Name the file that was added, and re-read the project rather than drop the
      // row: a different PDF leaves the original unread on the server (#5316 device run).
      setAdded((a) => [...a, r.filename]);
      latest.current.onAttached([p.fileId]);
      setRun((n) => n + 1);
    } else if (r.kind === "reading") {
      // The tap approved this file for this project (#5322): follow the id the
      // server is reading, which differs from the row's when another copy was picked.
      retried.current.add(r.fileId ?? p.fileId);
      setRun((n) => n + 1);
    }
    else setFailed((f) => ({ ...f, [p.fileId]: r.message }));
  }, [notebookId, nodeId]);

  if (pending.length === 0 && added.length === 0 && status !== "error") return null;
  const again = <button type="button" style={btn} onClick={() => setRun((n) => n + 1)}>Check again</button>;
  return (
    <section aria-label="Project documents not searchable yet" data-testid="pending-manuals" style={box}>
      {added.map((name, i) => <p key={`a${i}`} style={{ margin: "4px 0" }}>{name} was added as a source of this project.</p>)}
      {pending.map((p) => (
        <p key={p.fileId} style={{ margin: "4px 0" }}>
          {p.state === "reading"
            ? <>{p.filename} is saved here and still being read. It is not searchable yet.{approvedFiles(approved, retried.current).has(p.fileId) ? " It is added as a source when it is ready." : " Once readable, add it as a source here."}</>
            : p.state === "unread"
              ? <>{p.filename} is saved here but wasn&apos;t read, so it is not searchable.{busy === p.fileId
                  ? " Uploading…"
                  : <UploadAgain filename={p.filename} onPick={(f) => void reupload(p, f)} />}</>
              : <>{p.filename} is readable but not a source of this project yet.<button type="button" style={btn} onClick={() => void add(p)}>Add as source</button></>}
          {failed[p.fileId] ? <span role="alert" style={{ display: "block", color: "var(--fl-fault)" }}>{failed[p.fileId]}</span> : null}
        </p>
      ))}
      {status === "capped" ? <p style={{ margin: "4px 0" }}>Still being read.{again}</p> : null}
      {status === "error" ? <p role="alert" style={{ margin: "4px 0" }}>Couldn&apos;t check this project&apos;s documents.{again}</p> : null}
    </section>
  );
}

/**
 * #5323: Upload again as a real button. The file input stays out of the layout
 * and the tab order; the button is what keyboard and screen-reader users reach,
 * and it opens the platform file chooser.
 */
export function UploadAgain({ filename, onPick }: { filename: string; onPick: (file: File | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" style={btn} aria-label={`Upload ${filename} again`} onClick={() => input.current?.click()}>Upload again</button>
      <input ref={input} type="file" accept="application/pdf" hidden tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onPick(f); }} />
    </>
  );
}
