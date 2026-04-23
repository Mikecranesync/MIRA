/**
 * OAuth 2.0 + PKCE helpers for MIRA hub connectors.
 *
 * Implements Google OAuth using Web Crypto API (PKCE, RFC 7636) and jose
 * for state JWT signing. No extra dependencies beyond what mira-web already uses.
 *
 * State JWT carries { codeVerifier, nonce, tenantId, provider } and expires in
 * 10 minutes — avoids in-memory session state and works across restarts.
 */

import { SignJWT, jwtVerify } from "jose";
import { neon, Client } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// PKCE — RFC 7636
// ---------------------------------------------------------------------------

export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ---------------------------------------------------------------------------
// State JWT — 10-min signed token carries PKCE verifier + tenant identity
// ---------------------------------------------------------------------------

export interface OAuthState {
  codeVerifier: string;
  nonce: string;
  tenantId: string;
  provider: string;
}

function jwtSecret(): Uint8Array {
  const s = process.env.PLG_JWT_SECRET;
  if (!s) throw new Error("PLG_JWT_SECRET not set");
  return new TextEncoder().encode(s);
}

export async function signStateJwt(state: OAuthState): Promise<string> {
  return new SignJWT({ ...state })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(jwtSecret());
}

export async function verifyStateJwt(token: string): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    const { codeVerifier, nonce, tenantId, provider } = payload as Record<
      string,
      unknown
    >;
    if (
      typeof codeVerifier !== "string" ||
      typeof nonce !== "string" ||
      typeof tenantId !== "string" ||
      typeof provider !== "string"
    ) {
      return null;
    }
    return { codeVerifier, nonce, tenantId, provider };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Google token exchange
// ---------------------------------------------------------------------------

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}

export interface GoogleUserInfo {
  email: string;
  name: string;
  picture: string | null;
}

export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Google token exchange failed ${resp.status}: ${body}`);
  }
  const data = (await resp.json()) as Record<string, unknown>;
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : null;
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string | null) ?? null,
    idToken: (data.id_token as string | null) ?? null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    scope: (data.scope as string | null) ?? null,
  };
}

export async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  const resp = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!resp.ok) throw new Error(`Google userinfo failed: ${resp.status}`);
  const data = (await resp.json()) as Record<string, unknown>;
  return {
    email: data.email as string,
    name: (data.name as string) ?? (data.email as string),
    picture: (data.picture as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// connector_tokens CRUD
// ---------------------------------------------------------------------------

export interface ConnectorToken {
  id: number;
  tenant_id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  scope: string | null;
  expires_at: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectorMeta {
  email: string;
  display_name: string;
  avatar_url?: string;
}

function db() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

export async function upsertConnectorToken(
  tenantId: string,
  provider: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
  scope: string | null,
  meta: ConnectorMeta,
): Promise<void> {
  const sql = db();
  const expiresAtStr = expiresAt ? expiresAt.toISOString() : null;
  await sql`
    INSERT INTO connector_tokens
      (tenant_id, provider, access_token, refresh_token, expires_at, scope, metadata_json, updated_at)
    VALUES
      (${tenantId}, ${provider}, ${accessToken}, ${refreshToken},
       ${expiresAtStr}, ${scope}, ${JSON.stringify(meta)}, NOW())
    ON CONFLICT (tenant_id, provider) DO UPDATE SET
      access_token  = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, connector_tokens.refresh_token),
      expires_at    = EXCLUDED.expires_at,
      scope         = EXCLUDED.scope,
      metadata_json = EXCLUDED.metadata_json,
      updated_at    = NOW()`;
}

export async function getConnectorToken(
  tenantId: string,
  provider: string,
): Promise<ConnectorToken | null> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM connector_tokens
    WHERE tenant_id = ${tenantId} AND provider = ${provider}
    LIMIT 1`;
  return (rows[0] as ConnectorToken) ?? null;
}

export async function listConnectors(
  tenantId: string,
): Promise<ConnectorToken[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM connector_tokens
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at`;
  return rows as ConnectorToken[];
}

export async function deleteConnectorToken(
  tenantId: string,
  provider: string,
): Promise<void> {
  const sql = db();
  await sql`
    DELETE FROM connector_tokens
    WHERE tenant_id = ${tenantId} AND provider = ${provider}`;
}
