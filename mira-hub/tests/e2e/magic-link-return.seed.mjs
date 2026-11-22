#!/usr/bin/env node
/**
 * Seeds the disposable database for the magic-link return browser test (#5753).
 *
 * Builds only the schema the sign-in and source-viewer path reads, from the
 * real migration files (the same set the free-technician-signup integration
 * test uses, plus the parked-upload table), then writes one synthetic tenant,
 * one synthetic user and one generated 30-page PDF from
 * `fixtures/magic-link-return-seed.json`.
 *
 * Refuses any database that is not on loopback, and requires
 * MIRA_TEST_DB_CONFIRM=DISPOSABLE. Never point it at staging or production.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pg from "pg";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit");

const here = path.dirname(fileURLToPath(import.meta.url));
const hubRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(hubRoot, "..");
const seed = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "magic-link-return-seed.json"), "utf8"));

const url = process.env.MLR_DATABASE_URL;
if (!url) throw new Error("MLR_DATABASE_URL is required");
if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
  throw new Error("Set MIRA_TEST_DB_CONFIRM=DISPOSABLE to confirm this database is throwaway");
}
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  throw new Error(`Refusing a non-loopback database host: ${host}`);
}

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

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await client.query("CREATE EXTENSION IF NOT EXISTS ltree");
  await client.query("DO $$ BEGIN CREATE ROLE factorylm_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
  await client.query("DO $$ BEGIN EXECUTE format('GRANT factorylm_app TO %I', current_user); END $$");
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
  console.log(JSON.stringify({ seeded: true, tenant: seed.tenantId, file: seed.fileId, pages: seed.pages, pdfBytes: pdf.length }));
} finally {
  await client.end();
}
