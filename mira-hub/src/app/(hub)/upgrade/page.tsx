"use client";

// Tier names + prices MUST match the canonical pricing surface at
// https://factorylm.com/pricing (served from `mira-web/public/pricing.html`).
// `/pricing` is the source of truth — when these diverge, edit this file.
// Issue #1461 fixed the divergence on 2026-05-20.
//
// Known gap (separate followup): the Operating Layer card here says $499/mo
// per plant, but the only Stripe `STRIPE_PRICE_ID` configured today is the
// $97/mo beta plan. `/buy` will charge the $97 amount until Stripe products
// for Assessment / Operating Layer are wired up. Track in #1461 followup.

import { Factory, ClipboardCheck, FlaskConical, Workflow, Check, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

const PLANS = [
  {
    id: "assessment",
    tier: "1. Assessment",
    name: "Assessment",
    price: "$500",
    period: "one-time",
    description: "We walk your floor. Score your Maintenance AI Readiness. Deliver a written gap report + namespace blueprint.",
    highlight: "Start here",
    color: "#2563EB",
    cta: "Book your assessment",
    ctaHref: "https://factorylm.com/buy?from=hub-upgrade&plan=assessment",
    icon: ClipboardCheck,
    features: [
      "Onsite or remote (1 day)",
      "Asset inventory walkthrough",
      "Document & manual audit",
      "PLC tag & CMMS hygiene review",
      "Written report with prioritized roadmap",
      "No software demo, no upsell",
    ],
  },
  {
    id: "pilot",
    tier: "2. Pilot",
    name: "Pilot",
    price: "$2–5K",
    period: "/mo · 3-mo min",
    description: "We structure one line: nameplates, manuals, PLC tags, PMs, fault history. MIRA goes live on that scope.",
    highlight: null,
    color: "#0891B2",
    cta: "Talk to Mike",
    ctaHref: "mailto:mike@factorylm.com?subject=FactoryLM%20Pilot%20inquiry%20(from%20hub%20upgrade)",
    icon: FlaskConical,
    features: [
      "Hands-on namespace structuring",
      "OEM manual indexing",
      "PLC tag ↔ asset reconciliation",
      "MIRA deployed on the pilot line",
      "Before/after namespace report",
      "Direct line to Mike + the team",
    ],
  },
  {
    id: "operating",
    tier: "3. Operating Layer",
    name: "Operating Layer",
    price: "$499",
    period: "/mo per plant",
    description: "MIRA in production on a structured namespace. Telegram + web + CMMS write-back. Quarterly namespace audits.",
    highlight: null,
    color: "#7C3AED",
    cta: "Subscribe",
    ctaHref: "https://factorylm.com/buy?from=hub-upgrade&plan=operating",
    icon: Workflow,
    features: [
      "Unlimited MIRA queries, whole team",
      "Cited OEM answers + fault history",
      "CMMS write-back (MaintainX, Limble, UpKeep, Atlas)",
      "Continuous structuring as assets come online",
      "Quarterly namespace quality audit",
      "14-day money-back guarantee",
    ],
  },
];

export default function UpgradePage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)" }}
    >
      <div className="w-full max-w-6xl">
        <div className="text-center mb-10">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", boxShadow: "0 0 32px rgba(37,99,235,0.4)" }}
          >
            <Factory className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Your trial has ended</h1>
          <p className="text-slate-400 text-base max-w-xl mx-auto">
            Three ways to work with us. Most plants start with the $500 Assessment — it's the easiest yes you'll make this quarter.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {PLANS.map(plan => {
            const Icon = plan.icon;
            return (
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
                    {plan.highlight}
                  </div>
                )}

                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-5 h-5" style={{ color: plan.color }} />
                  <span className="text-slate-400 text-xs uppercase tracking-wider">{plan.tier}</span>
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

                <a
                  href={plan.ctaHref}
                  className="w-full h-11 rounded-lg font-semibold text-white transition-opacity hover:opacity-90 flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${plan.color}, ${plan.color === "#2563EB" ? "#0891B2" : "#2563EB"})` }}
                  data-cta={`hub-upgrade-${plan.id}`}
                >
                  {plan.cta} →
                </a>
              </div>
            );
          })}
        </div>

        <div className="text-center">
          <p className="text-slate-500 text-sm mb-3">
            Questions? <a href="mailto:mike@factorylm.com" className="text-blue-400 hover:text-blue-300">Contact us</a>
            {" · "}
            <a href="https://factorylm.com/pricing" className="text-blue-400 hover:text-blue-300">See full pricing</a>
          </p>
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
