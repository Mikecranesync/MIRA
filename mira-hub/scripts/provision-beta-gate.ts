/**
 * Provision a real "stranger" run for the beta release gate, end-to-end over HTTP.
 *
 * The gate `tests/beta/beta_ready_upload_retrieval_citation.py` needs a LIVE Hub
 * NodeChat surface + a real next-auth session cookie + a self-served node. This
 * script produces exactly that against a locally-running Hub, with no hand-seeded
 * data — the stranger registers, gets a node, and the gate then uploads a manual
 * through the real door and asks for a cited answer.
 *
 * Steps: register (auth-side tenant) → mirror tenant into the DATA-side `tenants`
 * (UUID FK that knowledge_entries / kg_entities reference) → mint the next-auth
 * cookie (csrf → credentials callback) → create a namespace node via the real
 * route. Emits `BETA_GATE_*` env lines on stdout (prefixed `ENV:`); progress on
 * stderr.
 *
 * Full recipe (build the Hub at basePath='' on dev, run the gate):
 *   cd mira-hub
 *   NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' NODE_ENV=production \
 *     doppler run -p factorylm -c dev -- ./node_modules/.bin/next build
 *   NEXT_PUBLIC_BASE_PATH='' NODE_ENV=production \
 *     doppler run -p factorylm -c dev -- env NEXTAUTH_URL=http://localhost:3100 \
 *     AUTH_TRUST_HOST=true ./node_modules/.bin/next start -p 3100 &
 *   doppler run -p factorylm -c dev -- bun run scripts/provision-beta-gate.ts > /tmp/env.out
 *   cd .. && set -a; . <(grep '^ENV:' /tmp/env.out | sed 's/^ENV://'); set +a
 *   .venv/bin/python -m pytest tests/beta/beta_ready_upload_retrieval_citation.py -v -rX
 *   # XPASS(strict) == the gate is MET.
 *
 * HUB defaults to http://localhost:3100 (override with HUB_BASE).
 */
import { Client } from "pg";

const HUB = process.env.HUB_BASE ?? "http://localhost:3100";
const SUFFIX = Date.now().toString();
const CREDS = {
  email: `betagate-${SUFFIX}@factorylm.com`,
  password: "TestPass123!",
  name: "Beta Gate Stranger",
};

function extractSession(raw: string): string | null {
  const matches = [...raw.matchAll(/next-auth\.session-token=([^;,\s]+)/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

async function main() {
  // 1. Register a fresh stranger tenant (auth side: hub_tenants).
  const reg = await fetch(`${HUB}/api/auth/register/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CREDS),
  });
  const regJson = (await reg.json().catch(() => ({}))) as { tenantId?: string };
  if (reg.status !== 201 || !regJson.tenantId) {
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(regJson)}`);
  }
  const tenantId = regJson.tenantId;
  console.error(`registered tenant ${tenantId}`);

  // 2. Mirror the tenant id into the DATA-side `tenants` (UUID FK). register only
  //    made the auth-side row; without this the upload's chunk INSERT 500s on FK.
  const owner = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await owner.connect();
  try {
    await owner.query(
      `INSERT INTO tenants (id, name, contact_email) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `betagate_${SUFFIX}`, CREDS.email],
    );
  } finally {
    await owner.end();
  }
  console.error("mirrored tenant into data-side `tenants`");

  // 3. Mint the next-auth session cookie (csrf → credentials callback).
  const csrfRes = await fetch(`${HUB}/api/auth/csrf/`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const cookie1 = csrfRes.headers.get("set-cookie") ?? "";
  const form = new URLSearchParams();
  form.set("email", CREDS.email);
  form.set("password", CREDS.password);
  form.set("csrfToken", csrfToken);
  form.set("redirect", "false");
  form.set("json", "true");
  form.set("callbackUrl", HUB);
  const signIn = await fetch(`${HUB}/api/auth/callback/credentials/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie1 },
    body: form.toString(),
    redirect: "manual",
  });
  const sessionToken = extractSession([cookie1, signIn.headers.get("set-cookie") ?? ""].join(", "));
  if (!sessionToken) throw new Error(`no session cookie (signin ${signIn.status})`);
  const cookieHeader = `next-auth.session-token=${sessionToken}`;
  console.error(`minted session cookie (signin ${signIn.status})`);

  // 4. Create a namespace node as the stranger (real route).
  const nodeRes = await fetch(`${HUB}/api/namespace/node/`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ name: `Beta Gate Folder ${SUFFIX}` }),
  });
  const nodeJson = (await nodeRes.json().catch(() => ({}))) as { node?: { id?: string } };
  if (nodeRes.status !== 201 || !nodeJson.node?.id) {
    throw new Error(`node create failed: ${nodeRes.status} ${JSON.stringify(nodeJson)}`);
  }
  const nodeId = nodeJson.node.id;
  console.error(`created node ${nodeId}`);

  // Emit env for the gate (trailing-slash canonical doors; cookie auth).
  console.log(`ENV:BETA_GATE_UPLOAD_URL=${HUB}/api/namespace/node/${nodeId}/files/`);
  console.log(`ENV:BETA_GATE_CHAT_URL=${HUB}/api/namespace/node/${nodeId}/chat/`);
  console.log(`ENV:BETA_GATE_TENANT=${tenantId}`);
  console.log(`ENV:BETA_GATE_COOKIE=${cookieHeader}`);
  console.log(`ENV:BETA_GATE_NODE=${nodeId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
