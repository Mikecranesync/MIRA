/**
 * The shell's onboarding decision, for a technician who is already working.
 *
 * PRD §19.11: the same account and thread open on mobile, web and Hub. The phone
 * never gates on the setup wizard, but `/v3` did. On staging (2026-10-07) an
 * account with six notebooks, created through the app, was sent to
 * `/onboarding` at both 412 and 1440 px instead of its conversation. A tenant
 * that already has a notebook has work to resume, so the shell keeps it.
 *
 * Only a positive notebook count releases the redirect. A failed or malformed
 * notebook read keeps the existing `/feed`-equivalent decision unchanged.
 */
import { onboardingRedirect } from "./hub-host-logic";

type GetJson = (path: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function shellOnboardingRedirect(getJson: GetJson): Promise<"/onboarding" | null> {
  const to = await onboardingRedirect(getJson);
  if (!to) return null;
  try {
    const res = await getJson("/api/equipment-notebooks/");
    if (!res.ok) return to;
    const data = await res.json().catch(() => null);
    const notebooks = (data as { notebooks?: unknown } | null)?.notebooks;
    return Array.isArray(notebooks) && notebooks.length > 0 ? null : to;
  } catch {
    return to;
  }
}
