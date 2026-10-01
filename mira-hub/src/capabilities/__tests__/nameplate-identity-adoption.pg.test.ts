/**
 * Codex #4191 r3 F1/F3 — the adoption SQL against a REAL Postgres.
 *
 * The route tests mock the database, so they cannot show that the single
 * UPDATE's predicate (blank-or-adopted-from-this-photo, fingerprint, unbound)
 * behaves across a sequence of confirms. This suite runs the module's own SQL
 * on a throwaway Postgres. It is skipped unless MIRA_PG_TEST_URL is set, e.g.
 *
 *   docker run -d --name pg -e POSTGRES_PASSWORD=t -p 127.0.0.1:55491:5432 postgres:16
 *   MIRA_PG_TEST_URL=postgres://postgres:t@127.0.0.1:55491/postgres npx vitest run <this file>
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";

const URL = process.env.MIRA_PG_TEST_URL;
let client: Client;

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: async (_t: string, fn: (c: Client) => unknown) => fn(client),
}));

import { adoptNameplateIdentity } from "@/capabilities/nameplate-identity-adoption";

const T = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const PHOTO = "33333333-3333-4333-8333-333333333333";
const OTHER_PHOTO = "44444444-4444-4444-8444-444444444444";
const GS10 = { manufacturer: "AutomationDirect", model: "GS10", catalogNumber: "GS11N-10P2" };
const GS20 = { manufacturer: "AutomationDirect", model: "GS20", catalogNumber: "GS21-10P2" };
const GS30 = { manufacturer: "AutomationDirect", model: "GS30", catalogNumber: "GS31-10P2" };

const row = async () =>
  (
    await client.query(
      `SELECT manufacturer, model, catalog_number, identity_status, identity_source_type, identity_source_ref
         FROM equipment_notebooks WHERE id = $1`,
      [NB],
    )
  ).rows[0];

describe.skipIf(!URL)("adoptNameplateIdentity on real Postgres", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: URL });
    await client.connect();
    // The columns this statement reads and writes, typed as migrations 073 + 081 declare them.
    await client.query(`
      DROP TABLE IF EXISTS equipment_notebooks;
      CREATE TABLE equipment_notebooks (
        id UUID PRIMARY KEY, tenant_id UUID NOT NULL,
        manufacturer TEXT NULL, model TEXT NULL, catalog_number TEXT NULL,
        identity_status TEXT NOT NULL DEFAULT 'unknown'
          CHECK (identity_status IN ('unknown','candidate','user_confirmed','verified')),
        identity_source_type TEXT NULL
          CHECK (identity_source_type IS NULL
                 OR identity_source_type IN ('manual','nameplate_image','user','existing_asset')),
        identity_source_ref TEXT NULL,
        equipment_entity_id UUID NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await client.query("TRUNCATE equipment_notebooks");
    await client.query("INSERT INTO equipment_notebooks (id, tenant_id) VALUES ($1, $2)", [NB, T]);
  });

  it("a blank notebook adopts, and records which photo it came from", async () => {
    expect(await adoptNameplateIdentity(T, NB, PHOTO, GS10)).toBe(true);
    const r = await row();
    expect([r.manufacturer, r.model, r.catalog_number]).toEqual(["AutomationDirect", "GS10", "GS11N-10P2"]);
    expect(r.identity_status).toBe("user_confirmed");
    expect(r.identity_source_type).toBe("nameplate_image");
    expect(r.identity_source_ref).toMatch(new RegExp(`^nameplate:${PHOTO}:[0-9a-f]{32}$`));
  });

  it("F3: GS10 → GS20 → back to GS10 → GS30 — every correction of the same photo moves the identity", async () => {
    for (const id of [GS10, GS20, GS10, GS30]) {
      expect(await adoptNameplateIdentity(T, NB, PHOTO, id)).toBe(true);
      expect((await row()).model).toBe(id.model);
    }
  });

  it("F1: a re-confirm of the same identity keeps the photo's claim, so a later correction still applies", async () => {
    await adoptNameplateIdentity(T, NB, PHOTO, GS10);
    expect(await adoptNameplateIdentity(T, NB, PHOTO, GS10)).toBe(true); // same bytes, new client key
    expect(await adoptNameplateIdentity(T, NB, PHOTO, GS20)).toBe(true);
    expect((await row()).model).toBe("GS20");
  });

  it("control: a DIFFERENT photo never renames a notebook another photo named", async () => {
    await adoptNameplateIdentity(T, NB, PHOTO, GS10);
    expect(await adoptNameplateIdentity(T, NB, OTHER_PHOTO, GS20)).toBe(false);
    expect((await row()).model).toBe("GS10");
  });

  it("control: a manual edit since the adoption ends the photo's claim", async () => {
    await adoptNameplateIdentity(T, NB, PHOTO, GS10);
    // PATCH /equipment-notebooks/:id (updateNotebook) never touches identity_source_ref
    await client.query("UPDATE equipment_notebooks SET model = 'GS10-EDITED' WHERE id = $1", [NB]);
    expect(await adoptNameplateIdentity(T, NB, PHOTO, GS20)).toBe(false);
    expect((await row()).model).toBe("GS10-EDITED");
  });

  it("control: a notebook bound to an asset since the adoption is never renamed", async () => {
    await adoptNameplateIdentity(T, NB, PHOTO, GS10);
    await client.query("UPDATE equipment_notebooks SET equipment_entity_id = gen_random_uuid() WHERE id = $1", [NB]);
    expect(await adoptNameplateIdentity(T, NB, PHOTO, GS20)).toBe(false);
  });

  it("control: a notebook with its own (typed) identity is never adopted", async () => {
    await client.query(
      "UPDATE equipment_notebooks SET manufacturer = 'Nobody Inc', model = 'RIDE-1', identity_status = 'user_confirmed', identity_source_type = 'user' WHERE id = $1",
      [NB],
    );
    expect(await adoptNameplateIdentity(T, NB, PHOTO, GS10)).toBe(false);
    expect((await row()).model).toBe("RIDE-1");
  });

  it("whitespace in the confirmed fields does not break the photo's claim", async () => {
    await adoptNameplateIdentity(T, NB, PHOTO, { manufacturer: " AutomationDirect ", model: "GS10 ", catalogNumber: null });
    expect(await adoptNameplateIdentity(T, NB, PHOTO, GS20)).toBe(true);
  });
});
