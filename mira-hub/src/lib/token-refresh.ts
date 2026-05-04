// mira-hub/src/lib/token-refresh.ts
import {
  getBindingRow,
  updateAccessToken,
  type Provider,
  DEFAULT_TENANT_ID,
} from "@/lib/bindings";

const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh if expiring within 5 minutes

export interface FreshToken {
  accessToken: string;
  expiresAt: Date;
}

export async function ensureFreshAccessToken(
  provider: Provider,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<FreshToken> {
  const row = await getBindingRow(provider, tenantId);
  if (!row) throw new Error(`No ${provider} binding for tenant ${tenantId}`);
  if (!row.accessToken) throw new Error(`${provider} binding has no access_token`);

  const now = Date.now();
  const expiresAt = row.tokenExpiresAt ?? new Date(now + 3600_000);
  const needsRefresh =
    row.tokenExpiresAt != null && row.tokenExpiresAt.getTime() - now < REFRESH_SKEW_MS;

  if (!needsRefresh) {
    return { accessToken: row.accessToken, expiresAt };
  }

  if (!row.refreshToken) {
    throw new Error(`${provider} token expired and no refresh_token on record`);
  }

  if (provider === "google") {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: row.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`google token refresh failed: ${json.error_description ?? json.error}`);
    }
    const newExpiresAt = new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000);
    await updateAccessToken(provider, json.access_token, newExpiresAt, tenantId);
    return { accessToken: json.access_token, expiresAt: newExpiresAt };
  }

  // Other providers: add when needed. For now treat as non-refreshable.
  return { accessToken: row.accessToken, expiresAt };
}
