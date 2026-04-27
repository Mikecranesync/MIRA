import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { ensureUserAndTenant, findUserByEmail } from "@/lib/users";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

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
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { email, password, name } = body as { email?: unknown; password?: unknown; name?: unknown };
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }
  const trimmed = email.trim();
  if (!EMAIL_RE.test(trimmed)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `password must be at least ${MIN_PASSWORD} characters` },
      { status: 400 },
    );
  }
  try {
    const existing = await findUserByEmail(trimmed);
    if (existing) {
      return NextResponse.json({ error: "account already exists" }, { status: 409 });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const nameStr = typeof name === "string" ? name.trim() || undefined : undefined;
    const result = await ensureUserAndTenant({ email: trimmed, passwordHash, name: nameStr });
    // Fire HubSpot capture async — don't block the response
    captureHubSpotLead(trimmed, nameStr).catch(() => {});
    return NextResponse.json({ ok: true, userId: result.id, tenantId: result.tenantId }, { status: 201 });
  } catch (err) {
    console.error("[api/auth/register]", err);
    return NextResponse.json({ error: "registration failed" }, { status: 500 });
  }
}
