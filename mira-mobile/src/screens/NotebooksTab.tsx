// Notebook tab — the NotebookLM-style flow from the FactoryLM build spec
// (docs/prd/2026-08-13-factorylm-notebook-build-spec.md §4–6) on the existing
// equipment-notebook APIs: home card list → "+ Create new" pill / camera
// (nameplate → EDITABLE candidate → confirm) → workspace (NotebookScreen).
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  listNotebooks,
  createNotebook,
  recognizeNameplate,
  type Notebook,
  type NameplateCandidate,
} from "../api/resources";
import { ApiError } from "../api/client";
import { Loading, Empty, ErrorState, load, type Loadable } from "./common";
import { NotebookScreen } from "./NotebookScreen";

type Route =
  | { name: "home" }
  | { name: "create"; candidate?: NameplateCandidate }
  | { name: "notebook"; id: string; openAddSources?: boolean };

/** Deterministic cover color per notebook (category tiles, spec §8.2). */
export function coverClass(nb: Pick<Notebook, "id" | "equipmentType">): string {
  const palette = ["blue", "green", "amber", "violet"];
  const key = nb.equipmentType || nb.id;
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 997;
  return `nb-cover-${palette[h % palette.length]}`;
}

const COVER_GLYPHS: Record<string, string> = {
  drive: "⚡", vfd: "⚡", motor: "⚙", pump: "🌀", conveyor: "➡", plc: "🖥",
};
export function coverGlyph(equipmentType: string | null): string {
  if (!equipmentType) return "📓";
  const k = equipmentType.toLowerCase();
  for (const key of Object.keys(COVER_GLYPHS)) if (k.includes(key)) return COVER_GLYPHS[key];
  return "📓";
}

export function NotebooksTab({
  backRef,
}: {
  backRef: MutableRefObject<(() => boolean) | null>;
}) {
  const [route, setRoute] = useState<Route>({ name: "home" });
  const notebookBack = useRef<(() => boolean) | null>(null);

  backRef.current = () => {
    if (route.name === "notebook" && notebookBack.current?.()) return true;
    if (route.name !== "home") {
      setRoute({ name: "home" });
      return true;
    }
    return false;
  };

  if (route.name === "create")
    return (
      <CreateNotebook
        candidate={route.candidate}
        onCancel={() => setRoute({ name: "home" })}
        onCreated={(nb) => setRoute({ name: "notebook", id: nb.id, openAddSources: true })}
      />
    );
  if (route.name === "notebook")
    return (
      <NotebookScreen
        id={route.id}
        openAddSources={route.openAddSources}
        backRef={notebookBack}
        onExit={() => setRoute({ name: "home" })}
      />
    );
  return (
    <Home
      onOpen={(id) => setRoute({ name: "notebook", id })}
      onCreate={(candidate) => setRoute({ name: "create", candidate })}
    />
  );
}

function Home({
  onOpen,
  onCreate,
}: {
  onOpen: (id: string) => void;
  onCreate: (candidate?: NameplateCandidate) => void;
}) {
  const [state, setState] = useState<Loadable<Notebook[]>>({ state: "loading" });
  const [filter, setFilter] = useState<"all" | "recent">("all");
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => {
    setState({ state: "loading" });
    void load(listNotebooks).then(setState);
  };
  useEffect(refresh, []);

  const shown =
    state.state === "ready"
      ? filter === "recent"
        ? [...state.data]
            .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
            .slice(0, 5)
        : state.data
      : [];

  const onCameraPick = async (file: File | null) => {
    if (!file) return;
    setScanning(true);
    setScanNote(null);
    try {
      const candidate = await recognizeNameplate(file);
      onCreate(candidate);
    } catch (e) {
      // Honest failure (e.g. recognizer_not_configured 503) → manual create.
      setScanNote(
        e instanceof ApiError && e.status === 503
          ? "Nameplate recognition isn't available — create the notebook manually."
          : "Couldn't read that nameplate — create the notebook manually.",
      );
    } finally {
      setScanning(false);
    }
  };

  return (
    <>
      <div className="content" style={{ paddingBottom: 90 }}>
        <div className="chip-row">
          {(["all", "recent"] as const).map((f) => (
            <button
              key={f}
              className={`chip ${f === filter ? "chip-active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : "Recent"}
            </button>
          ))}
          <button className="chip" onClick={refresh}>
            ↻
          </button>
        </div>
        {scanNote && <div className="warnbox">{scanNote}</div>}
        {state.state === "loading" && <Loading what="notebooks" />}
        {state.state === "error" && <ErrorState error={state.error} onRetry={refresh} />}
        {state.state === "ready" && state.data.length === 0 && (
          <Empty text="No machine notebooks yet. Create one and add its manual — then ask it anything." />
        )}
        {shown.map((nb) => (
          <div key={nb.id} className="card nb-card" onClick={() => onOpen(nb.id)}>
            <div className={`nb-cover ${coverClass(nb)}`}>{coverGlyph(nb.equipmentType)}</div>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>{nb.displayName}</h3>
              <div className="meta">
                {nb.sourceCount} source{nb.sourceCount === 1 ? "" : "s"}
                {nb.createdAt ? ` · ${new Date(nb.createdAt).toLocaleDateString()}` : ""}
                {nb.identityStatus !== "user_confirmed" ? " · unconfirmed" : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="fab-row">
        <button
          className="fab-round"
          title="Scan a nameplate"
          disabled={scanning}
          onClick={() => cameraRef.current?.click()}
        >
          {scanning ? "…" : "📷"}
        </button>
        <button className="fab-pill" onClick={() => onCreate()}>
          + Create new
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          void onCameraPick(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </>
  );
}

function CreateNotebook({
  candidate,
  onCancel,
  onCreated,
}: {
  candidate?: NameplateCandidate;
  onCancel: () => void;
  onCreated: (nb: Notebook) => void;
}) {
  const [displayName, setDisplayName] = useState(
    candidate?.displayName ??
      [candidate?.manufacturer, candidate?.model].filter(Boolean).join(" "),
  );
  const [manufacturer, setManufacturer] = useState(candidate?.manufacturer ?? "");
  const [model, setModel] = useState(candidate?.model ?? "");
  const [equipmentType, setEquipmentType] = useState(candidate?.equipmentType ?? "");
  const [serialNumber, setSerialNumber] = useState(candidate?.serialNumber ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onCancel}>
        ← Notebooks
      </button>
      <div className="card">
        <h3>{candidate ? "Confirm this machine" : "New machine notebook"}</h3>
        {candidate && (
          <div className="meta" style={{ marginBottom: 8 }}>
            Read from the nameplate — edit anything that's wrong before saving.
          </div>
        )}
        <label>Name</label>
        <input
          value={displayName}
          placeholder="e.g. PowerFlex 525 — Line 1"
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <label>Manufacturer</label>
        <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        <label>Model</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} />
        <label>Equipment type</label>
        <input
          value={equipmentType}
          placeholder="drive / motor / conveyor…"
          onChange={(e) => setEquipmentType(e.target.value)}
        />
        <label>Serial number</label>
        <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
        <div style={{ marginTop: 14 }}>
          <button
            className="btn-primary"
            disabled={busy || !displayName.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const nb = await createNotebook({
                  displayName: displayName.trim(),
                  manufacturer: manufacturer.trim() || null,
                  model: model.trim() || null,
                  equipmentType: equipmentType.trim() || null,
                  serialNumber: serialNumber.trim() || null,
                  identityStatus: "user_confirmed",
                  identitySourceType: candidate ? "nameplate_image" : "user",
                });
                onCreated(nb);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create notebook"}
          </button>
        </div>
        {!displayName.trim() && (
          <div className="meta" style={{ marginTop: 8 }}>
            To create: give the machine a name.
          </div>
        )}
        {error != null && <ErrorState error={error} />}
      </div>
    </div>
  );
}
