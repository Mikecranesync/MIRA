/**
 * Shared route gate for the observation endpoints: the server-side binding
 * check and the "table not migrated yet" mapping. Keeps the two route files
 * from carrying their own copies of the same refusal rules.
 */
import { NextResponse } from "next/server";
import type { ResolvedAsset } from "@/lib/equipment-notebooks";

export type ConfirmedAsset = { entityId: string; name: string; unsPath: string };

/** A machine the technician has confirmed. Anything else is refused: no binding,
 *  a binding that cannot be resolved, or a selection that was never confirmed. */
export function confirmedAssetOf(
  bound: ResolvedAsset,
): { ok: true; asset: ConfirmedAsset } | { ok: false; response: NextResponse } {
  if (bound.state === "resolved" && bound.confirmedAt) {
    return { ok: true, asset: { entityId: bound.entityId, name: bound.name, unsPath: bound.unsPath } };
  }
  if (bound.state === "resolved") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "asset_not_confirmed", message: "Confirm which machine this is before recording an observation." },
        { status: 409 },
      ),
    };
  }
  return {
    ok: false,
    response: NextResponse.json(
      { error: "asset_not_bound", message: "This notebook is not bound to a machine." },
      { status: 409 },
    ),
  };
}

/** The migration has not been applied to this database yet (Postgres 42P01).
 *  Flag on + table missing is 503, never a 500 and never a silent empty answer. */
export function observationsStorageUnavailable(err: unknown): NextResponse | null {
  if ((err as { code?: string } | null)?.code === "42P01") {
    return NextResponse.json({ error: "observations_unavailable" }, { status: 503 });
  }
  return null;
}
