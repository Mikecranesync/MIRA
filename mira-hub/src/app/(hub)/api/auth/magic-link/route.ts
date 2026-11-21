import { NextResponse } from "next/server";
import { createMagicToken } from "@/lib/users";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const attempts = new Map<string, { since: number; count: number }>();

function allowRequest(req: Request): boolean {
  const key = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const now = Date.now();
  for (const [ip, bucket] of attempts) if (now - bucket.since >= 3_600_000) attempts.delete(ip);
  const bucket = attempts.get(key) ?? { since: now, count: 0 };
  if (bucket.count >= 5 || (!attempts.has(key) && attempts.size >= 10_000)) return false;
  bucket.count += 1; attempts.set(key, bucket); return true;
}

async function sendMagicLinkEmail(email: string, token: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";
  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/hub";
  const magicUrl = `${appUrl}${apiBase}/magic?token=${token}`;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Email delivery is not configured");
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
      subject: "Your FactoryLM sign-in link",
      html: `
        <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0F172A;color:#F1F5F9;border-radius:12px;">
          <div style="margin-bottom:24px;">
            <span style="font-size:24px;font-weight:700;color:#2563EB;">FactoryLM</span>
          </div>
          <h2 style="font-size:20px;font-weight:600;margin-bottom:8px;">Sign in to FactoryLM</h2>
          <p style="color:#94A3B8;margin-bottom:24px;">Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
          <a href="${magicUrl}"
             style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#2563EB,#0891B2);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
            Sign in to FactoryLM
          </a>
          <p style="color:#64748B;font-size:12px;margin-top:24px;">If you didn't request this link, you can safely ignore this email.</p>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    throw new Error("Failed to send magic link email");
  }
}

export async function POST(req: Request) {
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "Email delivery is temporarily unavailable. Please contact support@factorylm.com." }, { status: 503 });
  if (!allowRequest(req)) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { "Retry-After": "3600" } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "valid email required" }, { status: 400 });
  const { email } = body as { email?: unknown };
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  try {
    const token = await createMagicToken(email.trim().toLowerCase());
    await sendMagicLinkEmail(email.trim(), token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[magic-link]", err);
    return NextResponse.json({ error: "failed to send magic link" }, { status: 500 });
  }
}
