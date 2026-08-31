// More tab — identity, Files (the workspace file manager), capability-filtered
// sections (team, usage), sign out. The "sheet of remaining sections" grows in
// later phases; account deletion lands here in Phase 5 (store requirement).
import { useEffect, useState, type MutableRefObject } from "react";
import { listTeam, getUsage, type Me, type TeamMember } from "../api/resources";
import { Loading, ErrorState, load, type Loadable } from "./common";
import { FilesScreen, type FilesRoute } from "./FilesScreen";
import { AboutUpdates } from "./AboutUpdates";
import { pendingCount, preferencesStore } from "../lib/offline-queue";
import {
  readChatUiChoice,
  writeChatUiChoice,
  type ChatUiChoice,
} from "../lib/chat-ui-pref";

export function MoreTab({
  me,
  onSignOut,
  backRef,
}: {
  me: Me;
  onSignOut: () => Promise<void>;
  backRef: MutableRefObject<(() => boolean) | null>;
}) {
  const [team, setTeam] = useState<Loadable<TeamMember[]> | null>(null);
  const [chatUi, setChatUi] = useState<ChatUiChoice>("v2");
  useEffect(() => {
    void readChatUiChoice().then(setChatUi);
  }, []);
  const [usage, setUsage] = useState<Loadable<Record<string, unknown> | null> | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [files, setFiles] = useState<FilesRoute | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  // Android back pops the pushed views before leaving the tab. This is assigned
  // BEFORE any early return: a pushed view that renders without registering its
  // back handler is unpoppable, and hardware back then falls through to
  // minimizeApp — the technician taps back and the whole app disappears.
  backRef.current = () => {
    if (showAbout) {
      setShowAbout(false);
      return true;
    }
    if (files?.name === "detail") {
      setFiles({ name: "list" });
      return true;
    }
    if (files) {
      setFiles(null);
      return true;
    }
    return false;
  };

  // About is a pushed view: rendered INSTEAD of the tab body so the technician
  // is never looking at two screens' worth of chrome.
  if (showAbout) {
    return (
      <AboutUpdates
        // Never swap the bundle while work is still only on this phone.
        pendingOfflineWork={async () => (await pendingCount(preferencesStore, me.tenantId)) > 0}
        onBack={() => setShowAbout(false)}
      />
    );
  }

  if (files)
    return <FilesScreen route={files} setRoute={setFiles} onBack={() => setFiles(null)} />;

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

      <div className="card" onClick={() => setFiles({ name: "list" })}>
        <h3>Files</h3>
        <div className="meta">
          Every manual, drawing, and photo in this workspace — and where each
          one is filed.
        </div>
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

      {/* Chat style (PRD §12.4 device-local flag). The new conversation
          surface is the default; this is the one-tap way back to the classic
          screen if anything misbehaves on the floor — the rollback lever that
          does not need a release. */}
      <div className="card" style={{ marginTop: 10 }}>
        <div className="title">Chat style</div>
        <div className="meta" style={{ marginBottom: 8 }}>
          {chatUi === "v2"
            ? "New conversation (streaming, attachments, cited answers)."
            : "Classic chat screen."}
        </div>
        <button
          data-testid="chat-style-toggle"
          onClick={() => {
            const next: ChatUiChoice = chatUi === "v2" ? "legacy" : "v2";
            setChatUi(next);
            void writeChatUiChoice(next);
          }}
        >
          {chatUi === "v2" ? "Use classic chat" : "Use new conversation"}
        </button>
      </div>

      <button style={{ marginTop: 10 }} onClick={() => setShowAbout(true)}>
        About &amp; updates
      </button>

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
