import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { createMagicToken, ensureSchema } from "@/lib/users";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_ROLES = new Set(["technician", "admin"]);

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  await ensureSchema();
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, status, created_at
       FROM hub_users
       WHERE tenant_id = $1
       ORDER BY created_at ASC`,
      [ctx.tenantId],
    );
    return NextResponse.json(
      rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        name: r.name ?? r.email,
        email: r.email,
        role: r.role,
        status: r.status,
        joinedAt: r.created_at,
      })),
    );
  } catch (err) {
    console.error("[api/team]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

async function sendInviteEmail(email: string, token: string, inviterEmail: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";
  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/hub";
  const inviteUrl = `${appUrl}${apiBase}/magic?token=${token}`;
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn("[api/team] RESEND_API_KEY not set — skipping invite email");
    console.log("[api/team] Invite URL:", inviteUrl);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: "FactoryLM <noreply@factorylm.com>",
      to: [email],
      subject: "You're invited to FactoryLM",
      html: `
        <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0F172A;color:#F1F5F9;border-radius:12px;">
          <div style="margin-bottom:24px;">
            <span style="font-size:24px;font-weight:700;color:#2563EB;">FactoryLM</span>
          </div>
          <h2 style="font-size:20px;font-weight:600;margin-bottom:8px;">Join your FactoryLM workspace</h2>
          <p style="color:#94A3B8;margin-bottom:24px;">${inviterEmail} invited you to join their maintenance workspace. This link expires in 15 minutes and can only be used once.</p>
          <a href="${inviteUrl}"
             style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#2563EB,#0891B2);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
            Accept invite
          </a>
          <p style="color:#64748B;font-size:12px;margin-top:24px;">If you did not expect this invite, you can safely ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[api/team] Resend error:", res.status, body);
    throw new Error("Failed to send invite email");
  }
}

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  await ensureSchema();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const email = String((body as { email?: unknown }).email ?? "").trim().toLowerCase();
  const requestedRole = String((body as { role?: unknown }).role ?? "technician").trim().toLowerCase();
  const role = INVITE_ROLES.has(requestedRole) ? requestedRole : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  if (!role) {
    return NextResponse.json({ error: "role must be technician or admin" }, { status: 400 });
  }

  try {
    const caller = await pool.query(
      `SELECT role, status
       FROM hub_users
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [ctx.userId, ctx.tenantId],
    );
    const callerRole = String(caller.rows[0]?.role ?? "");
    const callerStatus = String(caller.rows[0]?.status ?? "");
    const canInvite = callerRole === "owner" || callerRole === "admin" || callerStatus === "admin";
    if (!canInvite) {
      return NextResponse.json({ error: "Only workspace admins can invite members" }, { status: 403 });
    }

    const existing = await pool.query(
      `SELECT id, tenant_id
       FROM hub_users
       WHERE email_lower = LOWER($1)
       LIMIT 1`,
      [email],
    );
    if (existing.rows[0] && String(existing.rows[0].tenant_id) !== ctx.tenantId) {
      return NextResponse.json(
        { error: "That email already belongs to another workspace" },
        { status: 409 },
      );
    }

    const token = await createMagicToken(email, {
      tenantId: ctx.tenantId,
      role,
      invitedBy: ctx.userId,
    });
    await sendInviteEmail(email, token, ctx.email);
    return NextResponse.json({ ok: true, email, role });
  } catch (err) {
    console.error("[api/team] invite", err);
    return NextResponse.json({ error: "Invite failed" }, { status: 500 });
  }
}
