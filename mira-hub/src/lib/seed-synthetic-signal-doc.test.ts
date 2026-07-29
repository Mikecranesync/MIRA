import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: the synthetic seeder must seed VFD-07's live-signal fixtures AND a
 * citable customer document, so the dogfood judge's maintenance-tech,
 * demo-readiness, and contextualization paths report a REAL GREEN — not the
 * "empty-tenant YELLOW" they showed before.
 *
 * VFD-07 (EQUIPMENT[0], id …1001) is the asset every dogfood check picks
 * (Allen-Bradley/PowerFlex matches the preference regex). The checks read:
 *   - /api/assets/[id]/signals  → installed_component_instances (comps>=1) + live_signal_events
 *   - /api/assets/[id]/documents → knowledge_entries for the tenant (is_private=true)
 * If the seeder stops writing either, those paths silently fall back to YELLOW.
 *
 * Static (reads the seeder source) rather than a DB integration test — same
 * rationale as seed-synthetic-tenants-mirror.test.ts. vitest only runs src/**,
 * so the guard lives here and reads the script from ../../scripts/.
 */
describe("seed-synthetic-users signal + document fixtures (dogfood YELLOW→GREEN)", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../scripts/seed-synthetic-users.ts"),
    "utf8",
  );

  it("seeds installed components (the live-status panel needs cards to fill)", () => {
    expect(
      /INSERT INTO installed_component_instances\b/.test(src),
      "seeder must seed installed_component_instances for VFD-07 or " +
        "maintenance-tech + demo-readiness fall back to 'no live signal' YELLOW",
    ).toBe(true);
  });

  it("seeds live_signal_events so the latest reading is fresh, not frozen", () => {
    expect(/INSERT INTO live_signal_events\b/.test(src)).toBe(true);
    // delete-then-insert keeps the fixture recent every 4h reseed (and bounded).
    expect(
      /DELETE FROM live_signal_events[\s\S]*?simulated = true/.test(src),
      "signal history must be delete-then-insert (scoped to simulated=true) so " +
        "the panel shows a recent value and the table never grows unbounded",
    ).toBe(true);
  });

  it("seeds a customer document as a per-tenant private row (hybrid law)", () => {
    expect(/INSERT INTO knowledge_entries\b/.test(src)).toBe(true);
    // Must be is_private=true — a per-tenant upload, never the shared OEM corpus
    // (.claude/rules/knowledge-entries-tenant-scoping.md). Bare is_private (the
    // false default) would leak across tenants.
    expect(
      /is_private[\s\S]{0,40}true|,true,false,'text'/.test(src),
      "the customer doc must be inserted is_private=true per the knowledge_entries hybrid law",
    ).toBe(true);
  });

  it("keeps the customer doc citable — distinctive site detail the OEM manual lacks", () => {
    // The doc is only an HONEST green if MIRA can cite it, and it can only be
    // distinguished from the OEM manual by content the manual does not contain.
    // P042 (the site accel-ramp value) is that discriminator.
    expect(
      src.includes("P042"),
      "the seeded customer doc must carry a site-specific detail (P042 accel ramp) " +
        "so a grounded answer cites THIS doc, not the generic OEM manual",
    ).toBe(true);
  });

  it("writes every fixture to the synthetic tenant only (isolation probe safety)", () => {
    // Each new INSERT binds tenant_id = SYNTH_TENANT_ID; a stray tenant would
    // break the cross-tenant isolation probe that is currently green.
    for (const table of [
      "installed_component_instances",
      "live_signal_events",
      "knowledge_entries",
    ]) {
      const idx = src.indexOf(`INSERT INTO ${table}`);
      expect(idx, `${table} insert must exist`).toBeGreaterThan(-1);
    }
    // The fixtures block uses SYNTH_TENANT_ID as the tenant param throughout.
    expect(src.includes("SYNTH_TENANT_ID, VFD07_ASSET_ID")).toBe(true);
  });
});
