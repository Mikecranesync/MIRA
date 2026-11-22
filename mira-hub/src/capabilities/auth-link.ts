import { NextResponse } from "next/server";
import { createMagicToken, findUserByEmail } from "@/lib/users";
import { publicSignupPolicy } from "./free-technician-signup";
import { ONBOARDING_VERSION } from "./onboarding-policy";
import { attributionFromRequest } from "./pilot-funnel";
const recipients = new Map<string, {
    since: number;
    count: number;
}>();
const networks = new Map<string, {
    since: number;
    count: number;
}>();
const WINDOW = 3600000;
function rateLimit(req: Request, email: string) {
    const now = Date.now();
    for (const map of [recipients, networks])
        for (const [key, value] of map)
            if (now - value.since >= WINDOW)
                map.delete(key);
    const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const recipient = recipients.get(email) ?? { since: now, count: 0 };
    const network = networks.get(ip) ?? { since: now, count: 0 };
    if (recipient.count >= 5)
        return Math.max(1, Math.ceil((recipient.since + WINDOW - now) / 1000));
    if (network.count >= 100 || recipients.size >= 10000 || networks.size >= 10000)
        return Math.max(1, Math.ceil((network.since + WINDOW - now) / 1000));
    recipient.count++;
    network.count++;
    recipients.set(email, recipient);
    networks.set(ip, network);
    return 0;
}
export async function requestAuthLink(req: Request, onboarding: boolean) {
    let body: Record<string, unknown>;
    try {
        const input = await req.json();
        if (!input || typeof input !== "object" || Array.isArray(input))
            throw new Error();
        body = input;
    }
    catch {
        return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    const intent = body.intent;
    if (onboarding && (body.accepted !== true || body.agreementVersion !== ONBOARDING_VERSION || (typeof intent !== "string" || !["technician", "pilot"].includes(intent))))
        return NextResponse.json({ error: "Review and accept the current account agreement." }, { status: 400 });
    if (onboarding) {
        const policy = publicSignupPolicy(intent as "technician" | "pilot");
        if ((intent === "pilot" && policy.kind !== "pilot_application") || (intent === "technician" && policy.kind !== "free_technician"))
            return NextResponse.json({ error: "This signup offer is unavailable. Contact mike@factorylm.com." }, { status: 403 });
    }
    const neutral = () => NextResponse.json({ ok: true });
    if (!process.env.RESEND_API_KEY)
        return NextResponse.json({ error: "Email delivery is temporarily unavailable. Contact support@factorylm.com." }, { status: 503 });
    const cooldown = rateLimit(req, email);
    if (cooldown)
        return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { "Retry-After": String(cooldown) } });
    try {
        const existing = await findUserByEmail(email);
        if (!onboarding && !existing)
            return neutral();
        if (onboarding && existing && (intent === "pilot" || existing.plan !== "technician_free" || existing.status !== "approved"))
            return neutral();
        const token = await createMagicToken(email, onboarding ? { onboarding: { intent: intent as "technician" | "pilot", agreementVersion: ONBOARDING_VERSION, attribution: attributionFromRequest(req) } } : {});
        const origin = new URL(process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.factorylm.com").origin;
        const prefix = process.env.NEXT_PUBLIC_API_BASE ?? "/hub";
        const link = origin + prefix + (onboarding ? `/signup/?intent=${intent}#token=${encodeURIComponent(token)}` : `/magic/#token=${encodeURIComponent(token)}`);
        try {
            await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, body: JSON.stringify({ from: "FactoryLM <noreply@factorylm.com>", to: [email], subject: onboarding ? "Verify your FactoryLM account" : "Your FactoryLM sign-in link", html: `<p>${onboarding ? "Verify your email and confirm the account agreement to finish setup." : "Use this single-use link to sign in to your existing workspace."}</p><p><a href="${link}">${onboarding ? "Review and finish setup" : "Sign in to FactoryLM"}</a></p><p>This link expires in 15 minutes. If you did not request it, ignore this email.</p>` }) });
        }
        catch { /* Keep delivery/eligibility private. No delivery success is claimed. */ }
        return neutral();
    }
    catch {
        return NextResponse.json({ error: "Could not send the email. Please try again." }, { status: 500 });
    }
}
