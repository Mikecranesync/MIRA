"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Filter } from "lucide-react";
import { useState } from "react";

type ActionType = "wo_created" | "pm_scheduled" | "diagnostic" | "manual_served" | "safety_alert" | "lookup";
type SyncStatus = "synced" | "pending" | "failed" | "none";

const TYPE_LABELS: Record<ActionType, string> = {
  wo_created: "WO Created",
  pm_scheduled: "PM",
  diagnostic: "Diagnostic",
  manual_served: "Manual",
  safety_alert: "Safety",
  lookup: "Lookup",
};

const SYNC_LABELS: Record<SyncStatus, string> = {
  synced: "Synced",
  pending: "Pending",
  failed: "Failed",
  none: "—",
};

const ALL_TYPES: ActionType[] = ["wo_created", "pm_scheduled", "diagnostic", "manual_served", "safety_alert", "lookup"];
const ALL_SYNC: SyncStatus[] = ["synced", "pending", "failed", "none"];

export function ActionsFilters({
  currentType,
  currentSync,
}: {
  currentType: string;
  currentSync: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-1)]"
        aria-label="Toggle filters"
      >
        <Filter
          className="w-4 h-4"
          style={{ color: open ? "var(--brand-blue)" : "var(--foreground-muted)" }}
        />
      </button>
      {open && (
        <div className="px-4 md:px-6 pb-3 space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {(["all", ...ALL_TYPES] as const).map((a) => (
              <button
                key={a}
                onClick={() => setFilter("type", a)}
                className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                style={
                  currentType === a || (a === "all" && currentType === "all")
                    ? { backgroundColor: "var(--brand-blue)", color: "white" }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }
                }
              >
                {a === "all" ? "All types" : TYPE_LABELS[a]}
              </button>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {(["all", ...ALL_SYNC] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter("sync", s)}
                className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                style={
                  currentSync === s || (s === "all" && currentSync === "all")
                    ? { backgroundColor: "var(--brand-blue)", color: "white" }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }
                }
              >
                {s === "all" ? "All sync" : SYNC_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
