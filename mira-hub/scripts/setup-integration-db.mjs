#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hubRoot = path.resolve(__dirname, "..");
const migrationsDir = path.join(hubRoot, "db", "migrations");
const fixturesDir = path.join(hubRoot, "db", "integration-fixtures");

const defaultMigrationFiles = [
  "001_knowledge_graph.sql",
  "010_kg_uns_path.sql",
  "026_kg_entities_dedupe_and_constraint.sql",
  "027_ai_suggestions.sql",
  "029_kg_approval_state.sql",
  "055_contextualization.sql",
  "056_contextualization_intake.sql",
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function assertDisposable(urlText) {
  const confirm = process.env.MIRA_TEST_DB_CONFIRM;
  if (confirm !== "DISPOSABLE") {
    throw new Error("Set MIRA_TEST_DB_CONFIRM=DISPOSABLE to confirm this is not prod/staging.");
  }

  const url = new URL(urlText);
  const lower = `${url.hostname} ${url.pathname}`.toLowerCase();
  if (lower.includes("prod") || lower.includes("prd") || lower.includes("staging")) {
    throw new Error(`Refusing unsafe database URL host/path: ${url.hostname}${url.pathname}`);
  }
}

async function listSql(dir) {
  const files = await fs.readdir(dir);
  return files
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => path.join(dir, file));
}

async function integrationMigrations() {
  const configured = process.env.MIRA_INTEGRATION_MIGRATIONS;
  const files = configured
    ? configured.split(",").map((file) => file.trim()).filter(Boolean)
    : defaultMigrationFiles;

  return Promise.all(files.map(async (file) => {
    const fullPath = path.join(migrationsDir, file);
    await fs.access(fullPath);
    return fullPath;
  }));
}

async function ensureBootstrap(client) {
  await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await client.query("CREATE EXTENSION IF NOT EXISTS ltree");
  await client.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
  await client.query("DO $$ BEGIN CREATE ROLE factorylm_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
  await client.query("GRANT USAGE ON SCHEMA public TO factorylm_app");
  await client.query(`
    CREATE TABLE IF NOT EXISTS integration_schema_migrations (
      file_name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function applySqlFile(client, file) {
  const fileName = path.basename(file);
  const seen = await client.query(
    "SELECT 1 FROM integration_schema_migrations WHERE file_name = $1",
    [fileName],
  );

  if (seen.rowCount) {
    console.log(`[skip] ${fileName}`);
    return;
  }

  const sql = await fs.readFile(file, "utf8");
  console.log(`[apply] ${fileName}`);
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO integration_schema_migrations (file_name) VALUES ($1)",
      [fileName],
    );
  } catch (err) {
    throw new Error(`${fileName} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function smokeCheck(client) {
  const required = [
    "tenants",
    "cmms_sites",
    "cmms_areas",
    "cmms_equipment",
    "tenant_audit_log",
    "contextualization_projects",
    "ctx_sources",
    "ctx_extractions",
    "ctx_import_batches",
    "kg_entities",
    "ai_suggestions",
  ];

  for (const table of required) {
    const res = await client.query("SELECT to_regclass($1) AS table_name", [`public.${table}`]);
    if (!res.rows[0].table_name) {
      throw new Error(`Missing required table: ${table}`);
    }
  }

  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app'");
  if (!role.rowCount) {
    throw new Error("Missing required role: factorylm_app");
  }

  console.log("[ok] integration database smoke check passed");
}

async function grantIntegrationPrivileges(client) {
  await client.query("GRANT SELECT, INSERT, UPDATE ON kg_entities TO factorylm_app");
  await client.query("GRANT SELECT, INSERT, UPDATE ON kg_relationships TO factorylm_app");
  await client.query("GRANT SELECT, INSERT ON kg_triples_log TO factorylm_app");
}

async function main() {
  const databaseUrl = requireEnv("TEST_DATABASE_URL");
  assertDisposable(databaseUrl);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await ensureBootstrap(client);

    for (const file of await listSql(fixturesDir)) {
      await applySqlFile(client, file);
    }

    for (const file of await integrationMigrations()) {
      await applySqlFile(client, file);
    }

    await grantIntegrationPrivileges(client);
    await smokeCheck(client);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[setup-integration-db] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
