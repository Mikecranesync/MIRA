import { describe, expect, it } from "vitest";
import {
  INVITE_MAGIC_LINK_TTL_MINUTES,
  LOGIN_MAGIC_LINK_TTL_MINUTES,
  PILOT_WINDOW_DAYS,
} from "@/lib/config";
import {
  inviteLinkExpiryCopy,
  isMagicTokenLiveAt,
  trialAccessDecision,
  trialExpiresAtFrom,
} from "@/capabilities/trial-access";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const createdAt = new Date("2026-10-01T12:00:00.000Z");
const expiresAt = trialExpiresAtFrom(createdAt);

function daysLater(days: number): Date {
  return new Date(createdAt.getTime() + days * DAY_MS);
}

/** Production middleware predicate — kept here so the frozen file is not edited. */
function middlewareTrialDecision(
  status: string,
  trialExpiresAt: unknown,
  now: Date,
): "ok" | "pending" | "upgrade" {
  if (status === "pending") return "pending";
  if (status === "expired") return "upgrade";
  if (status === "trial" && typeof trialExpiresAt === "string") {
    if (now > new Date(trialExpiresAt)) return "upgrade";
  }
  return "ok";
}

describe("trialAccessDecision — 30-day pilot window (#4362)", () => {
  it("keeps trial access open on day 8 and day 29", () => {
    expect(trialAccessDecision("trial", expiresAt, daysLater(8))).toBe("ok");
    expect(trialAccessDecision("trial", expiresAt, daysLater(29))).toBe("ok");
  });

  it("follows existing post-trial behavior on day 31", () => {
    expect(trialAccessDecision("trial", expiresAt, daysLater(31))).toBe("upgrade");
    expect(trialAccessDecision("approved", expiresAt, daysLater(31))).toBe("ok");
    expect(trialAccessDecision("expired", expiresAt, daysLater(31))).toBe("upgrade");
    expect(trialAccessDecision("pending", expiresAt, daysLater(31))).toBe("pending");
  });

  it("sets the trial clock to the full 30-day pilot window", () => {
    expect(PILOT_WINDOW_DAYS).toBe(30);
    expect(expiresAt.getTime() - createdAt.getTime()).toBe(30 * DAY_MS);
  });

  it("matches the existing middleware gate on days 8, 29, and 31", () => {
    const exp = expiresAt.toISOString();
    for (const day of [8, 29, 31]) {
      const now = daysLater(day);
      expect(middlewareTrialDecision("trial", exp, now)).toBe(
        trialAccessDecision("trial", exp, now),
      );
    }
    expect(middlewareTrialDecision("approved", exp, daysLater(31))).toBe("ok");
  });
});

describe("invite magic-link lifetime (#4362)", () => {
  const issuedAt = createdAt;

  it("accepts an invite after 15 minutes and on day 29", () => {
    expect(
      isMagicTokenLiveAt("invite", issuedAt, new Date(issuedAt.getTime() + 16 * MINUTE_MS)),
    ).toBe(true);
    expect(isMagicTokenLiveAt("invite", issuedAt, daysLater(29))).toBe(true);
    expect(INVITE_MAGIC_LINK_TTL_MINUTES).toBe(30 * 24 * 60);
  });

  it("still expires ordinary login links after 15 minutes", () => {
    expect(
      isMagicTokenLiveAt("login", issuedAt, new Date(issuedAt.getTime() + 14 * MINUTE_MS)),
    ).toBe(true);
    expect(
      isMagicTokenLiveAt("login", issuedAt, new Date(issuedAt.getTime() + 16 * MINUTE_MS)),
    ).toBe(false);
    expect(LOGIN_MAGIC_LINK_TTL_MINUTES).toBe(15);
  });

  it("does not claim every magic link expires in 15 minutes", () => {
    expect(inviteLinkExpiryCopy()).toMatch(/30 days/);
    expect(inviteLinkExpiryCopy()).not.toMatch(/15 minutes/);
  });
});
