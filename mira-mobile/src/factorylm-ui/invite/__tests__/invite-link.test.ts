import { describe, expect, it } from "vitest";
import { inviteTokenIdentity, parseInviteLink } from "../invite-link";

const TRUSTED = "https://app.factorylm.com";
const UUID = "11111111-2222-4333-8444-555555555555";

describe("parseInviteLink", () => {
  it("accepts a well-formed invitation link on the trusted origin", () => {
    expect(parseInviteLink(`${TRUSTED}/hub/magic?token=${UUID}`, TRUSTED)).toEqual({
      token: UUID,
    });
  });

  it("accepts the link when the hub serves without a basePath", () => {
    expect(parseInviteLink(`${TRUSTED}/magic?token=${UUID}`, TRUSTED)).toEqual({
      token: UUID,
    });
  });

  // The hub runs with Next's trailingSlash: true (next.config.ts), so the
  // CANONICAL emailed link has a trailing slash before the query string.
  // This link is never fetched/followed, so nothing would normalize it for
  // us — the parser itself must accept the canonical shape.
  it("accepts the CANONICAL trailing-slash link (basePath)", () => {
    expect(parseInviteLink(`${TRUSTED}/hub/magic/?token=${UUID}`, TRUSTED)).toEqual({
      token: UUID,
    });
  });

  it("accepts the CANONICAL trailing-slash link (no basePath)", () => {
    expect(parseInviteLink(`${TRUSTED}/magic/?token=${UUID}`, TRUSTED)).toEqual({
      token: UUID,
    });
  });

  it("rejects an empty paste", () => {
    expect(parseInviteLink("   ", TRUSTED)).toEqual({ error: "empty" });
  });

  it("rejects text that isn't a URL at all — never fetched, just rejected", () => {
    expect(parseInviteLink("not a url", TRUSTED)).toEqual({ error: "invalid_format" });
  });

  it("rejects a pasted link on an UNTRUSTED origin (phishing attempt)", () => {
    expect(
      parseInviteLink(`https://evil.example.com/hub/magic?token=${UUID}`, TRUSTED),
    ).toEqual({ error: "untrusted_origin" });
  });

  it("rejects a trusted-looking origin over plain http", () => {
    expect(parseInviteLink(`http://app.factorylm.com/magic?token=${UUID}`, TRUSTED)).toEqual({
      error: "invalid_format",
    });
  });

  it("rejects a trusted origin with the wrong path", () => {
    expect(parseInviteLink(`${TRUSTED}/login?token=${UUID}`, TRUSTED)).toEqual({
      error: "invalid_format",
    });
  });

  it("rejects a trusted link missing the token entirely", () => {
    expect(parseInviteLink(`${TRUSTED}/hub/magic`, TRUSTED)).toEqual({
      error: "missing_token",
    });
  });

  it("rejects a token that isn't UUID-shaped", () => {
    expect(parseInviteLink(`${TRUSTED}/hub/magic?token=not-a-uuid`, TRUSTED)).toEqual({
      error: "missing_token",
    });
  });

  it("inviteTokenIdentity treats a trailing-space edit as the same invite", () => {
    const link = `${TRUSTED}/hub/magic?token=${UUID}`;
    expect(inviteTokenIdentity(`${link} `)).toBe(inviteTokenIdentity(link));
  });

  it("inviteTokenIdentity distinguishes a different invitation token", () => {
    expect(
      inviteTokenIdentity(`${TRUSTED}/hub/magic?token=${UUID}`),
    ).not.toBe(
      inviteTokenIdentity(`${TRUSTED}/hub/magic?token=22222222-3333-4444-8555-666666666666`),
    );
  });
});

// #5942: the Hub's emailed sign-in link (magic-link-return.ts magicLinkUrl) puts the
// token in the FRAGMENT and may carry ?next=, e.g. /hub/magic/?next=...#token=<uuid>.
describe("the emailed sign-in link form (#5942)", () => {
  const NEXT = "?next=%2Fv3%2Fsource%2F%3Ffile%3Dabc";
  const OTHER = "99999999-2222-4333-8444-555555555555";

  it("accepts the token in the fragment", () => {
    expect(parseInviteLink(`${TRUSTED}/hub/magic/#token=${UUID}`, TRUSTED)).toEqual({ token: UUID });
  });

  it("accepts a fragment token after a ?next= return path", () => {
    expect(parseInviteLink(`${TRUSTED}/hub/magic/${NEXT}#token=${UUID}`, TRUSTED)).toEqual({
      token: UUID,
    });
  });

  it("accepts the same token in both places", () => {
    expect(parseInviteLink(`${TRUSTED}/hub/magic/?token=${UUID}#token=${UUID}`, TRUSTED)).toEqual({
      token: UUID,
    });
  });

  it("rejects two different tokens rather than pick one", () => {
    expect(parseInviteLink(`${TRUSTED}/hub/magic/?token=${UUID}#token=${OTHER}`, TRUSTED)).toEqual({
      error: "invalid_format",
    });
    expect(inviteTokenIdentity(`${TRUSTED}/hub/magic/?token=${UUID}#token=${OTHER}`)).toBeNull();
  });

  it("rejects a fragment token that isn't UUID-shaped", () => {
    expect(parseInviteLink(`${TRUSTED}/hub/magic/#token=not-a-uuid`, TRUSTED)).toEqual({
      error: "missing_token",
    });
  });

  it("rejects a fragment link on another origin", () => {
    expect(parseInviteLink(`https://evil.example/hub/magic/#token=${UUID}`, TRUSTED)).toEqual({
      error: "untrusted_origin",
    });
  });

  it("still rejects the onboarding setup link (control: /signup/, not /magic/)", () => {
    expect(
      parseInviteLink(`${TRUSTED}/hub/signup/?intent=technician#token=${UUID}`, TRUSTED),
    ).toEqual({ error: "invalid_format" });
  });

  it("inviteTokenIdentity reads the fragment too, so a retry recognises the same link", () => {
    expect(inviteTokenIdentity(`${TRUSTED}/hub/magic/${NEXT}#token=${UUID}`)).toBe(UUID);
    expect(inviteTokenIdentity(` ${TRUSTED}/hub/magic/#token=${UUID.toUpperCase()} `)).toBe(UUID);
  });
});
