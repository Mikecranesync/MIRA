// Anomaly→work-order prefill (master-plan T4). The MachineMemoryCard "Create
// work order" button deep-links here with ?prefill_title=&prefill_description=
// &source_run_diff_id=. Kept as a pure, unit-testable function (no DOM/RTL in
// this repo — same pattern as ../[id]/wo-photo-upload.ts) so the parsing logic
// is directly testable without rendering the full page.

export interface WorkOrderPrefill {
  title: string;
  description: string;
  sourceRunDiffId: string;
}

/** Anything with a `.get(name)` lookup — a URLSearchParams or Next's
 * ReadonlyURLSearchParams both satisfy this without importing next/navigation
 * types here. */
interface SearchParamsLike {
  get(name: string): string | null;
}

export function parseWorkOrderPrefill(searchParams: SearchParamsLike): WorkOrderPrefill {
  return {
    title: searchParams.get("prefill_title") ?? "",
    description: searchParams.get("prefill_description") ?? "",
    sourceRunDiffId: searchParams.get("source_run_diff_id") ?? "",
  };
}
