#!/usr/bin/env node
/**
 * Seeds the disposable database for the magic-link return browser test (#5753).
 *
 * Builds only the schema the sign-in and source-viewer path reads, from the
 * real migration files (the same set the free-technician-signup integration
 * test uses, plus the parked-upload table), then writes one synthetic tenant,
 * one synthetic user and one generated 30-page PDF from `seed.json`.
 *
 * Two connections, like production: the bootstrap superuser
 * (MLR_ADMIN_DATABASE_URL) only creates the roles, the database and the
 * extensions; the migrations and rows run as the non-superuser Hub role
 * (MLR_DATABASE_URL), which therefore owns the tables the Hub reads. The Hub
 * role's password comes from MLR_HUB_DB_PASSWORD, never from argv.
 *
 * Refuses any database that is not a local Unix socket or loopback, and
 * requires MIRA_TEST_DB_CONFIRM=DISPOSABLE. Never point it at staging or
 * production.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pg from "pg";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit");
const { parse: parseConnectionString } = require("pg-connection-string");

const here = path.dirname(fileURLToPath(import.meta.url));
const hubRoot = path.resolve(here, "..", "..", "..");
const repoRoot = path.resolve(hubRoot, "..");
const seed = JSON.parse(fs.readFileSync(path.join(here, "seed.json"), "utf8"));

if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
  throw new Error("Set MIRA_TEST_DB_CONFIRM=DISPOSABLE to confirm this database is throwaway");
}
/** The connection string in `name`, refused unless it is a local socket or loopback. */
function localUrl(name) {
  const url = process.env[name];
  if (!url) throw new Error(`${name} is required`);
  // Parse it the way the driver will, so a `?host=` override cannot hide a remote host.
  const host = String(parseConnectionString(url).host ?? "");
  if (!(path.isAbsolute(host) || ["127.0.0.1", "localhost", "::1"].includes(host))) {
    throw new Error(`Refusing ${name}: host ${host || "(none)"} is not a local socket or loopback`);
  }
  return url;
}
const adminUrl = localUrl("MLR_ADMIN_DATABASE_URL");
const hubUrl = localUrl("MLR_DATABASE_URL");
const hubPassword = process.env.MLR_HUB_DB_PASSWORD;
if (!hubPassword || hubPassword.length < 32) throw new Error("MLR_HUB_DB_PASSWORD (per-run, 32+ chars) is required");
const hubConn = parseConnectionString(hubUrl);
const HUB_ROLE = hubConn.user;
const HUB_DB = hubConn.database;
if (!HUB_ROLE || !HUB_DB) throw new Error("MLR_DATABASE_URL must name a user and a database");

const MIGRATIONS = [
  path.join(repoRoot, "mira-core/mira-ingest/db/migrations/008_hub_users_tenants.sql"),
  // assertAuthMigrationReady() reads the legacy tenants table; the integration
  // test creates the same minimal shape.
  "CREATE TABLE IF NOT EXISTS tenants (id UUID PRIMARY KEY, name TEXT NOT NULL, contact_email TEXT NOT NULL)",
  ...["107_pilot_access.sql", "108_pilot_applications.sql", "109_hub_users_terms_consent.sql",
    "116_verified_personal_onboarding.sql", "117_auth_schema_and_identity_provenance.sql",
    // The source viewer's byte route reads namespace_direct_uploads (027), whose
    // node_id references kg_entities (001); 059 adds the stored content.
    "001_knowledge_graph.sql", "027_namespace_direct_uploads.sql", "059_namespace_filing_cabinet.sql"]
    .map((name) => path.join(hubRoot, "db", "migrations", name)),
];

function manualPdf(pages) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, size: "LETTER" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (let n = 1; n <= pages; n += 1) {
      doc.addPage();
      doc.fontSize(28).text(`Synthetic drive manual`, 72, 72);
      doc.fontSize(48).text(`Page ${n}`, 72, 160);
      doc.fontSize(12).text("Generated for the FactoryLM magic-link return browser test. Not a real manual.", 72, 260);
    }
    doc.end();
  });
}

// ---- bootstrap, as the superuser: roles, database, extensions only ----------
{
  // Parsed config, not connectionString: pg lets a connection string override `database`.
  const adminConfig = parseConnectionString(adminUrl);
  const admin = new pg.Client({ ...adminConfig, database: "postgres" });
  await admin.connect();
  try {
    const role = admin.escapeIdentifier(HUB_ROLE);
    await admin.query("DO $$ BEGIN CREATE ROLE factorylm_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${admin.escapeLiteral(hubPassword)}`);
    await admin.query(`GRANT factorylm_app TO ${role}`);
    await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(HUB_DB)} OWNER ${role}`);
  } finally {
    await admin.end();
  }
  const adminDb = new pg.Client({ ...adminConfig, database: HUB_DB });
  await adminDb.connect();
  try {
    await adminDb.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await adminDb.query("CREATE EXTENSION IF NOT EXISTS ltree");
  } finally {
    await adminDb.end();
  }
}

// ---- schema and rows, as the non-superuser Hub role ------------------------
const client = new pg.Client({ connectionString: hubUrl });
await client.connect();
try {
  const who = await client.query("SELECT current_user AS name, rolsuper FROM pg_roles WHERE rolname = current_user");
  if (who.rows[0]?.rolsuper !== false) throw new Error("the Hub role must not be a superuser");
  for (const step of MIGRATIONS) {
    await client.query(step.endsWith(".sql") ? fs.readFileSync(step, "utf8") : step);
  }
  // 008 carries a historical seed row; this database holds only the synthetic account.
  await client.query("DELETE FROM hub_users WHERE id = 'mike-owner'");
  await client.query("DELETE FROM hub_tenants WHERE id = 'mike'");

  await client.query("BEGIN");
  await client.query("INSERT INTO hub_tenants (id, name) VALUES ($1, $2)", [seed.tenantId, seed.tenantName]);
  await client.query(
    `INSERT INTO hub_users (id, email, tenant_id, name, role, status)
     VALUES ($1, $2, $3, 'E2E Technician', 'owner', 'approved')`,
    [seed.userId, seed.email, seed.tenantId],
  );
  await client.query("UPDATE hub_tenants SET owner_user_id = $1 WHERE id = $2", [seed.userId, seed.tenantId]);
  const pdf = await manualPdf(seed.pages);
  await client.query(
    `INSERT INTO namespace_direct_uploads (id, tenant_id, filename, mime_type, size_bytes, content, created_by)
     VALUES ($1, $2, $3, 'application/pdf', $4, $5, $6)`,
    [seed.fileId, seed.tenantId, seed.filename, pdf.length, pdf, seed.userId],
  );
  await client.query("COMMIT");
  console.log(JSON.stringify({ seeded: true, hubRole: HUB_ROLE, hubRoleSuperuser: false, tenant: seed.tenantId, file: seed.fileId, pages: seed.pages, pdfBytes: pdf.length }));
} finally {
  await client.end();
}
