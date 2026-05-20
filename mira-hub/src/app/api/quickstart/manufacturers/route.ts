import { NextResponse } from "next/server";
import { withTenantContext } from "@/lib/tenant-context";
import { DEMO_TENANT_ID } from "@/lib/demo-auth";

export const dynamic = "force-dynamic";

// /quickstart is a public no-auth page (ADR-0014, the "Twilio moment").
// We query KB chunks scoped to a designated public tenant. By default this
// is the demo tenant; production sets QUICKSTART_TENANT_ID to a dedicated
// "shared knowledge" tenant once the 83K-chunk corpus is mounted there.
function quickstartTenantId(): string {
  return process.env.QUICKSTART_TENANT_ID?.trim() || DEMO_TENANT_ID;
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
      const { rows } = await client.query<{ manufacturer: string; count: string }>(
        `SELECT manufacturer, COUNT(*)::text AS count
           FROM knowledge_entries
          WHERE manufacturer IS NOT NULL AND manufacturer <> ''
          GROUP BY manufacturer
          ORDER BY COUNT(*) DESC, manufacturer ASC
          LIMIT 50`,
      );
      return rows;
    });

    const manufacturers = rows.map((r) => ({
      name: r.manufacturer,
      count: Number(r.count) || 0,
    }));

    return NextResponse.json({ manufacturers });
  } catch (err) {
    // Public endpoint — never leak schema details. Empty list lets the page
    // still render a usable "type your symptom" form.
    console.error("[quickstart/manufacturers] failed:", err);
    return NextResponse.json({ manufacturers: [] });
  }
}
