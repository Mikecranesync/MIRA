// Schedule tab — PM schedules list (due-date sorted) + capability-gated
// complete action.
import { useEffect, useState, type MutableRefObject } from "react";
import {
  listPmSchedules,
  completePmSchedule,
  type PmSchedule,
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
  backRef.current = () => false; // flat tab — no inner stack
  const [state, setState] = useState<Loadable<PmSchedule[]>>({ state: "loading" });
  const [busyId, setBusyId] = useState("");
  const [mutError, setMutError] = useState<unknown>(null);
  const refresh = () => {
    setState({ state: "loading" });
    void load(async () => {
      const rows = await listPmSchedules();
      return rows.sort((a, b) => (a.next_due_at ?? "9999").localeCompare(b.next_due_at ?? "9999"));
    }).then(setState);
  };
  useEffect(refresh, []);

  const mayComplete = can(me.capabilities, "pm_schedules.complete");

  return (
    <div className="content bottompad">
      <div className="chip-row">
        <button className="chip" onClick={refresh}>
          ↻ Refresh
        </button>
      </div>
      {state.state === "loading" && <Loading what="PM schedule" />}
      {state.state === "error" && <ErrorState error={state.error} onRetry={refresh} />}
      {state.state === "ready" && state.data.length === 0 && (
        <Empty text="No PM schedules yet in this workspace." />
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
