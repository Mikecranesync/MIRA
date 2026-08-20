/**
 * Shared request identity for browser sessions and authenticated MIRA services.
 *
 * The service path lets thin-client adapters invoke canonical Hub workflow
 * routes without manufacturing a browser cookie. It deliberately reuses the
 * existing HUB_INGEST_TOKEN deployment secret and requires canonical UUID
 * tenant/user identities on every request.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { sessionOr401, type SessionContext } from "@/lib/session";
import type { Channel } from "@/lib/channel-workflow-contract";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = new Set<Channel>(["telegram", "slack", "hub", "mobile"]);

export interface RequestContext extends SessionContext {
  authKind: "session" | "service";
  sourceChannel: Channel | null;
}

export interface InternalServiceIdentity {
  tenantId: string;
  userId: string;
  sourceChannel?: Channel;
}

function tokenMatches(provided: string, expected: string): boolean {
  // Hash first so timingSafeEqual always compares equal-length buffers. This
  // also avoids a length-dependent throw for malformed Authorization values.
  const suppliedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function serviceError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

/** Resolve either the existing browser session or a strict service identity. */
export async function requestContextOr401(
  req: Request,
): Promise<RequestContext | NextResponse> {
  const authorization = req.headers.get("authorization");
  if (authorization === null) {
    const session = await sessionOr401();
    if (session instanceof NextResponse) return session;
    return { ...session, authKind: "session", sourceChannel: null };
  }

  // Any Authorization header selects the service-auth door. A bad header must
  // never fall back to a valid browser cookie and silently change principals.
  const expected = (process.env.HUB_INGEST_TOKEN ?? "").trim();
  if (!expected) return serviceError("service_auth_not_configured", 503);

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const supplied = match?.[1]?.trim() ?? "";
  if (!supplied || !tokenMatches(supplied, expected)) {
    return serviceError("service_unauthorized", 401);
  }

  const tenantId = (req.headers.get("x-mira-tenant-id") ?? "").trim();
  const userId = (req.headers.get("x-mira-user-id") ?? "").trim();
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(userId)) {
    return serviceError("invalid_service_identity", 422);
  }

  const sourceHeader = req.headers.get("x-mira-source-channel");
  let sourceChannel: Channel | null = null;
  if (sourceHeader !== null) {
    const normalized = sourceHeader.trim().toLowerCase();
    if (!CHANNELS.has(normalized as Channel)) {
      return serviceError("invalid_source_channel", 422);
    }
    sourceChannel = normalized as Channel;
  }

  return {
    userId: userId.toLowerCase(),
    tenantId: tenantId.toLowerCase(),
    email: "",
    status: "service",
    trialExpiresAt: null,
    role: "service",
    authKind: "service",
    sourceChannel,
  };
}

/** Build the exact authenticated envelope used for in-process canonical calls. */
export function internalServiceHeaders(identity: InternalServiceIdentity): HeadersInit {
  const token = (process.env.HUB_INGEST_TOKEN ?? "").trim();
  if (!token) throw new Error("service_auth_not_configured");
  if (!UUID_RE.test(identity.tenantId) || !UUID_RE.test(identity.userId)) {
    throw new Error("invalid_service_identity");
  }
  if (identity.sourceChannel && !CHANNELS.has(identity.sourceChannel)) {
    throw new Error("invalid_source_channel");
  }
  return {
    Authorization: `Bearer ${token}`,
    "X-Mira-Tenant-Id": identity.tenantId.toLowerCase(),
    "X-Mira-User-Id": identity.userId.toLowerCase(),
    ...(identity.sourceChannel
      ? { "X-Mira-Source-Channel": identity.sourceChannel }
      : {}),
  };
}
