import {
  INVITE_MAGIC_LINK_TTL_MINUTES,
  LOGIN_MAGIC_LINK_TTL_MINUTES,
  PILOT_WINDOW_DAYS,
} from "@/lib/config";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const PILOT_WINDOW_MS = PILOT_WINDOW_DAYS * DAY_MS;

export type TrialAccessDecision = "ok" | "pending" | "upgrade";

/** Same gate middleware uses: pending → hold, expired/past-trial → /upgrade. */
export function trialAccessDecision(
  status: string,
  trialExpiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): TrialAccessDecision {
  if (status === "pending") return "pending";
  if (status === "expired") return "upgrade";
  if (status === "trial" && trialExpiresAt) {
    const exp = trialExpiresAt instanceof Date ? trialExpiresAt : new Date(trialExpiresAt);
    if (now.getTime() > exp.getTime()) return "upgrade";
  }
  return "ok";
}

export function trialExpiresAtFrom(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PILOT_WINDOW_MS);
}

/** Invite tokens live the full pilot window; login tokens stay 15 minutes. */
export function magicTokenTtlMinutes(kind: "invite" | "login"): number {
  return kind === "invite" ? INVITE_MAGIC_LINK_TTL_MINUTES : LOGIN_MAGIC_LINK_TTL_MINUTES;
}

export function isMagicTokenLiveAt(
  kind: "invite" | "login",
  issuedAt: Date,
  now: Date,
): boolean {
  return now.getTime() - issuedAt.getTime() < magicTokenTtlMinutes(kind) * MINUTE_MS;
}

export function inviteLinkExpiryCopy(days: number = PILOT_WINDOW_DAYS): string {
  return `This link stays valid for ${days} days and can only be used once.`;
}
