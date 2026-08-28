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

/** Contract §2.6: REPLAY without a bound machine is explained, never gated
 *  behind "select an asset". The sentence is pinned so it can never drift into
 *  a setup gate. */
export const REPLAY_NO_MACHINE =
  "No connected machine on this notebook — identify one with READ.";
