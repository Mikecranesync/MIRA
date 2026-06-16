import { NextResponse } from "next/server";
import { createMagicToken } from "@/lib/users";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendMagicLinkEmail(email: string, token: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.factorylm.com";
  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/hub";
  const magicUrl = `${appUrl}${apiBase}/magic?token=${token}`;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[magic-link] RESEND_API_KEY not set — skipping email send");
    console.log("[magic-link] Magic URL:", magicUrl);
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
    const body = await res.text();
    console.error("[magic-link] Resend error:", res.status, body);
    throw new Error("Failed to send magic link email");
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
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
