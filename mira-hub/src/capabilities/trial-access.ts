import {
  INVITE_MAGIC_LINK_TTL_MINUTES,
  LOGIN_MAGIC_LINK_TTL_MINUTES,
  PILOT_MAX_USERS,
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

export class PilotSeatCapError extends Error {
  readonly maxUsers: number;

  constructor(maxUsers: number = PILOT_MAX_USERS) {
    super(
      `This pilot site is limited to ${maxUsers} users. A sixth invite cannot be sent until a seat is free.`,
    );
    this.name = "PilotSeatCapError";
    this.maxUsers = maxUsers;
  }
}

/** Members plus unused pending invite emails that are not already members. */
export function occupiedPilotSeats(
  memberEmails: Iterable<string>,
  pendingInviteEmails: Iterable<string>,
): number {
  const members = new Set(
    [...memberEmails].map((email) => email.trim().toLowerCase()).filter(Boolean),
  );
  const pending = new Set(
    [...pendingInviteEmails]
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email && !members.has(email)),
  );
  return members.size + pending.size;
}

export function canInvitePilotSeat(
  occupied: number,
  emailAlreadyMember: boolean,
  maxUsers: number = PILOT_MAX_USERS,
): boolean {
  if (emailAlreadyMember) return true;
  return occupied < maxUsers;
}

export function inviteLinkExpiryCopy(days: number = PILOT_WINDOW_DAYS): string {
  return `This link stays valid for ${days} days and can only be used once.`;
}
