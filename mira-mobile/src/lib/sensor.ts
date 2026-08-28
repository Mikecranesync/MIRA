/**
 * Sensor v0 — pure vocabulary and helpers for the LOOK / READ / REPLAY
 * instrument (docs/prd/2026-08-28-sensor-v0-contract.md).
 *
 * Sensor is NOT a new app, store, or navigation universe: it is a transient
 * instrument opened from the notebook and every observation lands in the
 * notebook's existing conversation. This module is the DOM-free half so the
 * copy, the mode list, and the question-prefix contract can be pinned by unit
 * tests without rendering anything.
 *
 * Contract §2.6: identity upgrades the analysis; it is never a prerequisite.
 * Nothing here gates on an asset — REPLAY explains honestly when there is no
 * connected machine, and offers READ instead.
 */

import { nameplateErrorCopy, reasonFromRecognizeError } from "./nameplate-flow";

export type SensorMode = "look" | "read" | "replay";

/** Exactly three modes. LISTEN / VIBRATION are out of v0 (contract §6) and
 *  are deliberately absent — no disabled or "coming soon" rows. */
export const SENSOR_MODES: ReadonlyArray<{
  id: SensorMode;
  label: string;
  /** One honest sentence: what pressing it does with what exists today. */
  description: string;
}> = [
  {
    id: "look",
    label: "LOOK",
    description: "Photograph a component, panel, or display — MIRA describes what it sees.",
  },
  {
    id: "read",
    label: "READ",
    description: "Identify the machine from its FactoryLM QR sticker or a nameplate photo.",
  },
  {
    id: "replay",
    label: "REPLAY",
    description: "Replay what Machine Memory recorded around the last fault.",
  },
];

/** Wall-clock HH:MM:SS in the phone's local time — the technician's clock,
 *  the one on the panel HMI next to them. */
export function hhmmss(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const LOOK_DEFAULT_QUESTION = "What do you see and what should I check?";

/** Evidence-card title shared by the live LOOK card and the persisted turn
 *  card (contract §4.5): "Visual observation · Photo captured · HH:MM:SS". */
export function visualCardTitle(capturedAt: Date | string): string {
  return `Visual observation · Photo captured · ${hhmmss(capturedAt)}`;
}

/** LOOK links the photo in `workspace_file_links` (role "photo"), NOT in
 *  `equipment_notebook_sources` — so the honest word is "files", never
 *  "sources" (S5 D1). */
export const LOOK_SAVED_COPY = "Phone photo — saved to this notebook's files.";

// --- the Ask-MIRA hand-off (S5 cross-lane contract, D3) ----------------------

/** Sent as `body.visualEvidence`: which parked photo this question is about.
 *  The SERVER verifies the file is linked to THIS notebook and re-derives the
 *  evidence entry itself; the client never sends evidence rows. */
export interface VisualEvidence {
  fileId: string;
  capturedAt: string;
}

/** The persisted `{kind:"visual_observation"}` entry in a turn's evidence[]
 *  (D5 pattern). Never a citation; never part of sourceSnapshot. */
export interface VisualObservationEntry {
  kind: "visual_observation";
  fileId: string;
  capturedAt: string;
  provenance: string;
}

/** Pull the visual-observation entries out of evidence[] (a turn's persisted
 *  array or the live evidence frame). Anything else — citations ({docId}),
 *  machine evidence — is left to its own reader. */
export function visualObservationEntries(evidence: unknown): VisualObservationEntry[] {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .filter(
      (e): e is Record<string, unknown> =>
        typeof e === "object" &&
        e !== null &&
        (e as { kind?: unknown }).kind === "visual_observation" &&
        typeof (e as { fileId?: unknown }).fileId === "string" &&
        (e as { fileId: string }).fileId.length > 0,
    )
    .map((e) => ({
      kind: "visual_observation" as const,
      fileId: String(e.fileId),
      capturedAt: String(e.capturedAt ?? ""),
      provenance: String(e.provenance ?? "phone_photo"),
    }));
}

/**
 * The LOOK observation rides as conversation context (contract §4.1): a
 * prefixed question on the existing chat route, no new store. Format:
 *
 *   Visual observation (HH:MM:SS, phone photo): <observation>
 *   <blank line>
 *   <technician question | default>
 */
export function lookQuestion(
  observation: string,
  capturedAt: Date | string,
  technicianQuestion?: string | null,
): string {
  const q = (technicianQuestion ?? "").trim() || LOOK_DEFAULT_QUESTION;
  const obs = observation.trim().replace(/\s+/g, " ");
  return `Visual observation (${hhmmss(capturedAt)}, phone photo): ${obs}\n\n${q}`;
}

/**
 * LOOK intake failures: the SAME status→reason mapping the nameplate lane
 * uses (`reasonFromRecognizeError` — 415 / 413 / 503 / 502 / other), so a
 * format or size rejection never renders as "MIRA couldn't see anything". The
 * two nameplate-specific sentences are re-worded for LOOK; the shared ones
 * are reused verbatim from `nameplateErrorCopy`.
 */
export function lookErrorCopy(e: unknown): string {
  const reason = reasonFromRecognizeError(e);
  switch (reason) {
    case "unsupported_image_type":
    case "image_too_large":
    case "provider_error":
      return nameplateErrorCopy(reason);
    case "recognizer_unavailable":
      return "Photo description isn't available on the server right now";
    default:
      return "Couldn't upload the photo — check connectivity and try again";
  }
}

/** Contract §2.6: REPLAY without a bound machine is explained, never gated
 *  behind "select an asset". The sentence is pinned so it can never drift into
 *  a setup gate. */
export const REPLAY_NO_MACHINE =
  "No connected machine on this notebook — identify one with READ.";
