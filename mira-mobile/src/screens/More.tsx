// More tab — identity, capability-filtered sections (team, usage), sign out.
// The "sheet of remaining sections" grows in later phases; account deletion
// lands here in Phase 5 (store requirement).
import { useEffect, useState, type MutableRefObject } from "react";
import { listTeam, getUsage, type Me, type TeamMember } from "../api/resources";
import { Loading, ErrorState, load, type Loadable } from "./common";

export function MoreTab({
  me,
  onSignOut,
  backRef,
}: {
  me: Me;
  onSignOut: () => Promise<void>;
  backRef: MutableRefObject<(() => boolean) | null>;
}) {
  backRef.current = () => false;
  const [team, setTeam] = useState<Loadable<TeamMember[]> | null>(null);
  const [usage, setUsage] = useState<Loadable<Record<string, unknown> | null> | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="content bottompad">
      <div className="card">
        <h3>{me.name || me.email}</h3>
        <div className="meta">{me.email}</div>
        <div className="meta">
          role: {me.role || "(none — least privilege)"} · {me.capabilities.length} capabilities
        </div>
        <div className="meta">tenant {me.tenantId.slice(0, 8)}…</div>
      </div>

      <div className="card" onClick={() => void load(listTeam).then(setTeam)}>
        <h3>Team</h3>
        {team === null && <div className="meta">Tap to load members</div>}
        {team?.state === "loading" && <Loading what="team" />}
        {team?.state === "error" && <ErrorState error={team.error} />}
        {team?.state === "ready" && team.data.length === 0 && (
          <div className="meta">No team members yet.</div>
        )}
        {team?.state === "ready" &&
          team.data.map((m) => (
            <div key={m.email} className="meta">
              {m.email} · {m.role || "member"} · {m.status}
            </div>
          ))}
      </div>

      <div className="card" onClick={() => void load(getUsage).then(setUsage)}>
        <h3>Usage</h3>
        {usage === null && <div className="meta">Tap to load</div>}
        {usage?.state === "loading" && <Loading what="usage" />}
        {usage?.state === "error" && <ErrorState error={usage.error} />}
        {usage?.state === "ready" && (
          <div className="meta">
            {Object.entries(usage.data ?? {})
              .filter(([, v]) => typeof v === "number" || typeof v === "string")
              .slice(0, 6)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(" · ") || "no usage data"}
          </div>
        )}
      </div>

      <button
        style={{ marginTop: 10 }}
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          try {
            await onSignOut(); // may decline (unsynced-queue confirm)
          } finally {
            setSigningOut(false);
          }
        }}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
      <div className="meta" style={{ textAlign: "center", marginTop: 10 }}>
        Signing out clears all local data on this device.
      </div>
    </div>
  );
}
