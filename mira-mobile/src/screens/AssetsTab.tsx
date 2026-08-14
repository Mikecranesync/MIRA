// Assets tab — list, detail, the deep-link tag-resolution landing, and the
// Phase-4 QR scan route (scan → extractAssetTag trust filter → tag landing;
// a code that isn't a FactoryLM asset link lands on the same error surface a
// bad deep link does). Detail is the field hub (punch list AST-05): nameplate
// specs + this asset's open work orders + its PM schedules.
import { useEffect, useState, type MutableRefObject } from "react";
import {
  listAssets,
  getAsset,
  getAssetByTag,
  listWorkOrders,
  listPmSchedules,
  type Asset,
  type WorkOrder,
  type PmSchedule,
} from "../api/resources";
import { extractAssetTag } from "../lib/tags";
import { Loading, Empty, ErrorState, load, type Loadable } from "./common";
import { ScanView } from "./ScanView";

export type AssetsRoute =
  | { name: "list" }
  | { name: "detail"; id: string }
  | { name: "scan" }
  | { name: "tag"; tag: string; error?: string };

export function AssetsTab({
  route,
  setRoute,
  backRef,
}: {
  route: AssetsRoute;
  setRoute: (r: AssetsRoute) => void;
  backRef: MutableRefObject<(() => boolean) | null>;
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
        onResult={(text) => {
          const tag = extractAssetTag(text);
          setRoute(
            tag
              ? { name: "tag", tag }
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
        onOpen={(id) => setRoute({ name: "detail", id })}
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

function TagLanding({
  tag,
  error,
  onOpen,
  onHome,
}: {
  tag: string;
  error?: string;
  onOpen: (id: string) => void;
  onHome: () => void;
}) {
  const [state, setState] = useState<"loading" | "notfound" | "failed">("loading");
  useEffect(() => {
    if (!tag || error) return;
    setState("loading");
    void getAssetByTag(tag)
      .then((a) => {
        if (a?.id) onOpen(a.id);
        else setState("notfound");
      })
      .catch(() => setState("failed"));
  }, [tag, error]);
  return (
    <div className="content bottompad">
      {error && <div className="empty">{error}</div>}
      {!error && state === "loading" && <Loading what={`asset ${tag}`} />}
      {!error && state === "notfound" && (
        <Empty text={`No asset with tag “${tag}” in this workspace.`} />
      )}
      {!error && state === "failed" && (
        <Empty text="Could not resolve the tag — check connectivity." />
      )}
      <button onClick={onHome} style={{ marginTop: 16 }}>
        Continue
      </button>
    </div>
  );
}
