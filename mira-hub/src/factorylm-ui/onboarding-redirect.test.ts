import { describe, expect, it } from "vitest";
import { onboardingRedirect } from "./hub-host-logic";

// #4284 Codex F1: the shell is staging's landing page, so it makes the same
// onboarding decision /feed makes (#1901).
const reply = (ok: boolean, body: unknown) => async () => ({ ok, json: async () => body });

describe("onboardingRedirect — the shell sends an unfinished tenant into setup, like /feed", () => {
  it.each(["not_started", "in_progress"])("wizard %s → /onboarding", async (status) => {
    expect(await onboardingRedirect(reply(true, { status }))).toBe("/onboarding");
  });

  it("asks the same endpoint /feed asks", async () => {
    const asked: string[] = [];
    await onboardingRedirect(async (path) => { asked.push(path); return { ok: true, json: async () => ({ status: "completed" }) }; });
    expect(asked).toEqual(["/api/wizard/company"]);
  });

  it("control — a completed (or unknown) wizard stays on the shell", async () => {
    expect(await onboardingRedirect(reply(true, { status: "completed" }))).toBeNull();
    expect(await onboardingRedirect(reply(true, { status: "something-new" }))).toBeNull();
  });

  it("fails safe: a non-OK, malformed, or failed read stays on the shell", async () => {
    expect(await onboardingRedirect(reply(false, { status: "not_started" }))).toBeNull();
    expect(await onboardingRedirect(async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }))).toBeNull();
    expect(await onboardingRedirect(reply(true, null))).toBeNull();
    expect(await onboardingRedirect(async () => { throw new Error("offline"); })).toBeNull();
  });
});
