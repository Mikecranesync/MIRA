// Nango client utility
// Self-hosted: NANGO_SERVER_URL (internal Docker network URL, e.g. http://nango-server:3003)
// Secret key: NANGO_SECRET_KEY (used by server-side routes only — never exposed to browser)

const NANGO_URL = process.env.NANGO_SERVER_URL ?? "http://nango-server:3003";
const NANGO_SECRET = process.env.NANGO_SECRET_KEY ?? "";

function nangoHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${NANGO_SECRET}`,
    "Content-Type": "application/json",
  };
}

// Create or update a connection for an API-key-auth provider (e.g. MaintainX).
// connectionId should be the tenant's ID so each tenant has an isolated credential.
export async function createApiKeyConnection(
  providerConfigKey: string,
  connectionId: string,
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${NANGO_URL}/connection`, {
      method: "POST",
      headers: nangoHeaders(),
      body: JSON.stringify({
        provider_config_key: providerConfigKey,
        connection_id: connectionId,
        credentials: { apiKey },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: text };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Delete a connection (on disconnect).
export async function deleteConnection(
  providerConfigKey: string,
  connectionId: string
): Promise<void> {
  await fetch(`${NANGO_URL}/connection/${connectionId}?provider_config_key=${providerConfigKey}`, {
    method: "DELETE",
    headers: nangoHeaders(),
  });
}

// Check if a connection exists and is healthy.
export async function getConnectionStatus(
  providerConfigKey: string,
  connectionId: string
): Promise<{ connected: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${NANGO_URL}/connection/${connectionId}?provider_config_key=${providerConfigKey}`,
      { headers: nangoHeaders() }
    );

    if (res.status === 404) return { connected: false };
    if (!res.ok) return { connected: false, error: `HTTP ${res.status}` };

    return { connected: true };
  } catch {
    return { connected: false, error: "Nango unreachable" };
  }
}

// Proxy an authenticated GET request through Nango to the provider.
// Nango injects the stored Bearer token automatically.
// Works on ALL tiers (including free self-hosted).
export async function proxyGet<T>(
  providerConfigKey: string,
  connectionId: string,
  endpoint: string,
  params?: Record<string, string | number>
): Promise<T> {
  const url = new URL(`${NANGO_URL}/proxy${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      ...nangoHeaders(),
      "Connection-Id": connectionId,
      "Provider-Config-Key": providerConfigKey,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nango proxy ${endpoint} → HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// Proxy an authenticated POST request through Nango to the provider.
export async function proxyPost<T>(
  providerConfigKey: string,
  connectionId: string,
  endpoint: string,
  body: unknown
): Promise<T> {
  const res = await fetch(`${NANGO_URL}/proxy${endpoint}`, {
    method: "POST",
    headers: {
      ...nangoHeaders(),
      "Connection-Id": connectionId,
      "Provider-Config-Key": providerConfigKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nango proxy POST ${endpoint} → HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// Trigger an action (Nango Cloud / Enterprise only — not free self-hosted).
export async function triggerAction<TInput, TOutput>(
  providerConfigKey: string,
  connectionId: string,
  actionName: string,
  input: TInput
): Promise<TOutput> {
  const res = await fetch(`${NANGO_URL}/action/trigger`, {
    method: "POST",
    headers: {
      ...nangoHeaders(),
      "Connection-Id": connectionId,
      "Provider-Config-Key": providerConfigKey,
    },
    body: JSON.stringify({ action_name: actionName, input }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nango action ${actionName} → HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<TOutput>;
}
