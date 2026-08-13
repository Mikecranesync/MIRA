// Assets tab — list, detail, the deep-link tag-resolution landing, and the
// Phase-4 QR scan route (scan → extractAssetTag trust filter → tag landing;
// a code that isn't a FactoryLM asset link lands on the same error surface a
// bad deep link does).
import { useEffect, useState, type MutableRefObject } from "react";
import { listAssets, getAsset, getAssetByTag, type Asset } from "../api/resources";
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
            <h3>{a.name || a.model_number || a.id}</h3>
            <div className="meta">
              {[a.manufacturer, a.model_number, a.equipment_number]
                .filter(Boolean)
                .join(" · ") || a.equipment_type || "asset"}
            </div>
          </div>
        ))}
    </div>
  );
}

function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const [state, setState] = useState<Loadable<Record<string, unknown> | null>>({
    state: "loading",
  });
  const refresh = () => {
    setState({ state: "loading" });
    void load(() => getAsset(id)).then(setState);
  };
  useEffect(refresh, [id]);
  const raw = state.state === "ready" ? state.data : null;
  const a = (raw as { asset?: Record<string, unknown> } | null)?.asset ?? raw;
  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onBack}>
        ← Assets
      </button>
      {state.state === "loading" && <Loading what="asset" />}
      {state.state === "error" && <ErrorState error={state.error} onRetry={refresh} />}
      {state.state === "ready" && !a && <Empty text="Asset not found (or no access)." />}
      {a && (
        <div className="card">
          <h3>{String(a.name ?? id)}</h3>
          <div className="meta">
            {["manufacturer", "model_number", "equipment_type", "equipment_number", "uns_path"]
              .map((k) => a[k])
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
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
