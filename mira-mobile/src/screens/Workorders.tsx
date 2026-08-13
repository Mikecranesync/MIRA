// Workorders tab — the Phase-3 vertical: list (status filter, refresh),
// detail (status/priority mutations), create (asset picker + idempotency key).
// All mutations flow through the shared layer; create generates ONE client_key
// per logical create so a retry after a network error can never duplicate
// (server contract: PR #3223; older servers ignore the key gracefully).
import { useEffect, useState, type MutableRefObject } from "react";
import {
  listWorkOrders,
  getWorkOrder,
  createWorkOrder,
  updateWorkOrder,
  listAssets,
  type WorkOrder,
  type Asset,
  type Me,
} from "../api/resources";
import { can } from "../nav";
import { Loading, Empty, ErrorState, load, type Loadable } from "./common";

type Route =
  | { name: "list" }
  | { name: "detail"; id: string }
  | { name: "create" };

const STATUS_FILTERS = ["all", "open", "in_progress", "resolved"] as const;
const NEXT_STATUS: Record<string, string[]> = {
  open: ["in_progress", "resolved"],
  in_progress: ["resolved", "open"],
  resolved: ["open"],
};

export function WorkordersTab({
  me,
  backRef,
}: {
  me: Me;
  backRef: MutableRefObject<(() => boolean) | null>;
}) {
  const [route, setRoute] = useState<Route>({ name: "list" });
  backRef.current = () => {
    if (route.name !== "list") {
      setRoute({ name: "list" });
      return true;
    }
    return false;
  };

  if (route.name === "detail")
    return (
      <Detail
        id={route.id}
        me={me}
        onBack={() => setRoute({ name: "list" })}
      />
    );
  if (route.name === "create")
    return (
      <Create
        onDone={() => setRoute({ name: "list" })}
        onCancel={() => setRoute({ name: "list" })}
      />
    );
  return (
    <List
      me={me}
      onOpen={(id) => setRoute({ name: "detail", id })}
      onCreate={() => setRoute({ name: "create" })}
    />
  );
}

function List({
  me,
  onOpen,
  onCreate,
}: {
  me: Me;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [state, setState] = useState<Loadable<WorkOrder[]>>({ state: "loading" });
  const refresh = (f = filter) => {
    setState({ state: "loading" });
    void load(() => listWorkOrders(f === "all" ? undefined : f)).then(setState);
  };
  useEffect(() => refresh(filter), [filter]);

  return (
    <div className="content bottompad">
      <div className="chip-row">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            className={`chip ${f === filter ? "chip-active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f.replace("_", " ")}
          </button>
        ))}
        <button className="chip" onClick={() => refresh()}>
          ↻
        </button>
      </div>
      {can(me.capabilities, "work_orders.create") && (
        <button className="btn-primary" style={{ margin: "10px 0" }} onClick={onCreate}>
          + New work order
        </button>
      )}
      {state.state === "loading" && <Loading what="work orders" />}
      {state.state === "error" && <ErrorState error={state.error} onRetry={() => refresh()} />}
      {state.state === "ready" && state.data.length === 0 && (
        <Empty text="No work orders match this filter." />
      )}
      {state.state === "ready" &&
        state.data.map((wo) => (
          <div key={wo.id} className="card" onClick={() => onOpen(wo.id)}>
            <h3>
              {wo.work_order_number} · {wo.title}
            </h3>
            <div className="meta">
              <span className={`badge badge-${wo.status}`}>{wo.status.replace("_", " ")}</span>{" "}
              <span className={`badge badge-prio-${wo.priority}`}>{wo.priority}</span>{" "}
              {wo.asset}
            </div>
          </div>
        ))}
    </div>
  );
}

function Detail({
  id,
  me,
  onBack,
}: {
  id: string;
  me: Me;
  onBack: () => void;
}) {
  const [state, setState] = useState<Loadable<WorkOrder | null>>({ state: "loading" });
  const [mutating, setMutating] = useState("");
  const [mutError, setMutError] = useState<unknown>(null);
  const refresh = () => {
    setState({ state: "loading" });
    void load(() => getWorkOrder(id)).then(setState);
  };
  useEffect(refresh, [id]);

  const wo = state.state === "ready" ? state.data : null;
  const mayUpdate = can(me.capabilities, "work_orders.update");

  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onBack}>
        ← Workorders
      </button>
      {state.state === "loading" && <Loading what="work order" />}
      {state.state === "error" && <ErrorState error={state.error} onRetry={refresh} />}
      {state.state === "ready" && !wo && <Empty text="Work order not found." />}
      {wo && (
        <>
          <div className="card">
            <h3>
              {wo.work_order_number} · {wo.title}
            </h3>
            <div className="meta" style={{ margin: "6px 0" }}>
              <span className={`badge badge-${wo.status}`}>{wo.status.replace("_", " ")}</span>{" "}
              <span className={`badge badge-prio-${wo.priority}`}>{wo.priority}</span>{" "}
              {wo.source_label}
            </div>
            <div className="meta">{wo.asset}</div>
            <p className="chat-answer" style={{ fontSize: 14 }}>
              {wo.description}
            </p>
            {wo.safety_warnings.length > 0 && (
              <div className="warnbox">
                {wo.safety_warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}
            {wo.suggested_actions.length > 0 && (
              <ul style={{ paddingLeft: 18, margin: "8px 0" }}>
                {wo.suggested_actions.map((a, i) => (
                  <li key={i} style={{ fontSize: 14 }}>
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {mayUpdate ? (
            <div className="card">
              <div className="meta" style={{ marginBottom: 8 }}>
                Move to:
              </div>
              {(NEXT_STATUS[wo.status] ?? []).map((s) => (
                <button
                  key={s}
                  disabled={Boolean(mutating)}
                  style={{ marginBottom: 8 }}
                  onClick={async () => {
                    setMutating(s);
                    setMutError(null);
                    try {
                      await updateWorkOrder(wo.id, { status: s });
                      refresh();
                    } catch (e) {
                      setMutError(e);
                    } finally {
                      setMutating("");
                    }
                  }}
                >
                  {mutating === s ? "Updating…" : s.replace("_", " ")}
                </button>
              ))}
              {mutError != null && <ErrorState error={mutError} />}
            </div>
          ) : (
            <div className="meta" style={{ textAlign: "center" }}>
              Your role can view but not update work orders.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Create({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [assets, setAssets] = useState<Loadable<Asset[]>>({ state: "loading" });
  const [equipmentId, setEquipmentId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  // ONE key per logical create — survives retries of the same form submission.
  const [clientKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [replayNote, setReplayNote] = useState(false);

  useEffect(() => {
    void load(listAssets).then(setAssets);
  }, []);

  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onCancel}>
        ← Cancel
      </button>
      <div className="card">
        <h3>New work order</h3>
        <label>Asset</label>
        {assets.state === "loading" && <Loading what="assets" />}
        {assets.state === "error" && <ErrorState error={assets.error} />}
        {assets.state === "ready" && (
          <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
            <option value="">Select an asset…</option>
            {assets.data.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.model_number || a.id}
              </option>
            ))}
          </select>
        )}
        <label>Title (optional)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
        <label>Description</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
        <label>Priority</label>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          {["low", "medium", "high", "critical"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 14 }}>
          <button
            className="btn-primary"
            disabled={busy || !equipmentId || !description.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await createWorkOrder({
                  equipment_id: equipmentId,
                  description: description.trim(),
                  title: title.trim() || undefined,
                  priority,
                  client_key: clientKey,
                });
                setReplayNote(r.replayed);
                onDone();
              } catch (e) {
                setError(e); // key is retained — pressing again is a SAFE replay
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create work order"}
          </button>
        </div>
        {error != null && <ErrorState error={error} />}
        {replayNote && <div className="meta">Already created (replay detected).</div>}
      </div>
    </div>
  );
}
