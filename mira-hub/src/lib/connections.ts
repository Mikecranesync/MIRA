/**
 * Client-side connection state.
 *
 * Previously localStorage-only; now the Hub's /api/connections is the source
 * of truth. This module is a thin async wrapper around that endpoint.
 *
 * The returned ConnectionMeta shape is preserved for backwards-compat with
 * the channels page's existing card props — callers just need to await
 * fetchConnections() up front and treat the result as read-only.
 */

export type Provider =
  | "telegram"
  | "slack"
  | "teams"
  | "openwebui"
  | "google"
  | "microsoft"
  | "dropbox"
  | "confluence";

export type ConnectionMeta = {
  connected: boolean;
  connectedAt?: string;
  displayName?: string;
  workspace?: string;
  botUsername?: string;
  email?: string;
  fileCount?: number;
  siteName?: string;
  siteUrl?: string;
  cloudId?: string;
  error?: string;
};

type ConnectionMap = Partial<Record<Provider, ConnectionMeta>>;

export async function fetchConnections(): Promise<ConnectionMap> {
  try {
    const res = await fetch("/hub/api/connections", { cache: "no-store" });
    if (!res.ok) return {};
    return (await res.json()) as ConnectionMap;
  } catch {
    return {};
  }
}

export async function disconnect(provider: Provider): Promise<boolean> {
  try {
    const res = await fetch(`/hub/api/connections/${provider}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}
