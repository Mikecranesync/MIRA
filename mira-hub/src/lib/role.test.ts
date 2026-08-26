import { describe, expect, it } from "vitest";
import { NO_ROLE, ROLES, isRole, normalizeRole, sessionRole } from "@/lib/role";

describe("normalizeRole — never defaults up", () => {
  it.each([undefined, null, "", "   ", 0, 42, {}, [], true])("absent/non-string %p → NO_ROLE", (raw) => {
    expect(normalizeRole(raw)).toBe(NO_ROLE);
  });

  it.each(["superuser", "root", "member", "Owner!", "owner;admin", "OWNERS"])(
    "unknown/malformed %p → NO_ROLE (falls through to least privilege, like capabilities.ts)",
    (raw) => {
      expect(normalizeRole(raw)).toBe(NO_ROLE);
    },
  );

  it.each([...ROLES])("valid role %s round-trips", (role) => {
    expect(normalizeRole(role)).toBe(role);
    expect(isRole(role)).toBe(true);
  });

  it("is case/whitespace tolerant for the six real roles only", () => {
    expect(normalizeRole(" OWNER ")).toBe("owner");
    expect(normalizeRole("Technician")).toBe("technician");
  });
});

describe("sessionRole — the value both client providers use", () => {
  it("no session / no user / no role → NO_ROLE, never owner", () => {
    expect(sessionRole(null)).toBe(NO_ROLE);
    expect(sessionRole(undefined)).toBe(NO_ROLE);
    expect(sessionRole({})).toBe(NO_ROLE);
    expect(sessionRole({ user: {} })).toBe(NO_ROLE);
    expect(sessionRole({ user: { id: "u1", tenantId: "t1", status: "active" } })).toBe(NO_ROLE);
  });

  it("malformed role on the session → NO_ROLE", () => {
    expect(sessionRole({ user: { role: "member" } })).toBe(NO_ROLE);
    expect(sessionRole({ user: { role: 7 } })).toBe(NO_ROLE);
  });

  it("resolved role passes through", () => {
    expect(sessionRole({ user: { role: "technician" } })).toBe("technician");
    expect(sessionRole({ user: { role: "owner" } })).toBe("owner");
  });
});
