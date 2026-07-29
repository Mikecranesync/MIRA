#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_TENANTS = [
  "000000c1-0000-0000-0000-0000000000c1",
  "000000a1-0000-0000-0000-0000000000a1",
  "000000b2-0000-0000-0000-0000000000b2",
  "00000000-0000-0000-0000-00000000000a",
  "00000000-0000-0000-0000-00000000000b",
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function assertDevOnly(urlText) {
  const url = new URL(urlText);
  const lower = `${url.hostname} ${url.pathname}`.toLowerCase();
  if (!lower.includes("ep-lingering-salad")) {
    throw new Error(
      `Refusing to run shared-dev integration tests against ${url.hostname}${url.pathname}. ` +
        "Use Doppler factorylm/dev or a disposable TEST_DATABASE_URL branch.",
    );
  }
}

async function deleteIfPresent(client, table, column) {
  try {
    await client.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::uuid[])`, [TEST_TENANTS]);
  } catch (err) {
    if (err && err.code === "42P01") {
      console.log(`[cleanup skip] missing table ${table}`);
      return;
    }
    throw err;
  }
}

async function cleanup(databaseUrl) {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const tables = [
      "contextualization_projects",
      "ai_suggestions",
      "kg_entities",
      "ctx_extractions",
      "ctx_sources",
      "ctx_import_batches",
    ];
    for (const table of tables) {
      await deleteIfPresent(client, table, "tenant_id");
    }
    await deleteIfPresent(client, "tenants", "id");
    console.log("[cleanup] fixed integration tenants removed");
  } finally {
    await client.end();
  }
}

async function main() {
  const databaseUrl = requireEnv("NEON_DATABASE_URL");
  assertDevOnly(databaseUrl);

  const result = spawnSync(process.execPath, [
    path.join(__dirname, "..", "node_modules", "vitest", "vitest.mjs"),
    "run",
    "--config",
    "vitest.integration.config.ts",
    ...process.argv.slice(2),
  ], {
    stdio: "inherit",
    env: {
      ...process.env,
      TEST_DATABASE_URL: databaseUrl,
    },
  });
  if (result.error) {
    console.error(`[test spawn failed] ${result.error.message}`);
  }

  await cleanup(databaseUrl);
  process.exit(result.status ?? 1);
}

main().catch((err) => {
  console.error(`[run-dev-integration-tests] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
