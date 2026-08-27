// Tenant role resolution — the ONE place a raw role value becomes a typed Role.
//
// Doctrine (issue #2360, src/lib/capabilities.ts): an unknown or absent role
// falls through to least privilege. Before this module the two client-side
// providers and the hub_users row mapper each did `role ?? "owner"`, and the
// NextAuth session callback never set `session.user.role` at all — so every
// client-side permission check resolved to owner for every user.
//
// `NO_ROLE` ("") is the least-privilege sentinel. It is a valid resolved value
// (the user is authenticated, just unprivileged), never an error.

export const ROLES = ["technician", "manager", "scheduler", "admin", "operator", "owner"] as const;
export type Role = (typeof ROLES)[number];
export const NO_ROLE = "" as const;
export type ResolvedRole = Role | typeof NO_ROLE;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Raw DB/session value → Role, or NO_ROLE for absent, malformed, or unknown. */
export function normalizeRole(raw: unknown): ResolvedRole {
  if (typeof raw !== "string") return NO_ROLE;
  const v = raw.trim().toLowerCase();
  return isRole(v) ? v : NO_ROLE;
}

/** Role carried on a next-auth session object (client or server). Never defaults up. */
export function sessionRole(session: unknown): ResolvedRole {
  const user = (session as { user?: { role?: unknown } } | null | undefined)?.user;
  return normalizeRole(user?.role);
}
