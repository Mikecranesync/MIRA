"use client";

import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { signIn, getProviders } from "next-auth/react";
import { API_BASE } from "@/lib/config";
import type { PublicSignupPolicy } from "@/capabilities/free-technician-signup";

const POLICY = "https://factorylm.com/free-technicians";
const PILOT_EMAIL = "mailto:mike@factorylm.com?subject=FactoryLM%20plant%20pilot%20application";

/** Bounded signup presentation. The frozen form is retained only for the old rollout. */
export function SignupGateway({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ policy: PublicSignupPolicy; pilot?: PublicSignupPolicy; intent: boolean; google: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const intent = new URL(window.location.href).searchParams.get("intent") === "pilot";
    async function load() {
      const response = await fetch(`${API_BASE}/api/public/signup-policy/`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Offer unavailable");
      const policy = await response.json();
      if (policy.version !== 1 || !["free_technician", "pilot_application", "trial"].includes(policy.kind)) throw new Error("Offer unavailable");
      let pilot: PublicSignupPolicy | undefined;
      if (intent && policy.kind === "free_technician") {
        const result = await fetch(`${API_BASE}/api/public/signup-policy/?intent=pilot`, { cache: "no-store", signal: controller.signal });
        if (!result.ok) throw new Error("Offer unavailable");
        pilot = await result.json();
      }
      const providers = policy.kind === "free_technician" && !intent ? await getProviders().catch(() => null) : null;
      setState({ policy, pilot, intent, google: Boolean(providers?.google) });
    }
    load().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  if (!state) return <main className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6"><p role="status">{failed ? "Account setup is temporarily unavailable. Please try again or contact support@factorylm.com." : "Loading account setup…"}</p></main>;
  if (state.policy.kind !== "free_technician") return children;
  return <VerifiedSignup pilot={state.intent} pilotAvailable={state.pilot?.kind === "pilot_application"} googleAvailable={state.google} />;
}

function VerifiedSignup({ pilot, pilotAvailable, googleAvailable }: { pilot: boolean; pilotAvailable: boolean; googleAvailable: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/auth/${pilot ? "register" : "magic-link"}/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pilot ? { email, password, signupIntent: "pilot" } : { email }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not complete the request. Please try again.");
      setDone(true);
      setMessage(pilot ? "Your pilot application is awaiting review. A workspace is available only after approval." : "Check your email. Open the sign-in link to verify your address and create your free workspace.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center px-5 py-12">
    <section className="w-full max-w-sm space-y-6">
      <a href="https://factorylm.com" className="text-orange-400 font-bold text-xl">FactoryLM</a>
      <h1 className="text-3xl font-bold">{pilot ? "Apply for a plant pilot" : "Start your free MIRA workspace"}</h1>
      <p className="text-slate-300">{pilot ? "Plant pilots are reviewed separately from personal technician accounts." : "Free for technicians. One personal workspace for you, with no trial deadline or credit card."}</p>
      {(!pilot || pilotAvailable) && !done && <form onSubmit={submit} className="space-y-5">
        <label className="block">Work email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-md bg-slate-800 border border-slate-600 p-3 text-base" /></label>
        {pilot && <label className="block">Password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-md bg-slate-800 border border-slate-600 p-3 text-base" /></label>}
        <label className="flex gap-3 text-sm text-slate-300"><input type="checkbox" required checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-1 size-5 shrink-0" /><span>I agree to the <a className="underline" href={POLICY} target="_blank" rel="noopener noreferrer">Terms and free-access policy</a> and <a className="underline" href="https://factorylm.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label>
        <button disabled={busy || !accepted} className="w-full min-h-12 rounded-md bg-orange-700 text-white p-3 font-semibold disabled:opacity-50">{busy ? "Sending…" : pilot ? "Request pilot access" : "Email me a sign-in link"}</button>
        {!pilot && googleAvailable && <button type="button" disabled={busy || !accepted} onClick={() => { setBusy(true); void signIn("google", { callbackUrl: "/feed" }).catch(() => { setBusy(false); setMessage("Could not open Google sign-in. Try the email link."); }); }} className="w-full min-h-12 rounded-md border border-slate-500 p-3 font-semibold disabled:opacity-50">Continue with Google</button>}
      </form>}
      {message && <p role="status" className="rounded-md border border-slate-600 p-4 text-sm">{message}</p>}
      {pilot && <p className="text-slate-300">Already have a personal account, or want to discuss the rollout first? <a className="underline text-orange-300" href={PILOT_EMAIL}>Email Mike to apply for a plant pilot</a>. Your existing workspace stays unchanged.</p>}
      {!pilot && <p className="text-sm text-slate-300">Planning for a crew? <a className="underline text-orange-300" href={`${API_BASE}/signup/?intent=pilot`}>Apply for a plant pilot</a>. Personal workspaces do not include team invitations.</p>}
      <p className="text-sm text-slate-300"><a className="underline" href={`${API_BASE}/login/`}>Sign in to an existing account</a></p>
    </section>
  </main>;
}
