// Assets tab — list, detail, the deep-link tag-resolution landing, and the
// Phase-4 QR scan route (scan → extractAssetTag trust filter → tag landing;
// a code that isn't a FactoryLM asset link lands on the same error surface a
// bad deep link does). Detail is the field hub (punch list AST-05): nameplate
// specs + this asset's open work orders + its PM schedules.
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  listAssets,
  getAsset,
  getAssetByTag,
  openAssetNotebook,
  listWorkOrders,
  listPmSchedules,
  listAssetDocuments,
  attachFileToTargets,
  detachFileLink,
  uploadFileToTargets,
  type Asset,
  type WorkOrder,
  type PmSchedule,
  type AssetAttachedDoc,
  type AssetSuggestedDoc,
} from "../api/resources";
import { resolveScan, type ScanOutcome } from "../lib/scan-landing";
import { extractAssetTag } from "../lib/tags";
import { AttachFileSheet } from "./AttachFileSheet";
import { Sheet } from "./Sheet";
import { FilePreview } from "./FilePreview";
import {
  fileTypeIcon,
  formatSize,
  processingLabel,
  PickWorkspaceFileSheet,
} from "./FilesScreen";
import { Loading, Empty, ErrorState, load, type Loadable } from "./common";
import { ScanView, type ScanVia } from "./ScanView";

export type AssetsRoute =
  | { name: "list" }
  | { name: "detail"; id: string }
  | { name: "scan" }
  | { name: "tag"; tag: string; error?: string; via?: ScanVia };

export function AssetsTab({
  route,
  setRoute,
  backRef,
  openNotebook,
}: {
  route: AssetsRoute;
  setRoute: (r: AssetsRoute) => void;
  backRef: MutableRefObject<(() => boolean) | null>;
  /** Hands the shell a notebook id so a scan lands inside the machine's
   *  notebook rather than on a read-only asset card whose only action is Back. */
  openNotebook: (notebookId: string) => void;
}) {
  backRef.current = () => {
    if (route.name !== "list") {
      setRoute({ name: "list" });
      return true;
    }
    return false;
  };

  if (route.name === "detail")
    return <Detail id={route.id} onBack={() => setRoute({ name: "list" })} />;
  if (route.name === "scan")
    return (
      <ScanView
        onCancel={() => setRoute({ name: "list" })}
        onResult={(text, via) => {
          const tag = extractAssetTag(text);
          setRoute(
            tag
              ? { name: "tag", tag, via }
              : { name: "tag", tag: "", error: `Not a FactoryLM asset code: ${text}` },
          );
        }}
      />
    );
  if (route.name === "tag")
    return (
      <TagLanding
        tag={route.tag}
        error={route.error}
        via={route.via}
        onOpenNotebook={openNotebook}
        onOpenAsset={(id) => setRoute({ name: "detail", id })}
        onHome={() => setRoute({ name: "list" })}
      />
    );
  return (
    <List
      onOpen={(id) => setRoute({ name: "detail", id })}
      onScan={() => setRoute({ name: "scan" })}
    />
  );
}

function List({ onOpen, onScan }: { onOpen: (id: string) => void; onScan: () => void }) {
  const [state, setState] = useState<Loadable<Asset[]>>({ state: "loading" });
  const refresh = () => {
    setState({ state: "loading" });
    void load(listAssets).then(setState);
  };
  useEffect(refresh, []);
  return (
    <div className="content bottompad">
      <div className="chip-row">
        <button className="chip" onClick={refresh}>
          ↻ Refresh
        </button>
        <button className="chip" onClick={onScan}>
          ⌗ Scan QR
        </button>
      </div>
      {state.state === "loading" && <Loading what="assets" />}
      {state.state === "error" && <ErrorState error={state.error} onRetry={refresh} />}
      {state.state === "ready" && state.data.length === 0 && (
        <Empty text="No assets yet in this workspace." />
      )}
      {state.state === "ready" &&
        state.data.map((a) => (
          <div key={a.id} className="card" onClick={() => onOpen(a.id)}>
            <h3>{a.name || a.model_number || a.model || a.id}</h3>
            <div className="meta">
              {[a.manufacturer, a.model_number ?? a.model, a.tag, a.location]
                .filter(Boolean)
                .join(" · ") || a.equipment_type || a.type || "asset"}
            </div>
          </div>
        ))}
    </div>
  );
}

const SPEC_FIELDS: [string, string][] = [
  ["manufacturer", "Manufacturer"],
  ["model_number", "Model"],
  ["model", "Model"],
  ["serial_number", "Serial"],
  ["serialNumber", "Serial"],
  ["tag", "Tag"],
  ["equipment_number", "Tag"],
  ["equipment_type", "Type"],
  ["type", "Type"],
  ["location", "Location"],
  ["department", "Department"],
  ["criticality", "Criticality"],
  ["uns_path", "UNS path"],
];

function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const [state, setState] = useState<Loadable<Record<string, unknown> | null>>({
    state: "loading",
  });
  const [wos, setWos] = useState<Loadable<WorkOrder[]> | null>(null);
  const [pms, setPms] = useState<Loadable<PmSchedule[]> | null>(null);
  const refresh = () => {
    setState({ state: "loading" });
    void load(() => getAsset(id)).then(setState);
    // The asset is the field hub (AST-05): pull ITS work orders + PM schedules.
    void load(() => listWorkOrders()).then((s) =>
      setWos(
        s.state === "ready"
          ? { state: "ready", data: s.data.filter((w) => w.equipment_id === id) }
          : s,
      ),
    );
    void load(listPmSchedules).then((s) =>
      setPms(
        s.state === "ready"
          ? { state: "ready", data: s.data.filter((p) => p.equipment_id === id) }
          : s,
      ),
    );
  };
  useEffect(refresh, [id]);
  const raw = state.state === "ready" ? state.data : null;
  const a = (raw as { asset?: Record<string, unknown> } | null)?.asset ?? raw;

  const specs = a
    ? SPEC_FIELDS.reduce<[string, string][]>((acc, [key, label]) => {
        const v = a[key];
        if (v != null && String(v).trim() && !acc.some(([l]) => l === label))
          acc.push([label, String(v)]);
        return acc;
      }, [])
    : [];

  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onBack}>
        ← Assets
      </button>
      {state.state === "loading" && <Loading what="asset" />}
      {state.state === "error" && <ErrorState error={state.error} onRetry={refresh} />}
      {state.state === "ready" && !a && <Empty text="Asset not found (or no access)." />}
      {a && (
        <>
          <div className="card">
            <h3>{String(a.name ?? id)}</h3>
            {specs.length === 0 && <div className="meta">No nameplate data recorded.</div>}
            {specs.map(([label, value]) => (
              <div key={label} className="meta">
                {label}: <span style={{ color: "var(--fl-ink)" }}>{value}</span>
              </div>
            ))}
          </div>
          <AssetFilesCard assetId={id} assetName={String(a.name ?? id)} />
          <div className="card">
            <h3>Work orders</h3>
            {wos?.state === "loading" && <Loading what="work orders" />}
            {wos?.state === "error" && <ErrorState error={wos.error} />}
            {wos?.state === "ready" && wos.data.length === 0 && (
              <div className="meta">No work orders for this asset.</div>
            )}
            {wos?.state === "ready" &&
              wos.data.slice(0, 10).map((w) => (
                <div key={w.id} className="meta" style={{ padding: "4px 0" }}>
                  <span className={`badge badge-${w.status}`}>{w.status.replace("_", " ")}</span>{" "}
                  {w.work_order_number} · {w.title}
                </div>
              ))}
          </div>
          <div className="card">
            <h3>PM schedule</h3>
            {pms?.state === "loading" && <Loading what="PM schedules" />}
            {pms?.state === "error" && <ErrorState error={pms.error} />}
            {pms?.state === "ready" && pms.data.length === 0 && (
              <div className="meta">No PM schedules for this asset.</div>
            )}
            {pms?.state === "ready" &&
              pms.data.map((p) => (
                <div key={p.id} className="meta" style={{ padding: "4px 0" }}>
                  {p.task}
                  {p.interval_label ? ` · ${p.interval_label}` : ""}
                  {p.next_due_at ? ` · due ${new Date(p.next_due_at).toLocaleDateString()}` : ""}
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}


/** Files filed under this asset — the field-hub document shelf.
 *
 *  Two lists the server keeps separate and the UI must NOT merge:
 *   • Attached — a technician explicitly filed this file here. Real link ids,
 *     so Open / Attach elsewhere / Detach all act on a real relationship.
 *   • Suggested — matched from the shared corpus on the asset's
 *     manufacturer/model. Nobody filed it. It is labelled as a suggestion and
 *     never given a Detach action, because there is nothing to detach.
 */
function AssetFilesCard({ assetId, assetName }: { assetId: string; assetName: string }) {
  const [docs, setDocs] = useState<Loadable<{
    attached: AssetAttachedDoc[];
    suggested: AssetSuggestedDoc[];
  }> | null>(null);
  const [openFile, setOpenFile] = useState<AssetAttachedDoc | null>(null);
  const [attachSheet, setAttachSheet] = useState<AssetAttachedDoc | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addFileRef = useRef<HTMLInputElement | null>(null);

  /** Upload straight from the asset via the target-agnostic Files door. The
   *  server parks the bytes before attaching, so even a failure leaves the file
   *  in the workspace — the copy says that rather than implying it was lost. */
  const onAddFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setNote("Adding the file…");
    try {
      const r = await uploadFileToTargets(file, [
        { targetType: "cmms_asset", targetId: assetId },
      ]);
      setNote(
        r.duplicate
          ? "That file was already in your workspace — filed here too."
          : r.warning ??
              (r.indexed
                ? "Added and indexed."
                : "Added. This file type is kept and viewable, but isn't searchable in chat."),
      );
    } catch {
      setNote("Couldn't finish adding that file. It may still be in Files — check there before retrying.");
    }
    setBusy(false);
    refresh();
  };

  const refresh = () => {
    void load(() => listAssetDocuments(assetId)).then(setDocs);
  };
  useEffect(refresh, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const attached = docs?.state === "ready" ? docs.data.attached : [];
  const suggested = docs?.state === "ready" ? docs.data.suggested : [];

  const attachExisting = async (fileId: string, filename: string) => {
    setBusy(true);
    setNote(null);
    try {
      await attachFileToTargets(
        fileId,
        [{ targetType: "cmms_asset", targetId: assetId, displayLabel: assetName }],
        crypto.randomUUID(),
      );
      setNote(`“${filename}” attached to this asset.`);
      setPickOpen(false);
      refresh();
    } catch {
      setNote("Couldn't attach that file — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Files</h3>
      <div className="meta">
        {docs?.state !== "ready"
          ? "Documents and photos filed under this asset."
          : attached.length === 0
            ? "No files attached to this asset yet."
            : `${attached.length} file${attached.length === 1 ? "" : "s"} attached to this asset.`}
      </div>

      {docs?.state === "loading" && <Loading what="files" />}
      {docs?.state === "error" && <ErrorState error={docs.error} onRetry={refresh} />}
      {attached.map((f) => (
        <div key={f.linkId} className="source-row">
          <div className="grow">
            <div className="title">
              {fileTypeIcon(f.mimeType)} {f.displayLabel ?? f.filename}
            </div>
            <div className="meta">
              {formatSize(f.sizeBytes)} ·{" "}
              {processingLabel({ capability: f.capability, indexed: f.indexed })}
              {f.role ? ` · ${f.role}` : ""}
            </div>
          </div>
          <button className="detach row-action" onClick={() => setOpenFile(f)}>
            Open
          </button>
          <button className="detach row-action" onClick={() => setAttachSheet(f)}>
            Attach elsewhere
          </button>
          <button
            className="detach"
            onClick={async () => {
              if (
                !window.confirm(
                  `Detach “${f.filename}” from ${assetName}? The file stays in your workspace.`,
                )
              )
                return;
              try {
                await detachFileLink(f.fileId, f.linkId);
                setNote("Detached. The file is still in your workspace.");
              } catch {
                setNote("Couldn't detach — try again.");
              }
              refresh();
            }}
          >
            Detach
          </button>
        </div>
      ))}

      {suggested.length > 0 && (
        <>
          <div className="meta" style={{ marginTop: 14, fontWeight: 600 }}>
            Suggested manuals — matched on this asset's manufacturer/model, NOT
            attached here
          </div>
          {suggested.map((s) => (
            <div key={s.sourceUrl ?? s.title} className="source-row">
              <div className="grow">
                <div className="title">📄 {s.title}</div>
                <div className="meta">
                  suggestion · {s.chunkCount} indexed section
                  {s.chunkCount === 1 ? "" : "s"}
                  {s.modelNumber ? ` · ${s.modelNumber}` : ""}
                  {s.verified ? " · verified" : ""}
                </div>
              </div>
            </div>
          ))}
          <div className="meta">
            These come from the shared manual library. Nobody filed them here —
            attach one from Files if it's the right document.
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button disabled={busy} onClick={() => addFileRef.current?.click()}>
          Add file
        </button>
        <button disabled={busy} onClick={() => setPickOpen(true)}>
          Attach existing file
        </button>
      </div>
      {/* Uploads from an asset go through the target-agnostic door
          (POST /api/files/): an asset has no namespace node, so the file is
          parked and filed here as a stored/viewable attachment. Indexing for
          chat still requires a node, which is what a machine notebook gives it. */}
      <input
        ref={addFileRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          void onAddFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <div className="meta" style={{ marginTop: 8 }}>
        Files added here are kept and viewable. To make a document searchable in
        chat, add it in a machine notebook.
      </div>
      {note && (
        <div className="meta" style={{ marginTop: 8 }}>
          {note}
        </div>
      )}

      {openFile && (
        <Sheet label={openFile.filename} onClose={() => setOpenFile(null)}>
            <h3>{openFile.filename}</h3>
            <FilePreview
              fileId={openFile.fileId}
              filename={openFile.filename}
              mimeType={openFile.mimeType}
            />
            <button style={{ marginTop: 12 }} onClick={() => setOpenFile(null)}>
              Close
            </button>
        </Sheet>
      )}
      {pickOpen && (
        <PickWorkspaceFileSheet
          title={`Attach an existing file to ${assetName}`}
          hint="The file stays in Files — this adds another place it's filed."
          excludeFileIds={attached.map((f) => f.fileId)}
          busy={busy}
          onClose={() => setPickOpen(false)}
          onPick={(f) => void attachExisting(f.id, f.filename)}
        />
      )}
      {attachSheet && (
        <AttachFileSheet
          fileId={attachSheet.fileId}
          filename={attachSheet.filename}
          existingLinks={[
            { id: attachSheet.linkId, targetType: "cmms_asset", targetId: assetId },
          ]}
          onClose={() => setAttachSheet(null)}
          onAttached={(added) => {
            setAttachSheet(null);
            setNote(`Attached to ${added} more place${added === 1 ? "" : "s"}.`);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * Where a scan lands.
 *
 * Resolve the tag, then open THE notebook for that machine — the point of
 * scanning is to ask a question, and an asset card whose only action is Back is
 * a dead end at the machine.
 *
 * Every failure keeps a way forward. A technician standing at a running
 * conveyor with a blank screen has been failed twice: once by the error, and
 * again by having nothing to tap.
 */
function TagLanding({
  tag,
  error,
  via = "qr",
  onOpenNotebook,
  onOpenAsset,
  onHome,
}: {
  tag: string;
  error?: string;
  via?: ScanVia;
  onOpenNotebook: (notebookId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onHome: () => void;
}) {
  // The decision lives in lib/scan-landing.ts (pure, unit-tested); this
  // component only renders it.
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);

  useEffect(() => {
    if (!tag || error) return;
    let cancelled = false;
    setOutcome(null);
    void resolveScan(tag, { getAssetByTag, openAssetNotebook }, via).then((o) => {
      if (cancelled) return;
      if (o.kind === "notebook") onOpenNotebook(o.notebookId);
      else setOutcome(o);
    });
    return () => {
      cancelled = true;
    };
  }, [tag, error, via]);

  return (
    <div className="content bottompad">
      {error && <div className="empty">{error}</div>}
      {!error && outcome === null && <Loading what={`asset ${tag}`} />}
      {!error && outcome?.kind === "notfound" && (
        <Empty text={`No asset with tag “${tag}” in this workspace.`} />
      )}
      {!error && outcome?.kind === "failed" && <Empty text={outcome.message} />}
      {!error && outcome?.kind === "asset_only" && <Empty text={outcome.message} />}
      {outcome?.kind === "asset_only" && (
        <button onClick={() => onOpenAsset(outcome.assetId)} style={{ marginTop: 16 }}>
          Open asset
        </button>
      )}
      <button onClick={onHome} style={{ marginTop: 16 }}>
        Continue
      </button>
    </div>
  );
}
