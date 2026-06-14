// Validation + normalization for registering a Command Center live display
// (POST /api/command-center/display). Pure so it's unit-testable without a DB;
// the route layer adds the tenant-scoped uns_path-exists check + upsert.
//
// Read-only doctrine (.claude/rules/fieldbus-readonly.md): this only ever stores
// where to *watch* a display — never a control endpoint.

export const DISPLAY_TYPES = ["web_iframe", "nodered", "signals", "vnc"] as const;
export type DisplayType = (typeof DISPLAY_TYPES)[number];

export const SCHEMES = ["http", "https"] as const;
export type Scheme = (typeof SCHEMES)[number];

// Mirror the UNS slug shape (lowercase dotted ltree labels). Matches the paths
// produced by mira-crawler/ingest/uns.py and stored in kg_entities.uns_path.
const UNS_PATH_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

export interface DisplayRegistrationInput {
  unsPath?: unknown;
  host?: unknown;
  scheme?: unknown;
  port?: unknown;
  path?: unknown;
  displayType?: unknown;
  label?: unknown;
}

export interface NormalizedDisplayRegistration {
  unsPath: string;
  host: string;
  scheme: Scheme;
  port: number | null;
  path: string;
  displayType: DisplayType;
  label: string | null;
}

export type ValidationResult =
  | { ok: true; value: NormalizedDisplayRegistration }
  | { ok: false; error: string };

function asString(v: unknown): string | null {
  return typeof v === "string" ? v.trim() : null;
}

export function validateDisplayRegistration(input: DisplayRegistrationInput): ValidationResult {
  const unsPath = asString(input.unsPath);
  if (!unsPath) return { ok: false, error: "unsPath is required" };
  if (!UNS_PATH_RE.test(unsPath)) {
    return { ok: false, error: "unsPath must be a lowercase dotted UNS path (e.g. enterprise.bench.conv_simple)" };
  }

  const host = asString(input.host);
  if (!host) return { ok: false, error: "host is required" };
  // host is a bare LAN IP / hostname / service name — never a URL.
  if (/[/\s]/.test(host) || host.includes("://")) {
    return { ok: false, error: "host must be a bare hostname or IP (no scheme, path, or spaces)" };
  }

  const schemeRaw = asString(input.scheme) ?? "http";
  if (!SCHEMES.includes(schemeRaw as Scheme)) {
    return { ok: false, error: `scheme must be one of: ${SCHEMES.join(", ")}` };
  }
  const scheme = schemeRaw as Scheme;

  let port: number | null = null;
  if (input.port !== undefined && input.port !== null && input.port !== "") {
    const n = typeof input.port === "number" ? input.port : Number(input.port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return { ok: false, error: "port must be an integer 1–65535" };
    }
    port = n;
  }

  let path = asString(input.path) ?? "/";
  if (!path.startsWith("/")) path = `/${path}`;

  const displayTypeRaw = asString(input.displayType) ?? "web_iframe";
  if (!DISPLAY_TYPES.includes(displayTypeRaw as DisplayType)) {
    return { ok: false, error: `displayType must be one of: ${DISPLAY_TYPES.join(", ")}` };
  }
  const displayType = displayTypeRaw as DisplayType;

  const label = asString(input.label) || null;

  return { ok: true, value: { unsPath, host, scheme, port, path, displayType, label } };
}
