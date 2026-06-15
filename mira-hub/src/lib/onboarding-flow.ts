// mira-hub/src/lib/onboarding-flow.ts
// Pure decision logic for the onboarding upload->ask beta-gate flow (#1901).
// No React, no IO — unit-tested in isolation.

export interface UploadReadiness {
  status: string;
  knowledge_chunks_count: number;
}

/** A manual is "ready to cite" only once the ingest pipeline has parsed it
 *  AND produced retrievable KB chunks. Mirrors GET /api/uploads/[id]. */
export function isManualReady(row: UploadReadiness): boolean {
  return row.status === "parsed" && row.knowledge_chunks_count > 0;
}

/** A fresh tenant who has not completed the onboarding wizard should be sent
 *  into it. Anything other than "not_started"/"in_progress" is "stay put"
 *  (fail safe — never trap a user who has a namespace but a weird status). */
export function shouldRedirectToOnboarding(wizardStatus: string): boolean {
  return wizardStatus === "not_started" || wizardStatus === "in_progress";
}
