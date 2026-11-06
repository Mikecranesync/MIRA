"use client";
import type { InstructionMetadata } from "@/capabilities/living-sheet/instruction-metadata";
import { correctionOrigin, fieldValueChanges, guidePacket } from "@/capabilities/living-sheet/instruction-fields";
import { measurementRows } from "./work-packet-v2-view";

/** Reuse the existing value-lineage helper, with provenance and authority kept
 * separate. This same table is visible on screen and in the print guide. */
export function LivingGuideMeasurements({ metadata, jobId }: { metadata: InstructionMetadata; jobId: string }) {
  const packet = guidePacket(metadata.packet);
  const rows = measurementRows(packet, null);
  const originalRows = measurementRows(guidePacket(metadata.originalPacket), null);
  const editKey = (entry: import("@/capabilities/work-packet/types").ReviewEntry) =>
    JSON.stringify([entry.path, entry.action, entry.by, entry.at, entry.previous, entry.next, entry.source]);
  return <section><h2>Torque / measurements</h2>
    <p style={{ breakAfter: "avoid" }}>Original values and correction sources are preserved claims. Current technician QC is recorded separately; reusable acceptance is not recorded.</p>
    <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }}>
      <thead><tr><th>Item</th><th>Original source value (imported claim)</th><th>Correction lineage</th><th>Review</th></tr></thead>
      <tbody>{rows.map(row => {
        const value = metadata.originalPacket.measurements[row.index]?.value;
        const originalValue = originalRows[row.index]?.manual.value ?? null;
        const currentValue = packet.measurements[row.index].value.value;
        const path = `measurements[${row.index}].value`;
        // The original packet also repairs presentation of older draft rows
        // whose buggy projection cleared history. Never invent a lost source.
        const importedChanges = fieldValueChanges(metadata.originalPacket, path);
        const importedKeys = new Set(importedChanges.map(({ entry }) => editKey(entry)));
        const changes = [
          ...importedChanges.map(change => ({ ...change, origin: "Imported correction claim" })),
          ...fieldValueChanges(packet, path).filter(({ entry }) => !importedKeys.has(editKey(entry)))
            .map(change => ({ ...change, origin: correctionOrigin(metadata, change.index, jobId) })),
        ];
        const hasCorrection = changes.length > 0 || currentValue !== originalValue;
        const last = changes[changes.length - 1];
        const unresolved = hasCorrection && (!last || last.entry.next !== currentValue);
        return <tr key={row.index} data-testid={`wp-measure-row-${row.index}`}>
          <td>{row.item}{row.steps.length > 0 && <p>Step {row.steps.join(", ")}</p>}</td>
          <td>{originalValue ?? "Unknown"}<p>Imported basis: {value?.basis ?? "not captured"}</p>{value?.source && <blockquote>{value.source.filename ?? value.source.docId}, p. {value.source.page}<br />“{value.source.line}”</blockquote>}</td>
          <td>{hasCorrection ? currentValue ?? "Unknown" : "No value correction recorded"}
            {unresolved && <p>Current value provenance is incomplete in this revision. Its correction source is unresolved.</p>}
            {changes.map(({ entry, origin }, i) => <div key={i}>
              <p><strong>{origin}</strong>: {typeof entry.previous === "string" ? entry.previous : "unknown"} → {typeof entry.next === "string" ? entry.next : "unknown"}<br />Reported by {entry.by} at {entry.at}</p>
              <p>Correction source: {entry.source ?? "not recorded — unresolved provenance"}</p>
            </div>)}
          </td>
          <td>{row.excluded ? "EXCLUDED — do not use this value." : "Draft — reusable acceptance not recorded."}</td>
        </tr>;
      })}</tbody>
    </table>
  </section>;
}
