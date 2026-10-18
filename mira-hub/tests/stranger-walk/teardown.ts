/**
 * Stranger Walk teardown for a run's out dir (#4460) — the workflow's every-exit-path step.
 * Sweeps the tenant named in tenant.txt; if registration's response was unreadable (no
 * tenant.txt), finds the tenant by the run-unique email in email.txt. Exit 1 if a tenant may
 * exist but could not be swept.
 *
 *   doppler run --project factorylm --config stg -- bun run tests/stranger-walk/teardown.ts <out dir>
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { teardownTenant, tenantIdForEmail } from "./staging";

const out = process.argv[2] ?? "";
const read = (f: string) => (existsSync(path.join(out, f)) ? readFileSync(path.join(out, f), "utf8").trim() : "");
let tenant = read("tenant.txt");
const email = read("email.txt");
if (!tenant && email) tenant = (await tenantIdForEmail(email)) ?? "";
if (!tenant) {
  console.log(email ? `no tenant exists for ${email}` : "no tenant was created");
  process.exit(0);
}
const td = teardownTenant(tenant);
console.log(`teardown ${td.ok ? "OK" : "FAILED"} — ${td.detail}`);
process.exit(td.ok ? 0 : 1);
