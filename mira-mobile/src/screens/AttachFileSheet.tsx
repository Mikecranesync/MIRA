// ONE attach sheet, used from Files detail, Notebook "Add sources", a notebook
// source row, and asset detail. A file lives once and is FILED in many places;
// this is the only surface that creates those filings, so the wording, the
// pre-checked state, and the idempotency discipline can't drift between call
// sites.
import { useEffect, useState } from "react";
import {
  attachFileToTargets,
  listAssets,
  listNotebooks,
  listLocations,
  listWorkOrders,
  type FileLink,
} from "../api/resources";
import {
  attachActionLabel,
  attachCount,
  buildAttachRequest,
  existingKeys,
  targetKey,
  toggleSelection,
  type AttachTarget,
  type AttachTargetType,
  type ExistingAttachment,
} from "../lib/attach-selection";
import { Loading, Empty, ErrorState, load, type Loadable } from "./common";

const SEGMENTS: { id: AttachTargetType; title: string }[] = [
  { id: "cmms_asset", title: "Assets" },
  { id: "equipment_notebook", title: "Notebooks" },
  { id: "namespace_node", title: "Locations" },
  { id: "work_order", title: "Work orders" },
];

async function loadTargets(kind: AttachTargetType): Promise<AttachTarget[]> {
  if (kind === "cmms_asset")
    return (await listAssets()).map((a) => ({
      targetType: "cmms_asset" as const,
      targetId: a.id,
      label: a.name || a.model_number || a.model || a.id,
      sublabel: [a.manufacturer, a.tag, a.location].filter(Boolean).join(" · ") || null,
    }));
  if (kind === "equipment_notebook")
    return (await listNotebooks()).map((n) => ({
      targetType: "equipment_notebook" as const,
      targetId: n.id,
      label: n.displayName,
      sublabel:
        [n.manufacturer, n.model].filter(Boolean).join(" ") ||
        `${n.sourceCount} source${n.sourceCount === 1 ? "" : "s"}`,
    }));
  if (kind === "namespace_node")
    return (await listLocations()).map((l) => ({
      targetType: "namespace_node" as const,
      targetId: l.id,
      label: l.name,
      sublabel: l.unsPath ?? l.kind,
    }));
  return (await listWorkOrders()).map((w) => ({
    targetType: "work_order" as const,
    targetId: w.id,
    label: `${w.work_order_number} · ${w.title}`,
    sublabel: w.asset || w.status,
  }));
}

export function AttachFileSheet({
  fileId,
  filename,
  existingLinks,
  onClose,
  onAttached,
}: {
  fileId: string;
  filename: string;
  /** Current filings — rendered pre-checked and excluded from the request. */
  existingLinks: Pick<FileLink, "id" | "targetType" | "targetId">[];
  onClose: () => void;
  onAttached: (added: number) => void;
}) {
  const existing: ExistingAttachment[] = existingLinks.map((l) => ({
    linkId: l.id,
    targetType: l.targetType,
    targetId: l.targetId,
  }));
  const [segment, setSegment] = useState<AttachTargetType>("cmms_asset");
  const [q, setQ] = useState("");
  const [targets, setTargets] = useState<Record<string, Loadable<AttachTarget[]>>>({});
  const [selection, setSelection] = useState<string[]>(() => existingKeys(existing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // ONE key per sheet instance: every retry of this attach replays the SAME
  // idempotent request, so a flaky network can't duplicate links.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (targets[segment]) return;
    setTargets((t) => ({ ...t, [segment]: { state: "loading" } }));
    void load(() => loadTargets(segment)).then((s) =>
      setTargets((t) => ({ ...t, [segment]: s })),
    );
  }, [segment]); // eslint-disable-line react-hooks/exhaustive-deps

  const state = targets[segment];
  const needle = q.trim().toLowerCase();
  const rows =
    state?.state === "ready"
      ? state.data.filter(
          (t) =>
            !needle ||
            t.label.toLowerCase().includes(needle) ||
            (t.sublabel ?? "").toLowerCase().includes(needle),
        )
      : [];
  const toAdd = attachCount(selection, existing);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Attach “{filename}”</h3>
        <div className="meta" style={{ marginBottom: 8 }}>
          The file stays where it is — attaching files it in another place too.
        </div>
        <input
          placeholder="Search destinations…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="chip-row" style={{ marginTop: 10 }}>
          {SEGMENTS.map((s) => (
            <button
              key={s.id}
              className={`chip ${s.id === segment ? "chip-active" : ""}`}
              onClick={() => setSegment(s.id)}
            >
              {s.title}
            </button>
          ))}
        </div>

        {state?.state === "loading" && <Loading what="destinations" />}
        {state?.state === "error" && <ErrorState error={state.error} />}
        {state?.state === "ready" && rows.length === 0 && (
          <Empty text={needle ? "No destination matches that search." : "Nothing here to file into yet."} />
        )}
        {rows.map((t) => {
          const key = targetKey(t);
          const already = existingKeys(existing).includes(key);
          return (
            <label key={key} className="source-row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={selection.includes(key)}
                disabled={already}
                onChange={() => setSelection((s) => toggleSelection(s, key))}
              />
              <div className="grow">
                <div className="title">{t.label}</div>
                <div className="meta">
                  {t.sublabel ?? ""}
                  {already ? " · already attached here" : ""}
                </div>
              </div>
            </label>
          );
        })}

        {error != null && <ErrorState error={error} />}
        <button
          className="btn-primary"
          style={{ marginTop: 12 }}
          disabled={busy || toAdd === 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const req = buildAttachRequest(selection, existing);
              await attachFileToTargets(fileId, req, idempotencyKey);
              onAttached(req.length);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Attaching…" : attachActionLabel(selection, existing)}
        </button>
        {toAdd === 0 && (
          <div className="meta" style={{ marginTop: 6 }}>
            To attach: pick at least one destination it isn't filed under yet.
          </div>
        )}
        <button style={{ marginTop: 8 }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
