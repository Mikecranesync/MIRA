"use client";
/**
 * #5302: in the opened project, the manuals saved here that are not sources yet.
 * Follows a still-reading file on a bounded schedule and attaches it once readable
 * when the technician approved it at Create project in this session; otherwise
 * (after a reload, another device) it offers an explicit Add. Renders nothing
 * when there is nothing pending.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/config";
import { POLL_INTERVAL_MS, POLL_MAX, type SetupDeps } from "./new-project-setup-logic";
import { addPendingManual, checkPendingManuals, type PendingManual } from "./pending-manuals";

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
  const names = useRef(new Map<string, string>());

  useEffect(() => {
    let alive = true;
    void (async () => {
      setStatus("checking");
      for (let poll = 1; poll <= POLL_MAX && alive; poll++) {
        const r = await checkPendingManuals({ notebookId, nodeId, sources: latest.current.sources, approved: latest.current.approved }, deps, () => !alive);
        if (!alive) return;
        if (!r.ok) { setStatus("error"); return; }
        for (const [id, name] of Object.entries(r.filenames)) names.current.set(id, name);
        setPending(r.pending);
        setFailed(Object.fromEntries(r.failed.map((f) => [f.fileId, f.message])));
        if (r.attached.length) {
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
      setPending((list) => list.filter((x) => x.fileId !== p.fileId));
      setAdded((a) => [...a, p.filename]);
      latest.current.onAttached([p.fileId]);
    } else setFailed((f) => ({ ...f, [p.fileId]: r.message ?? "" }));
  }, [notebookId]);

  if (pending.length === 0 && added.length === 0 && status !== "error") return null;
  const again = <button type="button" style={btn} onClick={() => setRun((n) => n + 1)}>Check again</button>;
  return (
    <section aria-label="Project documents not searchable yet" data-testid="pending-manuals" style={box}>
      {added.map((name, i) => <p key={`a${i}`} style={{ margin: "4px 0" }}>{name} was added as a source of this project.</p>)}
      {pending.map((p) => (
        <p key={p.fileId} style={{ margin: "4px 0" }}>
          {p.state === "reading"
            ? <>{p.filename} is saved here and still being read. It is not searchable yet.{approved.has(p.fileId) ? " It is added as a source when it is ready." : " Once readable, add it as a source here."}</>
            : <>{p.filename} is readable but not a source of this project yet.<button type="button" style={btn} onClick={() => void add(p)}>Add as source</button></>}
          {failed[p.fileId] ? <span role="alert" style={{ display: "block", color: "var(--fl-fault)" }}>{failed[p.fileId]}</span> : null}
        </p>
      ))}
      {status === "capped" ? <p style={{ margin: "4px 0" }}>Still being read.{again}</p> : null}
      {status === "error" ? <p role="alert" style={{ margin: "4px 0" }}>Couldn&apos;t check this project&apos;s documents.{again}</p> : null}
    </section>
  );
}
