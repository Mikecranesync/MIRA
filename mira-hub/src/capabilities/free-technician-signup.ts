/** Opt-in free personal workspaces; explicit plant pilots keep their admission policy. */
import { PILOT_WINDOW_DAYS } from "@/lib/config";
import { isPilotApprovalRequired } from "@/capabilities/pilot-access";

export function freeTechnicianSignupEnabled(): boolean {
  return process.env.MIRA_FREE_TECHNICIANS === "true";
}

export interface PublicSignupPolicy {
  version: 1;
  kind: "free_technician" | "pilot_application" | "trial";
  requiresApproval: boolean;
  trialDays: number | null;
}

export type SignupIntent = "technician" | "pilot";

export function publicSignupPolicy(intent: SignupIntent = "technician"): PublicSignupPolicy {
  if (freeTechnicianSignupEnabled() && intent === "technician") {
    return { version: 1, kind: "free_technician", requiresApproval: false, trialDays: null };
  }
  if (isPilotApprovalRequired()) {
    return { version: 1, kind: "pilot_application", requiresApproval: true, trialDays: PILOT_WINDOW_DAYS };
  }
  return { version: 1, kind: "trial", requiresApproval: false, trialDays: PILOT_WINDOW_DAYS };
}
