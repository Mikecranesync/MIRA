"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/config";
import type { PublicSignupPolicy } from "@/capabilities/free-technician-signup";

export function signupOfferLabel(policy: PublicSignupPolicy | null): string {
  if (!policy) return "Create your MIRA account.";
  if (policy.kind === "free_technician") return "Free for technicians — no credit card.";
  if (policy.kind === "pilot_application") return "Request pilot access. Approval is required.";
  return `${policy.trialDays}-day free trial — no credit card.`;
}

export function SignupOffer() {
  const [policy, setPolicy] = useState<PublicSignupPolicy | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/public/signup-policy/`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        const valid = data?.version === 1 && (
          (data.kind === "free_technician" && data.requiresApproval === false && data.trialDays === null) ||
          (data.kind === "pilot_application" && data.requiresApproval === true && Number.isInteger(data.trialDays) && data.trialDays > 0) ||
          (data.kind === "trial" && data.requiresApproval === false && Number.isInteger(data.trialDays) && data.trialDays > 0)
        );
        if (valid) setPolicy(data);
      })
      .catch(() => { /* Keep neutral copy when the current offer cannot be read. */ });
    return () => controller.abort();
  }, []);
  return <p className="text-slate-300 text-sm font-medium mt-3" aria-live="polite">{signupOfferLabel(policy)}</p>;
}
