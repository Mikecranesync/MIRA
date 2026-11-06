/** Read-only v1 representation of the SAME snapshot used by the sheet/print.
 * No legacy citation, template review or execution tick grants acceptance.
 * Not an import format, signature, safety clearance or second writable store.
 */
import { createHash } from "node:crypto";
import type { SheetView } from "./reduce";

type Source =
  | { kind: "legacy_citation"; text: string }
  | { kind: "sheet_event"; eventId: string; by: string | null; at: string };
type Verification = { state: "unreviewed"; reviews: [] };
export type InstructionFact = {
  id: string; label: string; value: string | number | null; unit: string | null;
  origin: "legacy_template" | "technician_observation";
  state: "unknown" | "proposed"; sources: Source[]; verification: Verification;
};
export type InstructionRecordV1 = {
  kind: "living_instruction_record"; schemaVersion: 1; status: "draft"; snapshotId: string;
  lineage: { notebookId: string; jobId: string; seq: number; templateRevisionId: string | null;
    legacyTemplateStatus: "draft" | "reviewed" | null };
  asset: { entityId: string; name: string | null; unsPath: { value: null; state: "unknown" } };
  facts: InstructionFact[];
  steps: { id: string; text: string; state: "proposed"; sources: Source[]; verification: Verification }[];
  review: { technicianCloseout: "not_recorded"; reusableAcceptance: "not_recorded"; safetyClearance: "not_granted" };
  gaps: string[];
  /** Complete reduced history; annotations above never replace original data. */
  snapshot: SheetView;
};

export function instructionRecord(notebookId: string, view: SheetView): InstructionRecordV1 {
  const snapshot = structuredClone(view);
  const citation = (text: string | null): Source[] => text ? [{ kind: "legacy_citation", text }] : [];
  const verification = (): Verification => ({ state: "unreviewed", reviews: [] });
  const fact = (id: string, label: string, value: string | number | null, unit: string | null,
    origin: InstructionFact["origin"], sources: Source[]): InstructionFact =>
    ({ id, label, value, unit, origin, sources, state: value === null ? "unknown" : "proposed", verification: verification() });
  // Object order can change on a JSONB round trip. Array order is meaningful.
  const canonical = JSON.stringify({ notebookId, snapshot }, (_key, value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
      : value);
  return {
    kind: "living_instruction_record", schemaVersion: 1, status: "draft",
    snapshotId: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    lineage: { notebookId, jobId: snapshot.jobId, seq: snapshot.seq,
      templateRevisionId: snapshot.templateRevisionId, legacyTemplateStatus: snapshot.templateStatus ?? null },
    // Historical job payload has no UNS path. Never infer it from today's binding.
    asset: { ...snapshot.machine, unsPath: { value: null, state: "unknown" } },
    facts: [
      fact("component", "Component", snapshot.template.component, null, "legacy_template", []),
      ...snapshot.template.items.map(i => fact(`item:${i.id}`, i.item, i.spec, null, "legacy_template", citation(i.source))),
      ...snapshot.template.torques.map(t => fact(`torque:${t.id}`, t.what, t.value, t.unit, "legacy_template", citation(t.source))),
      ...snapshot.readings.map(r => fact(`reading:${r.id}`, r.what, r.current.value, r.current.unit,
        "technician_observation", [{ kind: "sheet_event", eventId: r.current.eventId, by: r.current.by, at: r.current.at },
          ...citation(r.source?.ref ?? null)])),
    ],
    steps: snapshot.template.steps.map(s => ({ id: s.id, text: s.text, state: "proposed", sources: citation(s.source), verification: verification() })),
    review: { technicianCloseout: "not_recorded", reusableAcceptance: "not_recorded", safetyClearance: "not_granted" },
    gaps: ["historical_uns_path_not_recorded", "legacy_citations_unstructured",
      "per_fact_and_step_review_not_recorded", "technician_closeout_review_not_recorded",
      "reusable_acceptance_not_recorded", "work_packet_import_not_connected"],
    snapshot,
  };
}
