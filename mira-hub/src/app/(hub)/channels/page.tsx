"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Settings, X, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/config";
import {
  setConnection,
  removeConnection,
  getAllConnections,
  type Provider,
  type ConnectionMeta,
} from "@/lib/connections";

type AuthStatus = {
  telegram: { configured: boolean; botUsername: string | null };
  slack: { configured: boolean; hasOAuth: boolean };
  google: { hasOAuth: boolean };
  microsoft: { hasOAuth: boolean };
  dropbox: { hasOAuth: boolean };
  confluence: { hasOAuth: boolean };
};

type CardProps = {
  emoji: string;
  name: string;
  description: string;
  conn: ConnectionMeta;
  onConnect: () => void;
  onDisconnect: () => void;
  connectedLabel: string;
  disabled?: boolean;
  disabledReason?: string;
  comingSoon?: boolean;
  infoOnly?: boolean;
};

function ConnectorCard({
  emoji, name, description, conn, onConnect, onDisconnect,
  connectedLabel, disabled, disabledReason, comingSoon, infoOnly,
}: CardProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
          style={{ backgroundColor: "var(--surface-1)" }}
        >
          {emoji}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              {name}
            </span>
            {conn.connected && (
              <span className="flex items-center gap-1 text-[11px]" style={{ color: "#16A34A" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#22C55E" }} />
                Connected
              </span>
            )}
            {comingSoon && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}
              >
                Coming Soon
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--foreground-muted)" }}>
            {conn.connected ? connectedLabel : description}
          </p>
          {conn.error && (
            <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: "#DC2626" }}>
              <AlertCircle className="w-3 h-3" />
              {conn.error}
            </p>
          )}
        </div>

        {!comingSoon && !infoOnly && (
          <div className="flex-shrink-0">
            {conn.connected ? (
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" className="text-xs h-7 px-2.5 gap-1">
                  <Settings className="w-3 h-3" />
                  Manage
                </Button>
                <Button
                  size="sm" variant="secondary" className="text-xs h-7 w-7 p-0"
                  onClick={onDisconnect}
                  style={{ color: "#DC2626" }}
                  title="Disconnect"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : disabled ? (
              <Button
                size="sm" variant="secondary" className="text-xs h-7 px-2.5 opacity-50"
                disabled title={disabledReason}
              >
                Connect
              </Button>
            ) : (
              <Button
                size="sm" className="text-xs h-7 px-2.5"
                style={{ backgroundColor: "var(--brand-blue)", color: "white" }}
                onClick={onConnect}
              >
                Connect
              </Button>
            )}
          </div>
        )}

        {infoOnly && (
          <span className="text-[11px] flex-shrink-0" style={{ color: "var(--foreground-subtle)" }}>
            ↓ below
          </span>
        )}
      </div>
    </div>
  );
}

function Modal({
  title, children, onClose,
}: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ backgroundColor: "var(--surface-0)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors hover:bg-[var(--surface-1)]"
          >
            <X className="w-4 h-4" style={{ color: "var(--foreground-muted)" }} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ChannelsInner() {
  const t = useTranslations("channels");
  const searchParams = useSearchParams();

  const [connections, setConnections] = useState<Partial<Record<Provider, ConnectionMeta>>>({});
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    telegram: { configured: false, botUsername: null },
    slack: { configured: false, hasOAuth: false },
    google: { hasOAuth: false },
    microsoft: { hasOAuth: false },
    dropbox: { hasOAuth: false },
    confluence: { hasOAuth: false },
  });
  const [modal, setModal] = useState<"telegram" | "openwebui" | "maintainx" | null>(null);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [openwebuiUrl, setOpenwebuiUrl] = useState("http://localhost:3000");
  const [maintainxKey, setMaintainxKey] = useState("");
  const [maintainxLoading, setMaintainxLoading] = useState(false);
  const [maintainxError, setMaintainxError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setConnections(getAllConnections());
  }, []);

  useEffect(() => {
    const provider = searchParams.get("provider") as Provider | null;
    const status = searchParams.get("status");
    const meta = searchParams.get("meta");
    const reason = searchParams.get("reason");

    if (provider && status === "connected" && meta) {
      try {
        const parsed = JSON.parse(decodeURIComponent(meta));
        setConnection(provider, { connected: true, ...parsed });
      } catch { /* malformed meta */ }
      window.history.replaceState({}, "", window.location.pathname);
    } else if (provider && status === "error") {
      setConnection(provider, { connected: false, error: reason ?? "unknown" });
      window.history.replaceState({}, "", window.location.pathname);
    }

    refresh();

    fetch(`${API_BASE}/api/auth/status`)
      .then(r => r.json())
      .then((d: AuthStatus) => setAuthStatus(d))
      .catch(() => {});
  }, [searchParams, refresh]);

  function conn(p: Provider): ConnectionMeta {
    return connections[p] ?? { connected: false };
  }

  function disconnect(p: Provider) {
    removeConnection(p);
    refresh();
  }

  async function handleTelegramConnect() {
    setTelegramLoading(true);
    setTelegramError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: telegramToken.trim() }),
      });
      const data = await res.json();
      if (data.valid) {
        setConnection("telegram", {
          connected: true,
          botUsername: data.bot?.username,
          displayName: data.bot?.firstName ?? "MIRA Bot",
        });
        setModal(null);
        setTelegramToken("");
        refresh();
      } else {
        setTelegramError(data.error ?? "Invalid token — check with @BotFather");
      }
    } catch {
      setTelegramError("Network error — please try again");
    } finally {
      setTelegramLoading(false);
    }
  }

  function handleOpenWebuiConnect() {
    setConnection("openwebui", {
      connected: true,
      displayName: "Open WebUI",
      workspace: openwebuiUrl.trim(),
    });
    setModal(null);
    refresh();
  }

  async function handleMaintainxConnect() {
    setMaintainxLoading(true);
    setMaintainxError(null);
    try {
      const res = await fetch(`${API_BASE}/api/integrations/nango/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "maintainx", apiKey: maintainxKey.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setConnection("maintainx", {
          connected: true,
          displayName: "MaintainX",
        });
        setModal(null);
        setMaintainxKey("");
        refresh();
      } else {
        setMaintainxError(data.error ?? "Invalid API key — check MaintainX Settings → API");
      }
    } catch {
      setMaintainxError("Network error — please try again");
    } finally {
      setMaintainxLoading(false);
    }
  }

  const telegramConn = conn("telegram");
  const slackConn = conn("slack");
  const teamsConn = conn("teams");
  const openwebuiConn = conn("openwebui");
  const googleConn = conn("google");
  const microsoftConn = conn("microsoft");
  const dropboxConn = conn("dropbox");
  const confluenceConn = conn("confluence");
  const maintainxConn = conn("maintainx");

  const connectedCount = Object.values(connections).filter(c => c?.connected).length;

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        <div className="px-4 md:px-6 py-3">
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            {t("title")}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
            {connectedCount} connected · Communication channels and document sources
          </p>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-2xl mx-auto space-y-6">

        {/* Section 1: Communication Channels */}
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: "var(--foreground-subtle)" }}
          >
            Communication Channels
          </h2>
          <div className="space-y-2">
            <ConnectorCard
              emoji="✈️" name="Telegram"
              description="Field techs send photos, voice notes, and diagnostic questions directly to MIRA"
              conn={telegramConn}
              onConnect={() => setModal("telegram")}
              onDisconnect={() => disconnect("telegram")}
              connectedLabel={telegramConn.botUsername ? `@${telegramConn.botUsername}` : "Bot connected"}
            />
            <ConnectorCard
              emoji="💼" name="Slack"
              description="Team-wide MIRA alerts, work order updates, and maintenance requests"
              conn={slackConn}
              onConnect={() => { window.location.href = `${API_BASE}/api/auth/slack`; }}
              onDisconnect={() => disconnect("slack")}
              connectedLabel={slackConn.workspace ?? "Workspace connected"}
              disabled={!authStatus.slack.configured && !authStatus.slack.hasOAuth && !slackConn.connected}
              disabledReason="Slack app credentials not configured"
            />
            <ConnectorCard
              emoji="🔷" name="Microsoft Teams"
              description="Enterprise integration for organizations running on Microsoft 365"
              conn={teamsConn}
              onConnect={() => { window.location.href = `${API_BASE}/api/auth/microsoft`; }}
              onDisconnect={() => disconnect("teams")}
              connectedLabel={teamsConn.email ?? teamsConn.displayName ?? "Teams connected"}
              disabled={!authStatus.microsoft.hasOAuth && !teamsConn.connected}
              disabledReason="Azure app credentials not configured"
            />
            <ConnectorCard
              emoji="💬" name="WhatsApp"
              description="Secondary channel for techs who prefer WhatsApp — same MIRA capabilities"
              conn={{ connected: false }}
              onConnect={() => {}}
              onDisconnect={() => {}}
              connectedLabel=""
              comingSoon
            />
            <ConnectorCard
              emoji="📧" name="Email"
              description="Connect via Google or Microsoft in Document Sources below to enable email ingest"
              conn={{ connected: googleConn.connected || microsoftConn.connected }}
              onConnect={() => {}}
              onDisconnect={() => {}}
              connectedLabel="Enabled via Google or Microsoft connection"
              infoOnly
            />
            <ConnectorCard
              emoji="🖥️" name="Open WebUI"
              description="Browser-based chat with full conversation history, file uploads, and tool call visibility"
              conn={openwebuiConn}
              onConnect={() => {
                setOpenwebuiUrl(openwebuiConn.workspace ?? "http://localhost:3000");
                setModal("openwebui");
              }}
              onDisconnect={() => disconnect("openwebui")}
              connectedLabel={openwebuiConn.workspace ?? "Instance connected"}
            />
          </div>
        </section>

        {/* Section 2: CMMS Connectors */}
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: "var(--foreground-subtle)" }}
          >
            CMMS Connectors
          </h2>
          <div className="space-y-2">
            <ConnectorCard
              emoji="🔧" name="MaintainX"
              description="Sync work orders, assets, and parts — AI-powered diagnostics flow directly into MaintainX"
              conn={maintainxConn}
              onConnect={() => {
                setMaintainxKey(maintainxConn.workspace ?? "");
                setModal("maintainx");
              }}
              onDisconnect={async () => {
                await fetch(`${API_BASE}/api/integrations/nango/connect?provider=maintainx`, {
                  method: "DELETE",
                });
                disconnect("maintainx");
              }}
              connectedLabel="Work orders and assets syncing via Nango"
            />
            <ConnectorCard
              emoji="🗂️" name="Atlas CMMS"
              description="FactoryLM's built-in CMMS — connected automatically"
              conn={{ connected: true }}
              onConnect={() => {}}
              onDisconnect={() => {}}
              connectedLabel="Live — work orders sync in real time"
              infoOnly
            />
            <ConnectorCard
              emoji="📋" name="Limble"
              description="Sync Limble work orders and assets with MIRA diagnostics"
              conn={{ connected: false }}
              onConnect={() => {}}
              onDisconnect={() => {}}
              connectedLabel=""
              comingSoon
            />
            <ConnectorCard
              emoji="🛠️" name="UpKeep"
              description="Connect UpKeep for automated work order creation from MIRA fault analysis"
              conn={{ connected: false }}
              onConnect={() => {}}
              onDisconnect={() => {}}
              connectedLabel=""
              comingSoon
            />
          </div>
        </section>

        {/* Section 3: Document & Knowledge Sources */}
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: "var(--foreground-subtle)" }}
          >
            Document & Knowledge Sources
          </h2>
          <div className="space-y-2">
            <ConnectorCard
              emoji="🔵" name="Google Workspace"
              description="Google Drive files, shared docs, and Gmail threads indexed for MIRA"
              conn={googleConn}
              onConnect={() => { window.location.href = `${API_BASE}/api/auth/google`; }}
              onDisconnect={() => disconnect("google")}
              connectedLabel={googleConn.email ?? googleConn.displayName ?? "Google account connected"}
            />
            <ConnectorCard
              emoji="🟦" name="Microsoft 365"
              description="SharePoint libraries, OneDrive files, and Outlook email ingest"
              conn={microsoftConn}
              onConnect={() => { window.location.href = `${API_BASE}/api/auth/microsoft`; }}
              onDisconnect={() => disconnect("microsoft")}
              connectedLabel={microsoftConn.email ?? microsoftConn.displayName ?? "Microsoft account connected"}
              disabled={!authStatus.microsoft.hasOAuth && !microsoftConn.connected}
              disabledReason="Azure app credentials not configured"
            />
            <ConnectorCard
              emoji="📦" name="Dropbox"
              description="Manuals, schematics, and maintenance documents stored in Dropbox"
              conn={dropboxConn}
              onConnect={() => { window.location.href = `${API_BASE}/api/auth/dropbox`; }}
              onDisconnect={() => disconnect("dropbox")}
              connectedLabel={dropboxConn.email ?? dropboxConn.displayName ?? "Dropbox connected"}
              disabled={!authStatus.dropbox.hasOAuth && !dropboxConn.connected}
              disabledReason="Dropbox app credentials not configured"
            />
            <ConnectorCard
              emoji="📝" name="Confluence"
              description="Atlassian Confluence wiki pages and knowledge base articles"
              conn={confluenceConn}
              onConnect={() => { window.location.href = `${API_BASE}/api/auth/confluence`; }}
              onDisconnect={() => disconnect("confluence")}
              connectedLabel={
                confluenceConn.siteName ?? confluenceConn.workspace ?? "Confluence site connected"
              }
              disabled={!authStatus.confluence.hasOAuth && !confluenceConn.connected}
              disabledReason="Atlassian app credentials not configured"
            />
          </div>
        </section>
      </div>

      {/* Telegram modal */}
      {modal === "telegram" && (
        <Modal
          title="Connect Telegram Bot"
          onClose={() => { setModal(null); setTelegramError(null); setTelegramToken(""); }}
        >
          <p className="text-xs mb-3" style={{ color: "var(--foreground-muted)" }}>
            Create a bot via <span className="font-mono font-semibold">@BotFather</span> on Telegram,
            then paste the token below. MIRA will validate it immediately.
          </p>
          <input
            type="text"
            value={telegramToken}
            onChange={e => setTelegramToken(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && telegramToken.trim()) handleTelegramConnect(); }}
            placeholder="1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"
            className="w-full text-xs px-3 py-2.5 rounded-lg border outline-none font-mono"
            style={{
              backgroundColor: "var(--surface-1)",
              borderColor: "var(--border)",
              color: "var(--foreground)",
            }}
            autoFocus
          />
          {telegramError && (
            <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: "#DC2626" }}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {telegramError}
            </p>
          )}
          <div className="flex gap-2 mt-4">
            <Button
              size="sm"
              className="flex-1 text-xs h-8 gap-1.5"
              style={{ backgroundColor: "var(--brand-blue)", color: "white" }}
              onClick={handleTelegramConnect}
              disabled={!telegramToken.trim() || telegramLoading}
            >
              {telegramLoading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Validating…</>
                : <><CheckCircle className="w-3.5 h-3.5" />Validate & Connect</>}
            </Button>
            <Button
              size="sm" variant="secondary" className="text-xs h-8 px-3"
              onClick={() => { setModal(null); setTelegramError(null); setTelegramToken(""); }}
            >
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {/* MaintainX modal */}
      {modal === "maintainx" && (
        <Modal
          title="Connect MaintainX"
          onClose={() => { setModal(null); setMaintainxError(null); setMaintainxKey(""); }}
        >
          <p className="text-xs mb-3" style={{ color: "var(--foreground-muted)" }}>
            Generate an API key at{" "}
            <span className="font-mono font-semibold">
              Settings → Integrations → API → New Key
            </span>{" "}
            (Business plan or above required). Your key is stored encrypted via Nango — MIRA never
            stores it directly.
          </p>
          <input
            type="password"
            value={maintainxKey}
            onChange={e => setMaintainxKey(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && maintainxKey.trim()) handleMaintainxConnect(); }}
            placeholder="Paste your MaintainX API key"
            className="w-full text-xs px-3 py-2.5 rounded-lg border outline-none font-mono"
            style={{
              backgroundColor: "var(--surface-1)",
              borderColor: "var(--border)",
              color: "var(--foreground)",
            }}
            autoFocus
          />
          {maintainxError && (
            <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: "#DC2626" }}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {maintainxError}
            </p>
          )}
          <div className="flex gap-2 mt-4">
            <Button
              size="sm"
              className="flex-1 text-xs h-8 gap-1.5"
              style={{ backgroundColor: "var(--brand-blue)", color: "white" }}
              onClick={handleMaintainxConnect}
              disabled={!maintainxKey.trim() || maintainxLoading}
            >
              {maintainxLoading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Connecting…</>
                : <><CheckCircle className="w-3.5 h-3.5" />Save & Connect</>}
            </Button>
            <Button
              size="sm" variant="secondary" className="text-xs h-8 px-3"
              onClick={() => { setModal(null); setMaintainxError(null); setMaintainxKey(""); }}
            >
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {/* Open WebUI modal */}
      {modal === "openwebui" && (
        <Modal title="Connect Open WebUI" onClose={() => setModal(null)}>
          <p className="text-xs mb-3" style={{ color: "var(--foreground-muted)" }}>
            Enter the base URL of your Open WebUI instance.
          </p>
          <input
            type="url"
            value={openwebuiUrl}
            onChange={e => setOpenwebuiUrl(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && openwebuiUrl.trim()) handleOpenWebuiConnect(); }}
            placeholder="http://localhost:3000"
            className="w-full text-xs px-3 py-2.5 rounded-lg border outline-none"
            style={{
              backgroundColor: "var(--surface-1)",
              borderColor: "var(--border)",
              color: "var(--foreground)",
            }}
            autoFocus
          />
          <div className="flex gap-2 mt-4">
            <Button
              size="sm"
              className="flex-1 text-xs h-8"
              style={{ backgroundColor: "var(--brand-blue)", color: "white" }}
              onClick={handleOpenWebuiConnect}
              disabled={!openwebuiUrl.trim()}
            >
              Save Connection
            </Button>
            <Button
              size="sm" variant="secondary" className="text-xs h-8 px-3"
              onClick={() => setModal(null)}
            >
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function ChannelsPage() {
  return (
    <Suspense>
      <ChannelsInner />
    </Suspense>
  );
}
