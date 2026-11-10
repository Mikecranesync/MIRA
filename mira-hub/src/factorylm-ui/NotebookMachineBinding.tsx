"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { API_BASE } from "@/lib/config";
import type { NamespaceNode } from "@/app/api/namespace/tree/route";
import { listNotice, partitionMachines, type Machine } from "./ScopePicker";

const MAX_TREE_NODES = 10_000;
// Bound the text rendered in options too: a node cap alone still permits
// quadratic output when every ancestor is itself a selectable machine.
const MAX_MACHINE_LABEL_CHARS = 1_000_000;

/** Recovery for the existing job gate. Choosing stays local; only the final
 * confirmation writes, through the existing session/tenant-checked asset API. */
export function NotebookMachineBinding({ notebookId, onConfirmed, buttonStyle, fieldStyle }: {
  notebookId: string;
  onConfirmed: (notebookId: string) => void;
  buttonStyle: CSSProperties;
  fieldStyle: CSSProperties;
}) {
  const [choosing, setChoosing] = useState(false);
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [malformed, setMalformed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [existingNotebookId, setExistingNotebookId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [savedBinding, setSavedBinding] = useState<{ choiceId: string; entityId: string } | null>(null);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const active = useRef(false);
  const scope = useRef(notebookId);
  useLayoutEffect(() => { scope.current = notebookId; }, [notebookId]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (!choosing) return;
    let live = true;
    fetch(`${API_BASE}/api/namespace/tree/`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("machine_list_unavailable");
        const body = await res.json();
        if (!Array.isArray(body?.nodes)) throw new Error("machine_list_unreadable");
        // Notebook binding targets canonical graph machines. A CMMS-only row
        // may have a location yet lack the verified node required by the gate.
        // Reuse the existing machine projection after walking the tenant tree.
        const rows: unknown[] = [];
        let scheduled = body.nodes.length;
        if (scheduled > MAX_TREE_NODES) throw new Error("machine_list_too_large");
        // One mutable ancestor path, shared by iterative DFS frames. Copying it
        // for every child makes a deep, mostly non-machine tree quadratic.
        const pending: Array<{ nodes: unknown[]; next: number }> = [{ nodes: body.nodes, next: body.nodes.length - 1 }];
        const parents: string[] = [];
        let parentChars = 0;
        let labelChars = 0;
        while (pending.length) {
          const frame = pending[pending.length - 1]!;
          if (frame.next < 0) {
            pending.pop();
            if (parents.length) {
              parentChars -= parents.pop()!.length + (parents.length ? 3 : 0);
            }
            continue;
          }
          const raw = frame.nodes[frame.next--];
          if (!raw || typeof raw !== "object") throw new Error("machine_list_unreadable");
          const node = raw as Partial<NamespaceNode>;
          if (typeof node.kind !== "string" || typeof node.name !== "string") throw new Error("machine_list_unreadable");
          if (node.kind === "asset" || node.kind === "equipment") {
            labelChars += node.name.length + parentChars;
            if (labelChars > MAX_MACHINE_LABEL_CHARS) throw new Error("machine_list_too_large");
            rows.push({ id: node.id, name: node.name, tag: node.name, unsPath: node.unsPath, location: parents.join(" / ") || null });
          }
          if (node.children !== undefined && !Array.isArray(node.children)) throw new Error("machine_list_unreadable");
          if (node.children?.length) {
            scheduled += node.children.length;
            if (scheduled > MAX_TREE_NODES) throw new Error("machine_list_too_large");
            parentChars += node.name.length + (parents.length ? 3 : 0);
            parents.push(node.name);
            pending.push({ nodes: node.children, next: node.children.length - 1 });
          }
        }
        const result = partitionMachines(rows);
        if (listNotice({ failed: false, machines: result.machines, malformed: result.malformed, shown: result.machines.length }) === "unreadable") throw new Error("machine_list_unreadable");
        return result;
      })
      .then((result) => { if (live) { setMachines(result.machines); setMalformed(result.malformed); } })
      .catch(() => { if (live) setError("Could not load your machines. Try again."); });
    return () => { live = false; };
  }, [choosing, reload]);

  const selected = machines?.find((machine) => machine.id === selectedId) ?? null;
  const confirm = async () => {
    if (!selected || pending || inFlight.current) return;
    inFlight.current = true;
    const target = notebookId;
    const machine = selected;
    const stillHere = () => active.current && scope.current === target;
    setPending(true);
    setError(null);
    setExistingNotebookId(null);
    let saved = savedBinding?.choiceId === machine.id;
    let canonicalKey = saved ? savedBinding!.entityId : null;
    try {
      if (!saved) {
        const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(target)}/asset/`, {
          method: "PUT", credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetRef: machine.id, selectedVia: "asset_picker" }),
        });
        const body = await res.json();
        if (!stillHere()) return;
        if (!res.ok || body.ok !== true) {
          setError(typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Could not save the machine selection. Try again.");
          if (body.code === "asset_already_bound" && typeof body.boundNotebookId === "string") setExistingNotebookId(body.boundNotebookId);
          return;
        }
        const key = body.notebook?.asset?.entityId;
        if (typeof key !== "string" || !key) {
          setError("The machine selection was accepted, but its saved identity could not be read. Try again before starting a job.");
          return;
        }
        canonicalKey = key;
        saved = true;
        setSavedBinding({ choiceId: machine.id, entityId: key });
      }
      // A successful PUT alone is insufficient: read the persisted binding,
      // including its session-derived confirmation, before enabling Start.
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(target)}/`, {
        credentials: "include", cache: "no-store",
      });
      const body = await res.json();
      if (!stillHere()) return;
      const binding = body.notebook?.asset;
      if (!res.ok || binding?.entityId !== canonicalKey || typeof binding.confirmedAt !== "string" || !binding.confirmedAt || !Number.isFinite(Date.parse(binding.confirmedAt))) {
        setError("Machine selection was saved, but its confirmation could not be checked. Check again before starting a job.");
        return;
      }
      onConfirmed(target);
    } catch {
      if (stillHere()) setError(saved
        ? "Machine selection was saved, but its confirmation could not be checked. Check again before starting a job."
        : "No reply confirming the machine selection. Try again before starting a job.");
    } finally {
      inFlight.current = false;
      if (stillHere()) setPending(false);
    }
  };

  if (!choosing) return <button type="button" style={buttonStyle} onClick={() => { setMachines(null); setError(null); setChoosing(true); }}>Choose an existing machine</button>;

  return (
    <section aria-label="Confirm this notebook's machine" style={{ marginBlock: 12 }}>
      <p>Select the existing machine this notebook describes. Check its name and location before confirming.</p>
      {machines === null && !error && <p role="status">Loading machines…</p>}
      {machines && malformed > 0 && <p role="status">Some machine entries could not be read. Choose only a listed machine whose name and location you recognize.</p>}
      {machines && machines.length === 0 && <p>No machines with a registered location are available. Ask your workspace administrator to check the machine register.</p>}
      {machines && machines.length > 0 && (
        <label>Machine
          <select style={fieldStyle} value={selectedId} disabled={pending || savedBinding !== null} onChange={(event) => setSelectedId(event.target.value)}>
            <option value="">Choose a machine</option>
            {machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}{machine.location ? ` · ${machine.location}` : ""}</option>)}
          </select>
        </label>
      )}
      {selected && <p>{selected.name}{selected.location ? ` · ${selected.location}` : ""}. Confirm only if this is the machine you intend to document. This does not establish its operating condition.</p>}
      {error && <p role="alert">{error}</p>}
      {existingNotebookId && <p><a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub"}/v3/?notebook=${encodeURIComponent(existingNotebookId)}`}>Open this machine&apos;s existing notebook</a></p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {machines === null && error
          ? <button type="button" style={buttonStyle} onClick={() => { setMachines(null); setError(null); setReload((value) => value + 1); }}>Try again</button>
          : <button type="button" style={buttonStyle} disabled={!selected || pending} onClick={() => void confirm()}>{pending ? "Checking…" : savedBinding ? "Check saved selection" : "Confirm this machine"}</button>}
        <button type="button" style={buttonStyle} disabled={pending} onClick={() => { setChoosing(false); setSelectedId(""); setSavedBinding(null); setExistingNotebookId(null); }}>{savedBinding ? "Close" : "Cancel"}</button>
      </div>
    </section>
  );
}
