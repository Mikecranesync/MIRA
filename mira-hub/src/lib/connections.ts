export type Provider =
  | "telegram"
  | "slack"
  | "teams"
  | "openwebui"
  | "google"
  | "microsoft"
  | "dropbox"
  | "confluence"
  | "maintainx";

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

const STORAGE_KEY = "mira_connections_v2";

function read(): Partial<Record<Provider, ConnectionMeta>> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function write(data: Partial<Record<Provider, ConnectionMeta>>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getConnection(provider: Provider): ConnectionMeta {
  return read()[provider] ?? { connected: false };
}

export function setConnection(provider: Provider, meta: ConnectionMeta) {
  const all = read();
  all[provider] = { ...meta, connectedAt: meta.connectedAt ?? new Date().toISOString() };
  write(all);
}

export function removeConnection(provider: Provider) {
  const all = read();
  delete all[provider];
  write(all);
}

export function getAllConnections(): Partial<Record<Provider, ConnectionMeta>> {
  return read();
}
