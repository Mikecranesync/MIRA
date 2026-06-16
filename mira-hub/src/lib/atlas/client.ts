// Shared Atlas CMMS REST client.
//
// Used by:
//   - src/app/api/cmms/stats/route.ts          (read-only counts)
//   - src/app/api/cmms/health/route.ts         (env-based config probe)
//   - scripts/cmms-sync-worker.ts              (NeonDB <-> Atlas sync, P1)
//
// Atlas API surface (Spring Boot, vendored from intelloop/Atlas_CMMS):
//   POST /auth/signin                       — { email, password, type:"CLIENT" } → { accessToken | token }
//   POST /work-orders, /assets,             — create
//        /preventive-maintenances
//   PATCH /work-orders/{id}                 — partial update
//   POST /work-orders/search                — { pageSize, pageNum, status?, updatedAt? } → { content, totalElements }
//   POST /assets/search                     — same paging shape
//   POST /preventive-maintenances/search    — same paging shape
//   GET  /assets/{id}, /work-orders/{id}    — single record
//   GET  /health-check                      — liveness probe
//
// Asset IDs in Atlas are integers; we transport them as strings on the NeonDB
// side (`atlas_id TEXT`) and coerce when calling Atlas. Same for PM IDs.
//
// Token cache is in-process (per Node worker) and lives 23 hours, matching
// Atlas's default JWT TTL. The cache is invalidated on first auth-error
// response so the next call re-authenticates.

const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const SEARCH_TIMEOUT_MS = 15_000;

export interface AtlasClientOptions {
  /** Full base URL including any /api prefix the gateway requires. */
  baseUrl?: string;
  /** Atlas login email — defaults to ATLAS_API_USER. */
  user?: string;
  /** Atlas password — defaults to ATLAS_API_PASSWORD. */
  password?: string;
}

export interface AtlasPagedResponse<T> {
  content?: T[];
  totalElements?: number;
}

export interface AtlasWorkOrder {
  id: number;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  asset?: { id: number; name?: string } | null;
  feedback?: string;
  updatedAt?: string;
  createdAt?: string;
  // Atlas-specific fields we don't model exhaustively here pass through as-is.
  [k: string]: unknown;
}

export interface AtlasAsset {
  id: number;
  name?: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  updatedAt?: string;
  createdAt?: string;
  [k: string]: unknown;
}

export interface AtlasPM {
  id: number;
  title?: string;
  description?: string;
  asset?: { id: number } | null;
  updatedAt?: string;
  [k: string]: unknown;
}

export class AtlasAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtlasAuthError";
  }
}

export class AtlasHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, path: string) {
    super(`Atlas ${path} → ${status}: ${body.slice(0, 200)}`);
    this.name = "AtlasHttpError";
    this.status = status;
    this.body = body;
  }
}

export class AtlasClient {
  private baseUrl: string;
  private user: string;
  private password: string;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(opts: AtlasClientOptions = {}) {
    const rawBase = opts.baseUrl ?? process.env.HUB_CMMS_API_URL ?? "https://cmms.factorylm.com";
    this.baseUrl = rawBase.replace(/\/$/, "");
    this.user = opts.user ?? process.env.ATLAS_API_USER ?? "";
    this.password = opts.password ?? process.env.ATLAS_API_PASSWORD ?? "";
  }

  /** True if user + password are present. Does not verify they're valid. */
  get configured(): boolean {
    return !!(this.user && this.password);
  }

  /** Fetch (or return cached) JWT bearer token. Returns "" if unconfigured. */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    if (!this.configured) return "";

    const res = await fetch(`${this.baseUrl}/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.user, password: this.password, type: "CLIENT" }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AtlasAuthError(`signin → ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { token?: string; accessToken?: string };
    const token = data.accessToken ?? data.token ?? "";
    if (!token) throw new AtlasAuthError("signin returned empty token");
    this.token = token;
    this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    return token;
  }

  /** Drop the cached token so the next call re-authenticates. */
  invalidateToken() {
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const token = await this.getToken();
    if (!token) {
      throw new AtlasAuthError("Atlas not configured (ATLAS_API_USER/PASSWORD missing)");
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) {
      // Token may have expired earlier than expected; drop cache so the next
      // worker tick re-authenticates rather than spinning on stale credentials.
      this.invalidateToken();
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AtlasHttpError(res.status, text, path);
    }
    // Some Atlas DELETE/PATCH endpoints return 204 No Content; handle gracefully.
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }

  // ── Work orders ─────────────────────────────────────────────────────────────

  searchWorkOrders(payload: {
    pageSize?: number;
    pageNum?: number;
    status?: string;
    updatedAt?: string;
  }): Promise<AtlasPagedResponse<AtlasWorkOrder>> {
    return this.request("POST", "/work-orders/search", { pageSize: 25, pageNum: 0, ...payload }, SEARCH_TIMEOUT_MS);
  }

  createWorkOrder(payload: {
    title: string;
    description: string;
    priority: string;
    status?: string;
    asset?: { id: number };
    feedback?: string;
  }): Promise<AtlasWorkOrder> {
    return this.request("POST", "/work-orders", { status: "OPEN", ...payload });
  }

  updateWorkOrder(atlasId: string | number, payload: Partial<AtlasWorkOrder>): Promise<AtlasWorkOrder> {
    return this.request("PATCH", `/work-orders/${atlasId}`, payload);
  }

  getWorkOrder(atlasId: string | number): Promise<AtlasWorkOrder> {
    return this.request("GET", `/work-orders/${atlasId}`);
  }

  // ── Assets ──────────────────────────────────────────────────────────────────

  searchAssets(payload: {
    pageSize?: number;
    pageNum?: number;
    updatedAt?: string;
  }): Promise<AtlasPagedResponse<AtlasAsset>> {
    return this.request("POST", "/assets/search", { pageSize: 25, pageNum: 0, ...payload }, SEARCH_TIMEOUT_MS);
  }

  createAsset(payload: {
    name: string;
    description?: string;
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
  }): Promise<AtlasAsset> {
    return this.request("POST", "/assets", payload);
  }

  updateAsset(atlasId: string | number, payload: Partial<AtlasAsset>): Promise<AtlasAsset> {
    return this.request("PATCH", `/assets/${atlasId}`, payload);
  }

  getAsset(atlasId: string | number): Promise<AtlasAsset> {
    return this.request("GET", `/assets/${atlasId}`);
  }

  // ── Preventive maintenance schedules ────────────────────────────────────────

  searchPMs(payload: {
    pageSize?: number;
    pageNum?: number;
    asset?: { id: number };
    updatedAt?: string;
  }): Promise<AtlasPagedResponse<AtlasPM>> {
    return this.request("POST", "/preventive-maintenances/search", { pageSize: 25, pageNum: 0, ...payload }, SEARCH_TIMEOUT_MS);
  }

  createPM(payload: {
    title: string;
    description?: string;
    asset?: { id: number };
  }): Promise<AtlasPM> {
    return this.request("POST", "/preventive-maintenances", payload);
  }

  updatePM(atlasId: string | number, payload: Partial<AtlasPM>): Promise<AtlasPM> {
    return this.request("PATCH", `/preventive-maintenances/${atlasId}`, payload);
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  async health(): Promise<{ ok: boolean; status?: number; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health-check`, {
        signal: AbortSignal.timeout(5_000),
      });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}

// ── Hub ↔ Atlas value mappers ─────────────────────────────────────────────────
// NeonDB priority/status values are lowercase; Atlas expects uppercase enums
// with one rename (critical → EMERGENCY). See mira-bots/shared/pm_scheduler.py
// for the reference mapping used by the Telegram WO creation path.

export function priorityHubToAtlas(p: string | null | undefined): string {
  switch ((p ?? "").toLowerCase()) {
    case "critical":
      return "EMERGENCY";
    case "high":
      return "HIGH";
    case "low":
      return "LOW";
    case "medium":
    case "":
    default:
      return "MEDIUM";
  }
}

export function statusHubToAtlas(s: string | null | undefined): string {
  switch ((s ?? "").toLowerCase()) {
    case "in_progress":
    case "inprogress":
      return "IN_PROGRESS";
    case "completed":
    case "complete":
    case "resolved":
      return "COMPLETE";
    case "cancelled":
    case "canceled":
      return "CANCELLED";
    case "needs_completion":
    case "open":
    default:
      return "OPEN";
  }
}

export function statusAtlasToHub(s: string | null | undefined): string {
  switch ((s ?? "").toUpperCase()) {
    case "IN_PROGRESS":
      return "in_progress";
    case "COMPLETE":
    case "COMPLETED":
      return "completed";
    case "CANCELLED":
    case "CANCELED":
      return "cancelled";
    case "OPEN":
    default:
      return "open";
  }
}

export function priorityAtlasToHub(p: string | null | undefined): string {
  switch ((p ?? "").toUpperCase()) {
    case "EMERGENCY":
      return "critical";
    case "HIGH":
      return "high";
    case "LOW":
      return "low";
    case "MEDIUM":
    default:
      return "medium";
  }
}
