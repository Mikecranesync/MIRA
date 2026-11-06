"use client";

// The free pilot is not a checkout or an automatic subscription.
import { Factory, ClipboardCheck, FlaskConical, Check, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

const PLANS = [
  {
    id: "continuation",
    tier: "Your MIRA pilot",
    price: "Let’s review",
    period: "the next step",
    description: "Review your scoped pilot with us. Any paid continuation requires a separate agreement; this page does not charge you or renew your pilot.",
    highlight: "Pilot follow-up",
    color: "#2563EB",
    cta: "Discuss paid continuation",
    ctaHref: "mailto:mike@factorylm.com?subject=MIRA%20pilot%20continuation",
    icon: FlaskConical,
    features: [
      "Review the equipment and manual scope tested",
      "Review answer accuracy, sources, and safety acceptance",
      "Agree any future scope and pricing before continuing",
    ],
  },
  {
    id: "consulting",
    tier: "Separate paid service",
    price: "Consulting",
    period: "& assessment",
    description: "Need hands-on help assessing or organizing maintenance information? Discuss a separate consulting engagement. It is not a prerequisite for applying to the free pilot.",
    highlight: null,
    color: "#0891B2",
    cta: "Ask about consulting",
    ctaHref: "mailto:mike@factorylm.com?subject=FactoryLM%20paid%20consulting%20and%20assessment",
    icon: ClipboardCheck,
    features: [
      "Discuss your assessment or implementation needs",
      "Agree scope, deliverables, and fees separately",
      "An inquiry is not a purchase or an activation",
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
          <h1 className="text-3xl font-bold text-white mb-3">Review your next step</h1>
          <p className="text-slate-400 text-base max-w-xl mx-auto">
            The free 30-day pilot and paid consulting are separate offers. Paid continuation is agreed with you separately.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
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
            <a href="https://factorylm.com/pricing" className="text-blue-400 hover:text-blue-300">Pilot information</a>
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
