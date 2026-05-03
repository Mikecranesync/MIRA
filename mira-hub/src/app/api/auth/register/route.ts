import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { ensureUserAndTenant, findUserByEmail } from "@/lib/users";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const ALLOWED_ORIGINS = ["https://app.factorylm.com", "https://factorylm.com"];

// In-memory per-IP rate limit: max 5 registrations per hour
const _ipWindows = new Map<string, number[]>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const hits = (_ipWindows.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  _ipWindows.set(ip, hits);
  return true;
}

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

async function captureHubSpotLead(email: string, name: string | undefined): Promise<void> {
  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) return;
  try {
    const properties: Record<string, string> = {
      email,
      hs_lead_status: "NEW",
      lifecyclestage: "lead",
    };
    if (name) {
      const parts = name.trim().split(" ");
      properties.firstname = parts[0];
      if (parts.length > 1) properties.lastname = parts.slice(1).join(" ");
    }
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const body = await res.text();
      // 409 = contact already exists — not an error
      if (res.status !== 409) console.warn("[hubspot] lead capture failed:", res.status, body);
    }
  } catch (err) {
    console.warn("[hubspot] lead capture error:", err);
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503, headers });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many registrations — try again later" }, { status: 429, headers });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers });
  }
  const { email, password, name } = body as { email?: unknown; password?: unknown; name?: unknown };
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "email and password required" }, { status: 400, headers });
  }
  const trimmed = email.trim();
  if (!EMAIL_RE.test(trimmed)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `password must be at least ${MIN_PASSWORD} characters` },
      { status: 400, headers },
    );
  }
  try {
    const existing = await findUserByEmail(trimmed);
    if (existing) {
      return NextResponse.json({ error: "account already exists" }, { status: 409, headers });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const nameStr = typeof name === "string" ? name.trim() || undefined : undefined;
    const result = await ensureUserAndTenant({ email: trimmed, passwordHash, name: nameStr });
    captureHubSpotLead(trimmed, nameStr).catch(() => {});
    return NextResponse.json({ ok: true, userId: result.id, tenantId: result.tenantId }, { status: 201, headers });
  } catch (err) {
    console.error("[api/auth/register]", err);
    return NextResponse.json({ error: "registration failed" }, { status: 500, headers });
  }
}
