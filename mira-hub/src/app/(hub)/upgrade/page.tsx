"use client";

import { Factory, Zap, Users, Check, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

const PLANS = [
  {
    id: "individual",
    name: "Individual",
    price: "$20",
    period: "/month",
    description: "Perfect for solo maintenance techs and plant engineers",
    highlight: "Most popular",
    color: "#2563EB",
    features: [
      "AI diagnostic assistant",
      "Work order & PM scheduling",
      "Asset & parts management",
      "1 user seat",
      "All integrations (Telegram, Slack)",
      "7-day free trial",
    ],
  },
  {
    id: "facility",
    name: "Facility",
    price: "$499",
    period: "/month",
    description: "For maintenance teams and full plant operations",
    highlight: null,
    color: "#0891B2",
    features: [
      "Everything in Individual",
      "Unlimited user seats",
      "Multi-site support",
      "Custom KB ingestion",
      "SLA support",
      "Dedicated onboarding",
    ],
  },
];

export default function UpgradePage() {
  function handleUpgrade(planId: string) {
    // Stripe checkout — placeholder until Stripe is wired
    window.open(`mailto:mike@factorylm.com?subject=FactoryLM%20${planId}%20plan%20signup`, "_blank");
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)" }}
    >
      <div className="w-full max-w-3xl">
        <div className="text-center mb-10">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", boxShadow: "0 0 32px rgba(37,99,235,0.4)" }}
          >
            <Factory className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Your trial has ended</h1>
          <p className="text-slate-400 text-base max-w-md mx-auto">
            Upgrade to continue using FactoryLM. We beat Factory AI at half the price.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className="rounded-2xl border p-6 flex flex-col"
              style={{
                background: "rgba(26,29,35,0.95)",
                borderColor: plan.highlight ? "#2563EB" : "rgba(148,163,184,0.15)",
                boxShadow: plan.highlight ? "0 0 32px rgba(37,99,235,0.2)" : "none",
              }}
            >
              {plan.highlight && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold mb-4 self-start"
                  style={{ backgroundColor: "rgba(37,99,235,0.15)", color: "#60A5FA" }}>
                  <Zap className="w-3 h-3" /> {plan.highlight}
                </div>
              )}

              <div className="flex items-center gap-2 mb-2">
                {plan.id === "facility" ? (
                  <Users className="w-5 h-5" style={{ color: plan.color }} />
                ) : (
                  <Zap className="w-5 h-5" style={{ color: plan.color }} />
                )}
                <span className="text-white font-semibold text-lg">{plan.name}</span>
              </div>

              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-bold text-white">{plan.price}</span>
                <span className="text-slate-400 text-sm">{plan.period}</span>
              </div>
              <p className="text-slate-400 text-sm mb-5">{plan.description}</p>

              <ul className="space-y-2.5 mb-6 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: plan.color }} />
                    <span className="text-sm text-slate-300">{f}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleUpgrade(plan.id)}
                className="w-full h-11 rounded-lg font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: `linear-gradient(135deg, ${plan.color}, ${plan.id === "individual" ? "#0891B2" : "#7C3AED"})` }}
              >
                Start {plan.name} Plan
              </button>
            </div>
          ))}
        </div>

        <div className="text-center">
          <p className="text-slate-500 text-sm mb-3">Questions? <a href="mailto:mike@factorylm.com" className="text-blue-400 hover:text-blue-300">Contact us</a></p>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
