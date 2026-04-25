import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { ensureUserAndTenant, findUserByEmail } from "@/lib/users";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

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
    const result = await ensureUserAndTenant({
      email: trimmed,
      passwordHash,
      name: typeof name === "string" ? name.trim() || undefined : undefined,
    });
    return NextResponse.json({ ok: true, userId: result.id, tenantId: result.tenantId }, { status: 201 });
  } catch (err) {
    console.error("[api/auth/register]", err);
    return NextResponse.json({ error: "registration failed" }, { status: 500 });
  }
}
