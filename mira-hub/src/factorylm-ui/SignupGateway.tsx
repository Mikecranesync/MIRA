"use client";
import { useEffect, useState, type ReactNode, type FormEvent, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { API_BASE } from "@/lib/config";
import type { PublicSignupPolicy } from "@/capabilities/free-technician-signup";
import { usePrivateLinkToken } from "./usePrivateLinkToken";
type Policy = PublicSignupPolicy & {
    agreementVersion: string;
    agreementSentence: string;
    policyUrl: string;
    privacyUrl: string;
};
const EMAIL = "mailto:mike@factorylm.com?subject=FactoryLM%20plant%20pilot%20application";
const outer: CSSProperties = { width: "100%", minWidth: 0, minHeight: "100dvh", display: "block", boxSizing: "border-box", padding: "40px 20px", background: "#0f172a", color: "#f1f5f9" };
const card: CSSProperties = { width: "100%", maxWidth: 420, minWidth: 0, margin: "0 auto", display: "block", fontSize: 16, lineHeight: 1.6 };
const field: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", minHeight: 48, padding: "12px", marginTop: 8, border: "1px solid #64748b", borderRadius: 6, background: "#1e293b", color: "#f8fafc", fontSize: 16 };
const button: CSSProperties = { display: "block", width: "100%", minHeight: 48, padding: 12, border: 0, borderRadius: 6, background: "#c2410c", color: "white", fontWeight: 600, fontSize: 16, marginTop: 20 };
const link: CSSProperties = { color: "#fdba74", textDecoration: "underline" };
function Agreement({ policy, accepted, onChange }: {
    policy: Policy;
    accepted: boolean;
    onChange: (value: boolean) => void;
}) {
    return <label style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 14, marginTop: 20 }}><input type="checkbox" required checked={accepted} onChange={e => onChange(e.target.checked)} style={{ width: 20, height: 20, flexShrink: 0, marginTop: 3 }}/><span style={{ minWidth: 0 }}>I agree to the <a style={link} href={policy.policyUrl} target="_blank" rel="noopener noreferrer">FactoryLM Terms of Service and free-access policy</a> and <a style={link} href={policy.privacyUrl} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label>;
}
export function SignupGateway({ children }: {
    children: ReactNode;
}) {
    const verificationToken = usePrivateLinkToken();
    const [state, setState] = useState<{
        policy: Policy;
        pilot: boolean;
        legacy: boolean;
    } | null>(null);
    const [error, setError] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            const query = new URL(window.location.href).searchParams;
            const result = await fetch(`${API_BASE}/api/public/signup-policy/`, { cache: "no-store", signal: controller.signal });
            if (!result.ok)
                throw new Error();
            let policy = await result.json() as Policy;
            const pilot = query.get("intent") === "pilot" || policy.kind === "pilot_application";
            if (pilot) {
                const response = await fetch(`${API_BASE}/api/public/signup-policy/?intent=pilot`, { cache: "no-store", signal: controller.signal });
                if (!response.ok)
                    throw new Error();
                policy = await response.json();
            }
            if (policy.version !== 1 || !policy.policyUrl || !policy.agreementVersion)
                throw new Error();
            setState({ policy, pilot, legacy: !pilot && policy.kind === "trial" });
        }
        load().catch(() => { if (!controller.signal.aborted)
            setError(true); });
        return () => controller.abort();
    }, []);
    if (!state)
        return <div role="main" style={outer}><div style={card}><p role="status">{error ? "Account setup is temporarily unavailable. Please try again or contact support@factorylm.com." : "Loading account setup…"}</p></div></div>;
    if (verificationToken)
        return <ConfirmSetup token={verificationToken} policy={state.policy}/>;
    if (state.legacy)
        return children;
    return <RequestSetup policy={state.policy} pilot={state.pilot}/>;
}
function Frame({ title, children }: {
    title: string;
    children: ReactNode;
}) {
    return <div role="main" style={outer}><section style={card}><a href="https://factorylm.com" style={{ ...link, fontWeight: 700, fontSize: 20 }}>FactoryLM</a><h1 style={{ fontSize: 30, lineHeight: 1.2, fontWeight: 700, margin: "20px 0" }}>{title}</h1>{children}<p style={{ fontSize: 14, marginTop: 24 }}><a style={link} href={`${API_BASE}/login/`}>Sign in to an existing account</a></p></section></div>;
}
function RequestSetup({ policy, pilot }: {
    policy: Policy;
    pilot: boolean;
}) {
    const [email, setEmail] = useState("");
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [done, setDone] = useState(false);
    const available = pilot ? policy.kind === "pilot_application" : policy.kind === "free_technician";
    async function submit(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        try {
            const response = await fetch(`${API_BASE}/api/public/onboarding/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, intent: pilot ? "pilot" : "technician", accepted, agreementVersion: policy.agreementVersion }) });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.error || "Could not send your setup link.");
            setDone(true);
            setMessage("If this address is eligible, look for a setup link in your inbox. Open it, review the agreement and confirm setup. Already have an account? Sign in below or contact Mike about access.");
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : "Please try again.");
        }
        finally {
            setBusy(false);
        }
    }
    return <Frame title={pilot ? "Apply for a plant pilot" : "Start your free MIRA workspace"}>
 <p style={{ marginBottom: 24 }}>{pilot ? "Plant pilots require review and approval. Verify your email to apply." : "Free for technicians. One personal workspace for you, with no trial deadline or credit card."}</p>
 {!available && <p>Online applications are currently closed. Email Mike below to discuss access.</p>}
 {available && !done && <form onSubmit={submit} style={{ width: "100%", display: "block" }}><label style={{ display: "block", fontSize: 16 }}>Work email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} style={field}/></label><Agreement policy={policy} accepted={accepted} onChange={setAccepted}/><button disabled={busy || !accepted} style={{ ...button, opacity: busy || !accepted ? 0.55 : 1 }}>{busy ? "Sending…" : "Email me a setup link"}</button></form>}
 {message && <p role="status" style={{ padding: 16, border: "1px solid #64748b", borderRadius: 6, marginTop: 20 }}>{message}</p>}
 {pilot ? <p style={{ fontSize: 14, marginTop: 24 }}>Already have an account, or want to discuss the rollout first? <a style={link} href={EMAIL}>Email Mike to apply for a plant pilot</a>. Your current workspace stays unchanged.</p> : <p style={{ fontSize: 14, marginTop: 24 }}>Planning for a crew? <a style={link} href={`${API_BASE}/signup/?intent=pilot`}>Apply for a plant pilot</a>. Personal workspaces do not include team invitations.</p>}
 </Frame>;
}
function ConfirmSetup({ token, policy }: {
    token: string;
    policy: Policy;
}) {
    const router = useRouter();
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    async function confirm() {
        setBusy(true);
        try {
            const result = await signIn("magic-token", { token, agreementVersion: policy.agreementVersion, redirect: false });
            if (!result?.ok || result.error)
                throw new Error("This setup link could not be completed. Request a new link, sign in to an existing account, or contact Mike for help.");
            const response = await fetch(`${API_BASE}/api/auth/session/`, { cache: "no-store" });
            const session = await response.json();
            if (session.user?.status === "pending")
                setMessage("Your verified pilot application is awaiting review. Access requires approval.");
            else {
                router.push("/feed");
                router.refresh();
            }
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : "Please try again.");
        }
        finally {
            setBusy(false);
        }
    }
    return <Frame title="Verify your email and finish setup"><p>This single-use link confirms your email. Review the account agreement before finishing setup.</p><Agreement policy={policy} accepted={accepted} onChange={setAccepted}/><button disabled={busy || !accepted} style={{ ...button, opacity: busy || !accepted ? 0.55 : 1 }} onClick={() => void confirm()}>{busy ? "Verifying…" : "Agree and finish setup"}</button>{message && <p role="status" style={{ marginTop: 20 }}>{message}</p>}<p style={{ marginTop: 24, fontSize: 14 }}><a href={EMAIL} style={link}>Contact Mike about a plant pilot or account recovery</a></p></Frame>;
}
