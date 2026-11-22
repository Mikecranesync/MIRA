import type { Pool } from "pg";

export class PersonalWorkspaceError extends Error {
  constructor() { super("Free technician workspaces are for one person. Contact FactoryLM to arrange a team workspace or plant pilot."); }
}

/** Durable workspace policy also applies after the rollout flag is disabled. */
export async function assertTeamInvitesAllowed(db: Pick<Pool, "query">, tenantId: string): Promise<void> {
  const { rows } = await db.query("SELECT signup_offer FROM hub_tenants WHERE id = $1 LIMIT 1", [tenantId]);
  if (rows[0]?.signup_offer === "technician_free") throw new PersonalWorkspaceError();
}
