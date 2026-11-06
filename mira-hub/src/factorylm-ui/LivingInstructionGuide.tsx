"use client";
import type { Field, PacketFigure, WorkPacket } from "@/capabilities/work-packet/types";
import type { AssetMemoryProjection, AssetMemoryFact } from "@/capabilities/living-sheet/asset-memory";
import type { InstructionRecordV2 } from "@/capabilities/living-sheet/instruction-record-v2";
import { correctionOrigin, effectiveInstruction, fieldGuideHistory, guidePacket } from "@/capabilities/living-sheet/instruction-fields";
import { BlockersSection, CoverageStop, LeftOutAppendix } from "./WorkPacketV2Sections";
import { LivingGuideMeasurementFields, LivingGuideMeasurements } from "./LivingGuideMeasurements";
import { phasedSteps } from "./work-packet-v2-view";
import type { RenderField } from "./WorkPacketV2Sections";
import type { SheetView } from "@/capabilities/living-sheet/reduce";
import { packetHeaderRows } from "./work-packet-view";
import { PrintPortal, PRINT_PORTAL_CLASS, PRINT_PORTAL_CSS } from "./print-portal";

export const GUIDE_PRINT_CSS = `
.living-guide { overflow-wrap: anywhere; line-height: 1.45; font-size: 17px; color: var(--fl-text, #171717); background: var(--fl-surface, #fff); }
.living-guide section { margin-top: 16px; } .living-guide blockquote { margin: 6px 0 12px 12px; }
.living-guide th, .living-guide td { overflow-wrap: anywhere; }
.living-guide th, .living-guide td { text-align: left; vertical-align: top; padding: 6px; border-bottom: 1px solid var(--fl-line, #ccc); }
.living-guide img { max-width: 100%; height: auto; }
.living-guide .guide-print-only { display: none; }
@media print {
  body:has(.living-guide-print) .ls-print-root, body:has(.living-guide-print) .wp-print-root { display: none !important; }
  @page { size: A4 portrait; margin: 16mm 14mm; @bottom-center { content: "Draft guide · Page " counter(page) " of " counter(pages); } }
  .living-guide { font-size: 11pt; color: #000; background: #fff; --fl-text: #000; --fl-muted: #333; --fl-surface: #fff; --fl-fs-sm: 11pt; --fl-fs-xs: 10pt; }
  .living-guide [data-no-print] { display: none !important; }
  .living-guide .guide-print-only { display: block; }
  .living-guide thead { display: table-header-group; }
  .living-guide h2, .living-guide h3, .living-guide h4 { break-after: avoid; }
  .living-guide .guide-field-label { display: block; break-after: avoid; }
  .living-guide figure { break-inside: avoid; }
}
`;

function ImportedFigure({ figure, sourceIndex, renderField }: { figure: PacketFigure; sourceIndex: number; renderField: RenderField }) {
  return <figure data-guide-figure={sourceIndex} style={{ breakInside: "avoid", margin: "12px 0" }}>
    {figure.image ? <>
      {/* eslint-disable-next-line @next/next/no-img-element -- validated inline imported evidence */}
      <img src={figure.image} alt={figure.caption.join(" — ") || "Imported source image"} width={240} />
    </> : <p>Image could not be read — consult the original source.</p>}
    <figcaption>{figure.caption.join(" · ")} · Imported source image, p. {figure.page}, {figure.filename ?? figure.docId}</figcaption>
    {figure.placement && <><strong className="guide-field-label">Image placement (draft)</strong>{renderField(`figures[${sourceIndex}].placement`, figure.placement)}</>}
  </figure>;
}

/** Reuse the packet's exact phase/number/note/figure placement helpers. The
 * bounded adapter gives imported images neutral provenance: the legacy Figure
 * component hardcodes manufacturer attribution, which intake cannot establish. */
function GuideSteps({ packet, view, renderField, candidateView }: { packet: WorkPacket; view: SheetView; renderField: RenderField; candidateView: boolean }) {
  // Give each source array slot a distinct object before using the existing
  // placement helpers. Equal captions/values, or repeated input references,
  // must never collapse different figure decision paths.
  const figureIndices = new Map<PacketFigure, number>();
  const arranged = { ...packet, figures: (packet.figures ?? []).map((figure, index) => {
    const copy = { ...figure }; figureIndices.set(copy, index); return copy;
  }) };
  const renderFigure = (figure: PacketFigure) => {
    const sourceIndex = figureIndices.get(figure)!;
    return <ImportedFigure key={sourceIndex} figure={figure} sourceIndex={sourceIndex} renderField={renderField} />;
  };
  const groups = phasedSteps(arranged);
  const placed = new Set(groups.flatMap(group => group.steps.flatMap(step => step.figures)));
  // Preserve unmatched legacy sections too; source positions are never guessed.
  const loose = arranged.figures.filter(figure => !placed.has(figure));
  return <section><h2>Numbered procedure</h2><p>Read warnings before each step. Check source applicability and unresolved questions before doing the work.</p>
    {groups.map((group, gi) => <div key={gi}>{group.phase && <h3>{group.title}</h3>}
      {group.steps.map(s => {
        const step = packet.steps[s.index];
        const execution = view.steps.find(v => v.id === `packet-step-${s.index}`);
        // Rich steps must flow across pages instead of being pushed wholesale
        // and split anyway. The text budget is conservative and excludes image
        // bytes; only the short heading/action introduction stays together.
        const detailSize = JSON.stringify([step, s.figures.map(f => [f.caption, f.placement])]).length;
        const detailed = s.measurements.length > 0 || s.figures.length > 0 || detailSize > 1800;
        const longAction = JSON.stringify(step.text).length > 1200;
        const note = (i: number) => <aside key={i} style={{ borderLeft: "3px solid var(--fl-warn, #777)", paddingLeft: 12 }}><strong>{step.notes![i].kind}</strong>{renderField(`steps[${s.index}].notes[${i}].text`, step.notes![i].text)}{step.notes![i].applicability && renderField(`steps[${s.index}].notes[${i}].applicability`, step.notes![i].applicability!)}</aside>;
        return <div key={s.index} data-testid={`wp-step-${s.number}`} style={{ borderTop: "1px solid var(--fl-line, #ccc)", paddingTop: 8, marginTop: 12, breakInside: detailed ? "auto" : "avoid" }}>
          {s.notes.filter(i => step.notes![i].placement === "before").map(note)}
          <div style={{ breakInside: longAction ? "auto" : "avoid" }}>
            <h4>Step {s.number}{step.n !== undefined && step.n !== null ? ` · Source step ${step.n}` : ""}</h4><p style={{ breakAfter: "avoid" }}>{step.section}{step.subheading ? ` · ${step.subheading}` : ""}</p>
            {renderField(`steps[${s.index}].text`, step.text)}
          </div>
          {step.applicability && renderField(`steps[${s.index}].applicability`, step.applicability)}
          {step.inclusion && <><strong className="guide-field-label">Why this step is included (draft)</strong>{renderField(`steps[${s.index}].inclusion`, step.inclusion)}</>}
          {s.notes.filter(i => step.notes![i].placement !== "before").map(note)}
          {s.measurements.map(i => <LivingGuideMeasurementFields key={i} index={i} measurement={packet.measurements[i]} renderField={renderField} />)}
          {s.figures.map(renderFigure)}
          {candidateView ? <><p>Revised instruction: not marked performed. Candidate guide revisions do not inherit source-job execution marks.</p>
            {execution && <p>Original execution evidence: “{execution.text}” · source job {view.jobId.slice(0, 8)}, change {view.seq} · {execution.done ? `reported performed by ${execution.doneBy ?? "unknown"} at ${execution.doneAt}` : "not marked performed"}{execution.note ? ` · ${execution.note}` : ""}</p>}</> :
            <p>Current job execution: {execution ? execution.done ? `recorded performed by ${execution.doneBy ?? "unknown"} at ${execution.doneAt}` : "not marked performed" : "excluded from execution"}{execution?.note ? ` · ${execution.note}` : ""}</p>}
        </div>;
      })}
    </div>)}
    {loose.length > 0 && <section><h3>Source images not matched to one step</h3>{loose.map(renderFigure)}</section>}
    {packet.steps.length > 0 && (packet.figures?.length ?? 0) === 0 && <p>No images were captured in this packet. Consult the cited original source.</p>}
  </section>;
}

type GuideRecord = InstructionRecordV2 & { assetMemory?: AssetMemoryProjection };
const words = (v: unknown, fallback = "unknown"): string => typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : fallback;
const fieldsOf = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function ReadingSourceClaim({ source }: { source: unknown }) {
  const s = fieldsOf(source);
  return <span>Reported source: {s.kind === "manual" ? "manual citation claim" : s.kind === "tech" ? "technician observation" : "unknown"}{s.ref ? ` · ${words(s.ref)}` : " · reference unknown"}</span>;
}
/** Human summaries of the SAME server manifest. Operational packet provenance
 * stays beside its fields; opaque identifiers remain in the audit fold. */
function MemoryFact({ fact }: { fact: AssetMemoryFact }) {
  const d = fact.data;
  switch (fact.category) {
    case "job": { const finished = fieldsOf(d.finished); return d.finished ? <li>Job finish recorded by {words(finished.by)} at {words(finished.at)} · {words(finished.summary, "summary unknown")}.</li> : <li>Job finish is not recorded in this snapshot.</li>; }
    case "execution": return <li>{d.done ? "Recorded performed" : "Not marked performed"}: {words(d.originalText)} · {words(d.byLabel)} · {words(d.at)}. Revised candidate instructions do not inherit this completion.</li>;
    case "reading": {
      const r = fieldsOf(d.current); const history = Array.isArray(d.history) ? d.history : [];
      return <li>Reported {words(d.what)}: {words(r.value)} {words(r.unit, "")} · {words(r.by)} at {words(r.at)}. Technician report, separate from a source specification. <ReadingSourceClaim source={d.source} />
        {history.length > 0 && <ul>{history.map((entry, i) => { const h = fieldsOf(entry); return <li key={i}>{words(h.value)} {words(h.unit, "")} · {h.superseded ? "superseded report" : "current report"} · {words(h.by)} at {words(h.at)} · <ReadingSourceClaim source={h.source} /></li>; })}</ul>}
        {Number(d.historyOmitted) > 0 && <p>{words(d.historyOmitted)} intermediate reading reports omitted from this bounded summary.</p>}
      </li>;
    }
    case "note": return <li>Job note: {words(d.text)} · {words(d.by)} at {words(d.at)}</li>;
    case "question": return <li>Job question: {words(d.text ?? d.question)} · {d.resolved ? `resolved: ${words(d.resolution)} by ${words(d.resolvedBy)} at ${words(d.resolvedAt)}` : "unresolved"} · {words(d.by)} at {words(d.at)}</li>;
    case "performed_part": return <li>Reported part: {words(d.item)} · action {words(d.action)} · quantity {words(d.qty)} · {words(d.by)} at {words(d.at)}</li>;
    case "photo_reference": return <li>Saved photo reference: {words(d.caption, "caption not recorded")} · {words(d.byLabel)} at {words(d.at)}. Image ownership and review are not established.</li>;
    case "handover": return <li>Handover: {words(d.text ?? d.summary)} · {words(d.by)} at {words(d.at)}</li>;
    case "qc": return <li>Technician QC: {words(d.scope)} · user {words(d.userId)} at {words(d.at)}. Draft only; reusable acceptance is not recorded.</li>;
    case "imported_execution": return <li>Imported work report: {words(d.text, "step text not captured")} · reported performed by {words(d.by)} at {words(d.at)}. This does not mark the current job performed.</li>;
    case "imported_reading": return <li>Imported measured value: {words(d.value)} · reported by {words(d.by)} at {words(d.at)}. Separate from source specifications.</li>;
    case "imported_note": return <li>Imported {words(d.kind)}: {words(d.text)} · {d.resolved ? `reported resolved by ${words(d.resolvedBy)} at ${words(d.resolvedAt)}` : "unresolved"} · reported by {words(d.by)} at {words(d.at)}</li>;
    case "imported_photo_reference": return <li>Imported photo reference: {words(d.caption, "caption not recorded")} · reported by {words(d.by)} at {words(d.at)}. Image retained in the full record.</li>;
    case "graph_reference": return <li>{words(d.relation).replaceAll("_", " ")}: {words(d.name)} ({words(d.entityType).replaceAll("_", " ")}) · graph updated {words(d.updatedAt)}. {d.currentUnsPath ? `Dated graph address: ${words(d.currentUnsPath)}. ` : ""}Principal graph reference; edge review/version and installed component instance linkage are unknown.</li>;
    case "observations": {
      const cur = fieldsOf(d.current); const conflicts = Array.isArray(d.conflicting) ? d.conflicting : [];
      return <li>Reported {words(d.factKey).replaceAll("_", " ")}: <strong>{d.contested ? "CONTESTED technician reports" : words(d.state).replaceAll("_", " ")}</strong>. Latest report: {words(cur.factValue)} · reported by {words(cur.author)} · observed {words(cur.observedAt)} · recorded {words(cur.recordedAt)} · uncertainty {words(cur.uncertainty)} · self-reported verification method: {words(cur.verificationMethod)}.
        {conflicts.length > 0 && <ul>{conflicts.map((c, i) => { const x = fieldsOf(c); return <li key={i}>Conflicting report: {words(x.factValue)} · {words(x.author)} · observed {words(x.observedAt)} · recorded {words(x.recordedAt)} · uncertainty {words(x.uncertainty)} · self-reported verification method: {words(x.verificationMethod)}</li>; })}</ul>}
      </li>;
    }
    case "documents": { const requested = Array.isArray(d.requested) ? d.requested.length : 0; const admitted = Array.isArray(d.admitted) ? d.admitted.length : 0; const remaps = Object.keys(fieldsOf(d.remapped)).length; return <li>Current document admission: {words(d.admission).replaceAll("_", " ")} · {requested} requested, {admitted} admitted{remaps ? `, ${remaps} remapped` : ""}. Admission does not rewrite historical citations; source-byte hashes and revision equivalence remain unknown.</li>; }
    case "workOrder": { const r = fieldsOf(d.request); return <li>{d.request ? `Living Sheet work-order create request: ${words(r.state)} · requested ${words(r.requestedAt)} · updated ${words(r.updatedAt)}${r.externalRef ? ` · external reference ${words(r.externalRef)}` : ""}.` : "No Living Sheet work-order request recorded."} This reader does not establish other work orders, provider asset linkage, UNS delivery, repair or work-order completion.</li>; }
    default: return null;
  }
}
function AssetMemorySummary({ memory }: { memory?: AssetMemoryProjection }) {
  if (!memory) return null;
  const history = memory.facts.filter(f => f.period === "historical" && f.category !== "instruction_claim");
  const current = memory.facts.filter(f => f.period === "current" && f.category !== "graph_coverage");
  return <section data-testid="asset-memory-summary"><h2>Asset memory for this saved record</h2>
    <p>Historical job snapshot, change {memory.selector.seq}{memory.selector.candidate ? `, draft guide revision ${memory.selector.candidate.revision}` : ", source guide only"} · {memory.historical.finished ? "job finish recorded" : "job not recorded finished"}. Captured asset: {memory.historical.asset.name ?? memory.historical.asset.entityId}. {memory.historical.asset.capturedUnsPath && <>Captured UNS address: {memory.historical.asset.capturedUnsPath}.</>}</p>
    <p>Current context read {memory.capture.startedAt} to {memory.capture.finishedAt}. Binding: {memory.current.binding.replaceAll("_", " ")}. This dated overlay is separate from the historical job; it does not establish OEM approval, safety clearance or reusable acceptance.</p>
    {history.length > 0 && <><h3>Historical work and closeout</h3><ul>{history.map(f => <MemoryFact key={f.id} fact={f} />)}</ul></>}
    <h3>Dated current context</h3><p>Graph: {memory.current.graph}; observations: {memory.current.observations}; documents: {memory.current.documents}; Living Sheet create request: {memory.current.workOrder}.</p>
    <ul>{current.map(f => <MemoryFact key={f.id} fact={f} />)}</ul>
    <p>Bounded summary: {memory.coverage.included} of {memory.coverage.available} reader facts included; {memory.coverage.omitted} omitted, {memory.coverage.stringsClipped} strings shortened, {memory.coverage.detailsOmitted} nested details omitted. Graph producer limits and upstream omissions may be unknown. Complete historical evidence remains in the saved record.</p>
    <p><a href={memory.source.href}>{memory.source.label}</a> · change {memory.selector.seq}{memory.selector.candidate ? ` · draft revision ${memory.selector.candidate.revision}` : " · source-only"}</p>
    <details data-no-print><summary>Record reference and coverage audit</summary><p>Notebook {memory.historical.notebookId} · job {memory.historical.jobId}<br />Snapshot {memory.selector.snapshotId}<br />Candidate {memory.selector.candidate?.id ?? "explicit source-only"} · body hash {memory.selector.candidate?.hash ?? "not applicable"}<br />Projection {memory.contentHash}</p><ul>{memory.gaps.map(g => <li key={g}>{g.replaceAll("_", " ")}</li>)}</ul></details>
  </section>;
}

/** Pure props-to-guide renderer, shared by saved screen preview and browser PDF. */
export function LivingInstructionGuideContent({ record }: { record: GuideRecord }) {
  const metadata = record.sourceEvidence;
  if (!metadata) return <article className="living-guide" data-testid="living-instruction-guide"><style>{GUIDE_PRINT_CSS}</style><AssetMemorySummary memory={record.assetMemory} /><p>This job has no imported repair guide.</p></article>;
  const effective = effectiveInstruction(record)!;
  const original = effective.originalPacket;
  const packet = guidePacket(effective.packet);
  const qc = record.closeout?.body.instruction?.closeout;
  const imported = effective.originalRecord;
  const view = record.snapshot;
  const renderField = (path: string, f: Field) => {
    const changes = fieldGuideHistory(packet, f.copyOf ?? path);
    const latestValue = [...changes].reverse().find(change => change.entry.action !== "strike");
    const latestExclusion = f.struck ? [...changes].reverse().find(change => change.entry.action === "strike") : undefined;
    const visibleHistory = changes.filter(change => change === latestValue || change === latestExclusion);
    return <div key={path} data-guide-field={path} style={{ margin: "6px 0" }}>
    <span style={f.struck ? { textDecoration: "line-through" } : undefined}>{f.value ?? "Unknown — no answer recorded"}</span>
    {f.struck && <strong> — EXCLUDED. Do not use.</strong>}
    <div style={{ fontSize: "0.88em" }}>{f.label === "unknown" ? "Unknown" : "Draft statement"} · {f.basis}</div>
    {visibleHistory.map(change => {
      const excluded = change.entry.action === "strike";
      return <p key={change.index}>{correctionOrigin(effective, change.index, view.jobId).replace("correction", excluded ? "exclusion" : "correction")}: {excluded ? "retained" : "previous"} value {String(change.entry.previous ?? "unknown")} · reported by {change.entry.by} at {change.entry.at}{change.entry.source ? ` · ${excluded ? "decision" : "correction"} source: ${change.entry.source}` : excluded ? "" : " · correction source not recorded"}</p>;
    })}
    {f.source && <blockquote>Original imported citation: {f.source.filename ?? f.source.docId}, p. {f.source.page}<br />“{f.source.line}”</blockquote>}
  </div>;
  };
  const fields = (title: string, values: Field[], prefix: string) => values.length > 0 && <section><h3>{title}</h3>{values.map((f, i) => renderField(`${prefix}[${i}]`, f))}</section>;
  return <article className="living-guide" data-testid="living-instruction-guide">
    <style>{GUIDE_PRINT_CSS}</style>
    <h1>{packet.workOrder.title}</h1>
    <p><strong>DRAFT REPAIR GUIDE — reusable acceptance not recorded; safety clearance not granted.</strong></p>
    <p>{original.disclaimer}</p>
    <p>Job {view.jobId.slice(0, 8)} · Change {view.seq}{record.closeout ? ` · Candidate revision ${record.closeout.revision}` : ""}</p>
    <p data-no-print>Full job {view.jobId} · Notebook {record.lineage.notebookId}<br />Snapshot {record.snapshotId}</p>
    <p data-no-print>Server-captured machine: {metadata.imported.asset.name} · {metadata.imported.asset.entityId}<br />Captured UNS address: {metadata.imported.asset.unsPath}<br />
      Identity: {metadata.imported.identity.manufacturer ?? "unknown"} / {metadata.imported.identity.model ?? "unknown"} · Serial {metadata.imported.identity.serialNumber ?? "unknown"}<br />
      Imported by user {metadata.imported.userId} at {metadata.imported.at}</p>
    <div className="guide-print-only"><p><strong>Machine:</strong> {metadata.imported.asset.name} · {metadata.imported.identity.manufacturer ?? "unknown"} {metadata.imported.identity.model ?? "unknown"} · Serial {metadata.imported.identity.serialNumber ?? "unknown"}<br />
      <strong>Captured UNS address:</strong> {metadata.imported.asset.unsPath}<br />
      <strong>Work order:</strong> {original.workOrder.id} · Asset {original.workOrder.assetTag ?? "unknown"} · Site {original.workOrder.site ?? "unknown"}<br />
      <strong>Assignment:</strong> {original.workOrder.description}</p><p>Private draft. Share workplace data and images only with the data owner’s permission.{original.workOrder.synthetic ? " Synthetic work-order input." : ""}</p></div>
    <p data-no-print>Private work material. Benchmark exposure and exact question/answer linkage are unknown. This guide does not grant permission to publish workplace data or images.</p>
    <p>CMMS delivery is not established by this guide.</p>
    {original.version === 1 && <p><strong>Legacy packet version 1: known procedure/other-model coverage limitations. Rebuild and check the original manual before use.</strong></p>}
    <p data-no-print>Packet source matches, names, times, revision claims and figures below are imported evidence. They do not establish attached-document ownership or human approval. New execution marks come only from this saved job.</p>
    <p className="guide-print-only">Source matches, revision claims and images are imported evidence; they do not establish human approval. Execution marks below belong to this saved job.</p>
    <section><h2>Proposed packet identity claims</h2>
      <p>These imported or technician-entered claims do not change the captured identity or address. They do not confirm a different asset or establish CMMS delivery.</p>
      <strong className="guide-field-label">Manufacturer claim</strong>{renderField("equipment.manufacturer", packet.equipment.manufacturer)}
      <strong className="guide-field-label">Model claim</strong>{renderField("equipment.model", packet.equipment.model)}
      <strong className="guide-field-label">Serial claim</strong>{renderField("equipment.serial", packet.equipment.serial)}
    </section>
    <section data-no-print><h2>Job and assignment as imported</h2><dl>{packetHeaderRows(original).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      {original.workOrder.synthetic && <p>Synthetic work-order input.</p>}</section>
    <AssetMemorySummary memory={record.assetMemory} />
    <CoverageStop packet={packet} />
    <BlockersSection packet={packet} renderField={renderField} />
    {fields("Scope", packet.scope, "scope")}
    {fields("Safety notices", packet.safety.cautions, "safety.cautions")}
    {packet.safety.hazardFlags.length > 0 && <p>Imported hazard flags: {packet.safety.hazardFlags.join(", ")}</p>}
    <section><h3>Site isolation and lockout</h3>{renderField("safety.siteIsolation", packet.safety.siteIsolation)}</section>
    {(packet.jha?.length ?? 0) > 0 && <section><h3>Job hazard analysis (draft)</h3>
      <p>Site controls and isolation require site decisions. These proposed or imported claims do not grant safety clearance.</p>
      {packet.jha!.map((row, i) => <article key={i} data-testid={`wp-jha-row-${i}`}><h4>Hazard row {i + 1}</h4>
        <strong className="guide-field-label">Task / context</strong>{renderField(`jha[${i}].task`, row.task)}
        <strong className="guide-field-label">Hazard claim</strong>{renderField(`jha[${i}].hazard`, row.hazard)}
        <strong className="guide-field-label">Proposed site controls</strong>{renderField(`jha[${i}].controls`, row.controls)}
      </article>)}
    </section>}
    {packet.parts.length > 0 && <section><h3>Parts &amp; kits</h3>
      {packet.parts.map((part, i) => <article key={i} data-testid={`wp-part-row-${i}`}><h4>Part row {i + 1}{part.kit ? ` · ${part.kit} kit` : ""}</h4>
        <strong className="guide-field-label">Part number</strong>{renderField(`parts[${i}].partNumber`, part.partNumber)}
        <strong className="guide-field-label">Description</strong>{renderField(`parts[${i}].description`, part.description)}
        <strong className="guide-field-label">Quantity</strong>{renderField(`parts[${i}].qty`, part.qty)}
      </article>)}
    </section>}
    {fields("Tools", packet.tools, "tools")}
    <GuideSteps packet={packet} view={view} renderField={renderField} candidateView={record.closeout !== null} />
    {packet.measurements.length > 0 && <LivingGuideMeasurements metadata={effective} jobId={view.jobId} renderField={renderField} />}
    {fields("Qualifications", packet.qualifications ?? [], "qualifications")}
    {fields("Return-to-service questions", packet.restoration ?? [], "restoration")}
    {fields("Unknowns", packet.unknowns, "unknowns")}
    <LeftOutAppendix packet={packet} renderField={renderField} />
    <section><h2>Source documents and revision claims</h2>{packet.documents.map((d, i) => <div key={i}><p>{d.filename ?? d.docId} · {d.role} · {d.via} · model found on pages {d.modelFoundOn.join(", ") || "unknown"}</p>{renderField(`documents[${i}].revision`, d.revision)}</div>)}</section>
    <section><h2>Performing technician closeout QC</h2>
      {qc ? <><p>Recorded by authenticated user {qc.userId} at {qc.at}, against job {qc.jobId.slice(0, 8)}, change {qc.seq}. Candidate revision {record.closeout!.revision} remains DRAFT.</p>
        <p>{qc.decisions.filter(d => d.action === "confirm").length} fields checked as written; {qc.decisions.filter(d => d.action === "mark_unknown").length} kept unknown; {qc.decisions.filter(d => d.action === "settle").length} corrected; {qc.decisions.filter(d => d.action === "strike").length} excluded.</p>
        <div data-no-print>{qc.decisions.map((d, i) => <p key={i}>{d.path}: {d.action}{d.value !== undefined ? ` — ${d.value}` : ""}{d.source ? ` · correction source: ${d.source}` : ""}</p>)}</div>
        <div className="guide-print-only">{qc.decisions.filter(d => d.action === "settle" || d.action === "strike").map((d, i) => <p key={i}>{/^steps\[(\d+)\]\.text$/.test(d.path) ? `Step ${Number(d.path.match(/\d+/)![0]) + 1}` : "Guide correction"}: {d.action === "strike" ? "excluded" : d.value}{d.source ? ` · ${d.source}` : ""}</p>)}</div></> : <p>Not recorded for this job.</p>}
      {!qc && metadata.closeout && <p>Source-job QC lineage: {metadata.closeout.jobId}, change {metadata.closeout.seq}, by {metadata.closeout.userId} at {metadata.closeout.at}. This does not review the current job.</p>}
    </section>
    <p className="guide-print-only">Original packet edit history retained: {original.approval.technicianReview.entries.length} imported entries. Full audit remains available in the saved guide and versioned JSON export.</p>
    <section data-no-print><h2>Original imported edit history</h2><p>Historical client claims only. Imported supervisor state: {original.approval.supervisor.state}; by {original.approval.supervisor.by ?? "unknown"}; at {original.approval.supervisor.at ?? "unknown"}.</p>
      {original.approval.technicianReview.entries.map((e, i) => <p key={i}>{e.path}: {e.action}, {JSON.stringify(e.previous)} → {JSON.stringify(e.next)}; reported by {e.by} at {e.at}{e.source ? ` · ${e.source}` : ""}</p>)}</section>
    {imported && <section><h2>Imported/reported work evidence</h2><p>Local performed marks are historical evidence and never become marks for this job.</p>
      {Object.entries(imported.steps).map(([i, s]) => <p key={i}>Packet step {Number(i) + 1}: reported performed by {s.by} at {s.at}; recorded text {s.text ?? "not captured"}</p>)}
      {Object.entries(imported.measurements).map(([i, m]) => <p key={i}>Measurement {Number(i) + 1}: {m.value}, reported by {m.by} at {m.at}</p>)}
      {imported.notes.map((n, i) => <p key={i}>{n.kind}: {n.text}; step {n.stepIndex === null ? "job" : n.stepIndex + 1}; reported by {n.by} at {n.at}{n.resolved ? ` · reported resolved by ${n.resolvedBy ?? "unknown"} at ${n.resolvedAt ?? "unknown"}` : ""}</p>)}
      {imported.photos.map((p, i) => <figure key={i}>
        {/* eslint-disable-next-line @next/next/no-img-element -- validated inline evidence */}
        <img src={p.image} alt={p.caption || "Imported work photo"} width={240} />
        <figcaption>{p.caption} · reported by {p.by} at {p.at} · step {p.stepIndex === null ? "job" : p.stepIndex + 1}</figcaption>
      </figure>)}
    </section>}
    {(view.readings.length + view.notes.length + view.questions.length + view.parts.length + view.photos.length + view.handover.history.length > 0 || view.finished) && <section><h2>Saved job updates</h2>
      {view.readings.map(r => <div key={r.id}><h3>{r.what}</h3>{r.history.map((h, i) => <p key={i}>{h.superseded ? "Superseded: " : "Current: "}{h.value} {h.unit} · {h.by ?? "unknown"} · {h.at} · source {h.source?.ref ?? "technician-reported"}</p>)}</div>)}
      {view.notes.map(n => <p key={n.id}>{n.text} · {n.by ?? "unknown"} · {n.at}</p>)}
      {view.questions.map(q => <p key={q.id}>{q.text} · {q.resolved ? q.resolution : "open"} · {q.by ?? "unknown"} · {q.at}</p>)}
      {view.parts.map(p => <p key={p.id}>{p.action}: {p.item} · qty {p.qty ?? "unknown"} · {p.by ?? "unknown"} · {p.at}</p>)}
      {view.photos.map(p => <p key={p.id}>Saved photo {p.fileId}: {p.caption ?? "no caption"} · {p.by ?? "unknown"} · {p.at}</p>)}
      {view.handover.history.map((h, i) => <p key={i}>Handover: {h.text} · {h.by ?? "unknown"} · {h.at}</p>)}
      {view.finished && <p>Finished by {view.finished.by ?? "unknown"} at {view.finished.at}. {view.finished.summary}</p>}
    </section>}
  </article>;
}

export function LivingInstructionGuide({ record }: { record: GuideRecord }) {
  return <><LivingInstructionGuideContent record={record} /><PrintPortal><div className={`${PRINT_PORTAL_CLASS} living-guide-print`}><style>{PRINT_PORTAL_CSS}</style><LivingInstructionGuideContent record={record} /></div></PrintPortal></>;
}
