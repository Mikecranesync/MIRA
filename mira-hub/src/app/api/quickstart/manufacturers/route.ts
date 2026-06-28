import { NextResponse } from "next/server";
import { withTenantContext } from "@/lib/tenant-context";
import { normalizeManufacturer } from "@/lib/manufacturerNormalize";

export const dynamic = "force-dynamic";

// /quickstart is a public no-auth page (ADR-0014, the "Twilio moment").
// We query KB chunks scoped to a designated public tenant. Production sets
// QUICKSTART_TENANT_ID via Doppler / docker-compose; if unset we fall back
// to the founder's tenant, which is where the seeded OEM corpus lives today.
const QUICKSTART_FALLBACK_TENANT_ID = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3";

function quickstartTenantId(): string {
  return process.env.QUICKSTART_TENANT_ID?.trim() || QUICKSTART_FALLBACK_TENANT_ID;
}

/**
 * GET /api/quickstart/manufacturers
 *
 * Returns the list of manufacturers present in knowledge_entries for the
 * quickstart tenant, ordered by chunk count descending. Lets the public
 * landing page populate its dropdown without exposing any private data.
 *
 * Response: { manufacturers: [{ name: string, count: number }, …] }
 */
export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ manufacturers: [] });
  }

  try {
    const rows = await withTenantContext(quickstartTenantId(), async (client) => {
      // Fetch a wide raw window (not LIMIT 50) so case/OCR variants of the same
      // vendor — "Siemens" + "siemens", "Allen-Bradley" + "Alien-Bradley" — are
      // all present to merge BEFORE we slice to the display top-N. Slicing first
      // would drop a low-count variant and leave the dup unmerged (#1893
      // dogfood #5 / #1895).
      const { rows } = await client.query<{ manufacturer: string; count: string }>(
        `SELECT manufacturer, COUNT(*)::text AS count
           FROM knowledge_entries
          WHERE manufacturer IS NOT NULL AND manufacturer <> ''
          GROUP BY manufacturer
          ORDER BY COUNT(*) DESC, manufacturer ASC
          LIMIT 500`,
      );
      return rows;
    });

    // Merge variants that resolve to the same canonical vendor, case-insensitively.
    // `normalizeManufacturer` collapses known OCR aliases; lowercasing the
    // canonical additionally folds pure case variants ("Siemens"/"siemens").
    // Long-form brand variants ("Rockwell" vs "Rockwell Automation", "Yaskawa"
    // vs "Yaskawa Electric Corporation") are NOT merged here — that needs
    // curated alias entries in the cross-service map (manufacturer-aliases.json
    // + the two Python mirrors), tracked as follow-up on #1895.
    const merged = new Map<string, { name: string; count: number; topVariant: number }>();
    for (const r of rows) {
      const count = Number(r.count) || 0;
      const canonical = normalizeManufacturer(r.manufacturer).canonical || r.manufacturer;
      const key = canonical.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        existing.count += count;
        // Display the casing of the highest-count variant.
        if (count > existing.topVariant) {
          existing.name = canonical;
          existing.topVariant = count;
        }
      } else {
        merged.set(key, { name: canonical, count, topVariant: count });
      }
    }

    const manufacturers = Array.from(merged.values())
      .map(({ name, count }) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 50);

    return NextResponse.json({ manufacturers });
  } catch (err) {
    // Public endpoint — never leak schema details. Empty list lets the page
    // still render a usable "type your symptom" form.
    console.error("[quickstart/manufacturers] failed:", err);
    return NextResponse.json({ manufacturers: [] });
  }
}
