// Schedule tab — PM schedules list (due-date sorted), capability-gated
// complete action, and the SCH-04 create flow (POST /api/pm-schedules —
// asset + task + interval; server-confirmed before the list refreshes).
import { useEffect, useState, type MutableRefObject } from "react";
import {
  listPmSchedules,
  completePmSchedule,
  createPmSchedule,
  listAssets,
  PM_INTERVAL_UNITS,
  type PmSchedule,
  type Asset,
  type Me,
} from "../api/resources";
import { can } from "../nav";
import { Loading, Empty, ErrorState, load, type Loadable } from "./common";

export function ScheduleTab({
  me,
  backRef,
}: {
  me: Me;
  backRef: MutableRefObject<(() => boolean) | null>;
}) {
  const [creating, setCreating] = useState(false);
  backRef.current = () => {
    if (creating) {
      setCreating(false);
      return true;
    }
    return false;
  };
  const [state, setState] = useState<Loadable<PmSchedule[]>>({ state: "loading" });
  const [busyId, setBusyId] = useState("");
  const [mutError, setMutError] = useState<unknown>(null);
  const [createdNote, setCreatedNote] = useState<string | null>(null);
  const refresh = () => {
    setState({ state: "loading" });
    void load(async () => {
      const rows = await listPmSchedules();
      return rows.sort((a, b) => (a.next_due_at ?? "9999").localeCompare(b.next_due_at ?? "9999"));
    }).then(setState);
  };
  useEffect(refresh, []);

  const mayComplete = can(me.capabilities, "pm_schedules.complete");
  const mayCreate = can(me.capabilities, "pm_schedules.write");

  if (creating)
    return (
      <CreateSchedule
        onCancel={() => setCreating(false)}
        onCreated={(task) => {
          setCreating(false);
          setCreatedNote(`Schedule "${task}" created.`);
          refresh();
        }}
      />
    );

  return (
    <div className="content bottompad">
      <div className="chip-row">
        <button className="chip" onClick={refresh}>
          ↻ Refresh
        </button>
      </div>
      {mayCreate && (
        <button className="btn-primary" style={{ margin: "10px 0" }} onClick={() => setCreating(true)}>
          + New PM schedule
        </button>
      )}
      {createdNote && <div className="meta">{createdNote}</div>}
      {state.state === "loading" && <Loading what="PM schedule" />}
      {state.state === "error" && <ErrorState error={state.error} onRetry={refresh} />}
      {state.state === "ready" && state.data.length === 0 && (
        <Empty
          text={
            mayCreate
              ? "No PM schedules yet. Create one, or upload a manual — MIRA extracts PM tasks automatically."
              : "No PM schedules yet in this workspace."
          }
        />
      )}
      {mutError != null && <ErrorState error={mutError} />}
      {state.state === "ready" &&
        state.data.map((s) => (
          <div key={s.id} className="card">
            <h3>{s.task}</h3>
            <div className="meta">
              {[s.manufacturer, s.model_number].filter(Boolean).join(" ") || "asset"}
              {s.interval_label ? ` · ${s.interval_label}` : ""}
              {s.criticality ? ` · ${s.criticality}` : ""}
            </div>
            <div className="meta">
              due {s.next_due_at ? s.next_due_at.slice(0, 10) : "unscheduled"}
            </div>
            {mayComplete && (
              <button
                style={{ marginTop: 8 }}
                disabled={busyId === s.id}
                onClick={async () => {
                  setBusyId(s.id);
                  setMutError(null);
                  try {
                    await completePmSchedule(s.id);
                    refresh();
                  } catch (e) {
                    setMutError(e);
                  } finally {
                    setBusyId("");
                  }
                }}
              >
                {busyId === s.id ? "Completing…" : "Mark complete"}
              </button>
            )}
          </div>
        ))}
    </div>
  );
}

function CreateSchedule({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (task: string) => void;
}) {
  const [assets, setAssets] = useState<Loadable<Asset[]>>({ state: "loading" });
  const [equipmentId, setEquipmentId] = useState("");
  const [task, setTask] = useState("");
  const [intervalValue, setIntervalValue] = useState("1");
  const [intervalUnit, setIntervalUnit] =
    useState<(typeof PM_INTERVAL_UNITS)[number]>("months");
  const [criticality, setCriticality] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void load(listAssets).then(setAssets);
  }, []);

  const parsedInterval = Number(intervalValue);
  const intervalOk = Number.isInteger(parsedInterval) && parsedInterval >= 1;
  const missing = [
    !equipmentId && "select an asset",
    !task.trim() && "describe the task",
    !intervalOk && "set a whole-number interval",
  ].filter(Boolean);

  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onCancel}>
        ← Schedule
      </button>
      <div className="card">
        <h3>New PM schedule</h3>
        <label>Asset</label>
        {assets.state === "loading" && <Loading what="assets" />}
        {assets.state === "error" && <ErrorState error={assets.error} />}
        {assets.state === "ready" && (
          <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
            <option value="">Select an asset…</option>
            {assets.data.map((a) => (
              <option key={a.id} value={a.id}>
                {[a.name || a.model_number || a.model || a.id, a.tag, a.location]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </select>
        )}
        <label>Task</label>
        <input
          value={task}
          placeholder="e.g. Grease main bearing"
          onChange={(e) => setTask(e.target.value)}
        />
        <label>Repeat every</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={intervalValue}
            inputMode="numeric"
            style={{ width: 90, flex: "none" }}
            onChange={(e) => setIntervalValue(e.target.value)}
          />
          <select
            value={intervalUnit}
            onChange={(e) =>
              setIntervalUnit(e.target.value as (typeof PM_INTERVAL_UNITS)[number])
            }
          >
            {PM_INTERVAL_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <label>Criticality</label>
        <select
          value={criticality}
          onChange={(e) => setCriticality(e.target.value as typeof criticality)}
        >
          {(["low", "medium", "high", "critical"] as const).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 14 }}>
          <button
            className="btn-primary"
            disabled={busy || missing.length > 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await createPmSchedule({
                  equipment_id: equipmentId,
                  task: task.trim(),
                  interval_value: parsedInterval,
                  interval_unit: intervalUnit,
                  criticality,
                });
                onCreated(task.trim()); // only AFTER server confirmation
              } catch (e) {
                setError(e); // recoverable — form state retained
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create schedule"}
          </button>
        </div>
        {missing.length > 0 && (
          <div className="meta" style={{ marginTop: 8 }}>
            To create: {missing.join(", ")}.
          </div>
        )}
        {error != null && <ErrorState error={error} />}
      </div>
    </div>
  );
}
