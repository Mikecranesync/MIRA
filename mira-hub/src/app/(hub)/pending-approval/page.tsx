"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Factory, Clock, CheckCircle2, Loader2, LogOut } from "lucide-react";
import { API_BASE } from "@/lib/config";

export default function PendingApprovalPage() {
  const [checking, setChecking] = useState(false);
  const [approved, setApproved] = useState(false);
  const [notice, setNotice] = useState("");

  async function checkStatus() {
    setChecking(true);
    setNotice("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/check-approval/`, { cache: "no-store" });
      if (!res.ok) {
        setNotice(res.status === 401 ? "Your session has expired. Sign out and sign in again." : "We could not check your application. Please try again.");
        return;
      }
      const { status } = await res.json() as { status: string };
      if (status === "approved" || status === "admin" || status === "trial") {
        setApproved(true);
        // Force re-login so new JWT contains updated status
        setTimeout(() => {
          signOut({ callbackUrl: `/login?callbackUrl=${API_BASE}/feed` });
        }, 1500);
      } else if (status === "pending") {
        setNotice("Your application is still awaiting review. Your pilot clock has not started. You can safely sign out and return later.");
      } else {
        setNotice("Your access status has changed. Sign out and sign in again, or contact Mike for help.");
      }
    } catch {
      setNotice("We could not connect. Your application is unchanged. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700/50 p-8 text-center"
        style={{ background: "rgba(26,29,35,0.95)", backdropFilter: "blur(12px)", boxShadow: "0 24px 64px rgba(0,0,0,0.4)" }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", boxShadow: "0 0 32px rgba(37,99,235,0.3)" }}
        >
          <Factory className="w-8 h-8 text-white" />
        </div>

        {approved ? (
          <>
            <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">You&apos;re approved!</h1>
            <p className="text-slate-400 text-sm">Please sign in again to continue to your workspace and onboarding.</p>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-yellow-400" />
              <span className="text-yellow-400 text-sm font-medium">Pending Approval</span>
            </div>
            <h1 className="text-xl font-bold text-white mb-3">Your pilot application is under review</h1>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">
              You have applied for one of five free, scoped 30-day MIRA pilots.
              We review applications manually and agree the scope before approval and onboarding.
              Your pilot clock has not started. Applying does not reserve a place.
            </p>

            <div className="space-y-3 text-left mb-8 p-4 rounded-lg" style={{ backgroundColor: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)" }}>
              <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">What happens next</p>
              {["Agree the equipment, manuals, and questions for your pilot", "After approval, onboard and upload your manual", "Check the source pages and validate answers before operational use", "Discuss any paid continuation separately"].map(f => (
                <div key={f} className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-300">{f}</span>
                </div>
              ))}
            </div>

            <p className="text-sm text-slate-300 mb-4" role="status" aria-live="polite">{notice}</p>
            <p className="text-sm text-slate-400 mb-4">Questions about your application? <a className="text-blue-400 underline" href="mailto:mike@factorylm.com?subject=MIRA%20pilot%20application">Contact Mike</a>.</p>
            <button
              onClick={checkStatus}
              disabled={checking}
              className="w-full h-11 rounded-lg font-semibold text-white transition-opacity disabled:opacity-60 flex items-center justify-center gap-2 mb-3"
              style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)" }}
            >
              {checking ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</> : "Check approval status"}
            </button>

            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full h-10 rounded-lg text-sm text-slate-400 hover:text-white flex items-center justify-center gap-2 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
