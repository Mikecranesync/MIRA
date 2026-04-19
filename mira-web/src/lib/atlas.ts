/**
 * Atlas CMMS client — REST API with JWT auth.
 *
 * Mirrors the pattern from mira-mcp/cmms/atlas.py but in TypeScript.
 * Handles: admin signin, user signup, work order + asset creation.
 */

const ATLAS_URL =
  process.env.ATLAS_API_URL || "http://atlas-api:8080";

let _adminToken = "";
let _adminTokenExpires = 0;

interface AtlasAuth {
  accessToken: string;
  companyId: number;
  userId: number;
}

async function adminToken(): Promise<string> {
  if (_adminToken && Date.now() < _adminTokenExpires) return _adminToken;

  const user = process.env.PLG_ATLAS_ADMIN_USER;
  const pass = process.env.PLG_ATLAS_ADMIN_PASSWORD;
  if (!user || !pass) throw new Error("PLG_ATLAS_ADMIN credentials not set");

  const resp = await fetch(`${ATLAS_URL}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user, password: pass }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Atlas admin signin failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  _adminToken = data.accessToken || data.token || "";
  _adminTokenExpires = Date.now() + 82800_000; // 23 hours
  return _adminToken;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Create a new user in Atlas CMMS via the signup endpoint.
 * Returns the user's auth data (token, companyId, userId).
 */
export async function signupUser(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  companyName: string
): Promise<AtlasAuth> {
  const resp = await fetch(`${ATLAS_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      firstName: firstName || email.split("@")[0],
      lastName: lastName || "",
      companyName,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Atlas signup failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return {
    accessToken: data.accessToken || data.token || "",
    companyId: data.companyId || data.company?.id || 0,
    userId: data.userId || data.user?.id || data.id || 0,
  };
}

/**
 * Sign in an existing Atlas user.
 */
export async function signinUser(
  email: string,
  password: string
): Promise<AtlasAuth> {
  const resp = await fetch(`${ATLAS_URL}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Atlas signin failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return {
    accessToken: data.accessToken || data.token || "",
    companyId: data.companyId || data.company?.id || 0,
    userId: data.userId || data.user?.id || data.id || 0,
  };
}

/**
 * Create a work order via Atlas API using the admin token.
 */
export async function createWorkOrder(wo: {
  title: string;
  description: string;
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  status?: string;
  category?: string;
  companyId?: number;
}, authToken?: string): Promise<Record<string, unknown>> {
  const token = authToken ?? await adminToken();
  const resp = await fetch(`${ATLAS_URL}/work-orders`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      title: wo.title,
      description: wo.description,
      priority: wo.priority,
      status: wo.status || "OPEN",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Atlas WO creation failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

/**
 * Create an asset via Atlas API using the admin token.
 */
export async function createAsset(asset: {
  name: string;
  description?: string;
  model?: string;
  area?: string;
}, authToken?: string): Promise<Record<string, unknown>> {
  const token = authToken ?? await adminToken();
  const resp = await fetch(`${ATLAS_URL}/assets`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      name: asset.name,
      description: asset.description || "",
      model: asset.model || "",
      area: asset.area || "",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Atlas asset creation failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

export async function getAtlasUserRole(atlasUserId: number): Promise<"ADMIN" | "USER"> {
  // Atlas returns user details including role name; fall back to USER on any failure.
  try {
    const res = await fetch(`${ATLAS_URL}/users/${atlasUserId}`, {
      headers: { Authorization: `Bearer ${await adminToken()}` },
    });
    if (!res.ok) return "USER";
    const data = (await res.json()) as { role?: { name?: string } };
    const name = data.role?.name?.toUpperCase() ?? "";
    return name.includes("ADMIN") ? "ADMIN" : "USER";
  } catch {
    return "USER";
  }
}

export async function getAsset(atlasAssetId: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${ATLAS_URL}/assets/${atlasAssetId}`, {
      headers: { Authorization: `Bearer ${await adminToken()}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function listAssets(limit: number = 100): Promise<Array<{ id: number; name: string }>> {
  try {
    const res = await fetch(`${ATLAS_URL}/assets/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await adminToken()}`,
      },
      body: JSON.stringify({ pageSize: limit, pageNum: 0 }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { content?: Array<{ id: number; name: string }> };
    return data.content ?? [];
  } catch {
    return [];
  }
}

/**
 * List work orders for a company (via admin token).
 */
export async function listWorkOrders(
  status?: string,
  limit = 50
): Promise<Record<string, unknown>> {
  const token = await adminToken();
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("limit", String(limit));

  const resp = await fetch(
    `${ATLAS_URL}/work-orders/search?${params}`,
    { headers: headers(token) }
  );

  if (!resp.ok) return { error: `Failed to list WOs (${resp.status})` };
  return resp.json();
}
