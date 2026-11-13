"use client";
/**
 * #5456: the sources of this project that answers do not use, each with the one
 * step that would change that. Renders nothing when every source is in use.
 * Rows and steps come from the server's projection (see parked-sources.ts);
 * after a write the host re-reads the project, so this keeps no on/off state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/config";
import type { SetupDeps } from "./new-project-setup-logic";
import { confirmedOn, parkedRows, turnOnAndReread, type ParkedRow, type ParkedSource } from "./parked-sources";
import { fileUrl } from "./to-interaction";

type Props = {
  notebookId: string;
  sources: ReadonlyArray<ParkedSource>;
  /** A source was turned on; the host re-reads the project and resolves true when that read landed. */
  onChanged: () => Promise<boolean>;
};

const deps: SetupDeps = {
  fetch: (input, init) => fetch(input, init),
  apiBase: API_BASE,
  createNotebook: async () => null,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const box = { maxWidth: "min(360px, calc(100vw - 24px))", boxSizing: "border-box", padding: "8px 12px", boxShadow: "var(--fl-shadow)", border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)", color: "var(--fl-ink)", fontSize: "var(--fl-fs)" } as const;
const btn = { marginLeft: 8, padding: "2px 10px", border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)", color: "var(--fl-accent)", cursor: "pointer" } as const;

export function ParkedSources({ notebookId, sources, onChanged }: Props) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [turnedOn, setTurnedOn] = useState<ReadonlyArray<{ docId: string; name: string }>>([]);
  /** Synchronous guard: a second tap before the first re-render must not send a second write. */
  const inFlight = useRef(new Set<string>());
  const latest = useRef(onChanged);
  useEffect(() => { latest.current = onChanged; }, [onChanged]);

  const use = useCallback(async (row: ParkedRow) => {
    setFailed((f) => { const next = { ...f }; delete next[row.docId]; return next; });
    const r = await turnOnAndReread(notebookId, row, inFlight.current, { deps, reread: () => latest.current(), onBusy: () => setBusy(new Set(inFlight.current)) });
    if (!r) return; // a second tap while the first is in flight
    if (r.kind === "failed") setFailed((f) => ({ ...f, [row.docId]: r.message }));
    else setTurnedOn((list) => [...list.filter((t) => t.docId !== row.docId), { docId: row.docId, name: row.name }]);
  }, [notebookId]);

  const rows = parkedRows(sources);
  return <ParkedSourcesView rows={rows} turnedOn={confirmedOn(turnedOn, rows)} busy={busy} failed={failed} onUse={(row) => void use(row)} />;
}

type ViewProps = {
  rows: ReadonlyArray<ParkedRow>;
  turnedOn: ReadonlyArray<string>;
  busy: ReadonlySet<string>;
  failed: Readonly<Record<string, string>>;
  onUse: (row: ParkedRow) => void;
};

/** The box itself, stateless, so its markup can be checked without a DOM. */
export function ParkedSourcesView({ rows, turnedOn, busy, failed, onUse }: ViewProps) {
  if (rows.length === 0 && turnedOn.length === 0) return null;
  return (
    <section aria-label="Sources not in use" data-testid="parked-sources" style={box}>
      {rows.length > 0 ? <p style={{ margin: "4px 0", fontWeight: 600 }}>Sources not in use</p> : null}
      {turnedOn.map((name, i) => <p key={`on${i}`} style={{ margin: "4px 0" }}>{name} is now used for answers in this project.</p>)}
      {rows.map((row) => (
        <p key={row.docId} data-testid="parked-source" data-fix={row.fix} style={{ margin: "4px 0" }}>
          {row.fix === "full_manual"
            ? <>{row.name} is saved here but switched off: it is only part of a manual. Add the full manual to this project to get cited answers.</>
            : row.fix === "wait"
              ? <>{row.name} is saved here, but its text isn&apos;t readable in this project, so answers can&apos;t use it.</>
              : <>{row.name} is saved here, but answers don&apos;t use it ({row.label}). Open it and check it is the right manual before you turn it on.</>}
          {row.fileId ? <a style={{ marginLeft: 8, color: "var(--fl-accent)" }} href={fileUrl(row.fileId)} target="_blank" rel="noreferrer" aria-label={`Open ${row.name}`}>Open</a> : null}
          {row.fix === "use"
            ? <button type="button" style={btn} disabled={busy.has(row.docId)} aria-label={`Use ${row.name} for answers`} onClick={() => onUse(row)}>{busy.has(row.docId) ? "Turning on…" : "Use this manual"}</button>
            : null}
          {failed[row.docId] ? <span role="alert" style={{ display: "block", color: "var(--fl-fault)" }}>{failed[row.docId]}</span> : null}
        </p>
      ))}
    </section>
  );
}
