"use client";
import type { Field, PacketFigure, WorkPacket } from "@/capabilities/work-packet/types";
import type { InstructionRecordV2 } from "@/capabilities/living-sheet/instruction-record-v2";
import { correctionOrigin, effectiveInstruction, fieldValueChanges, guidePacket } from "@/capabilities/living-sheet/instruction-fields";
import { BlockersSection, CoverageStop, JhaTable, LeftOutAppendix, PartsTable } from "./WorkPacketV2Sections";
import { LivingGuideMeasurements } from "./LivingGuideMeasurements";
import { phasedSteps, unplacedFigures } from "./work-packet-v2-view";
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
  .living-guide figure { break-inside: avoid; }
}
`;

function ImportedFigure({ figure }: { figure: PacketFigure }) {
  return <figure style={{ breakInside: "avoid", margin: "12px 0" }}>
    {figure.image ? <>
      {/* eslint-disable-next-line @next/next/no-img-element -- validated inline imported evidence */}
      <img src={figure.image} alt={figure.caption.join(" — ") || "Imported source image"} width={240} />
    </> : <p>Image could not be read — consult the original source.</p>}
    <figcaption>{figure.caption.join(" · ")} · Imported source image, p. {figure.page}, {figure.filename ?? figure.docId}</figcaption>
    {figure.placement && <p>Draft image placement: {figure.placement.basis}</p>}
  </figure>;
}

/** Reuse the packet's exact phase/number/note/figure placement helpers. The
 * bounded adapter gives imported images neutral provenance: the legacy Figure
 * component hardcodes manufacturer attribution, which intake cannot establish. */
function GuideSteps({ packet, view, renderField, candidateView }: { packet: WorkPacket; view: SheetView; renderField: RenderField; candidateView: boolean }) {
  return <section><h2>Numbered procedure</h2><p>Read warnings before each step. Check source applicability and unresolved questions before doing the work.</p>
    {phasedSteps(packet).map((group, gi) => <div key={gi}>{group.phase && <h3>{group.title}</h3>}{group.inclusion.map((f, i) => <p key={i}>{f.basis}</p>)}
      {group.steps.map(s => {
        const step = packet.steps[s.index];
        const execution = view.steps.find(v => v.id === `packet-step-${s.index}`);
        const note = (i: number) => <aside key={i} style={{ borderLeft: "3px solid var(--fl-warn, #777)", paddingLeft: 12 }}><strong>{step.notes![i].kind}</strong>{renderField(`steps[${s.index}].notes[${i}].text`, step.notes![i].text)}{step.notes![i].applicability && renderField(`steps[${s.index}].notes[${i}].applicability`, step.notes![i].applicability!)}</aside>;
        return <div key={s.index} data-testid={`wp-step-${s.number}`} style={{ borderTop: "1px solid var(--fl-line, #ccc)", paddingTop: 8, marginTop: 12, breakInside: "avoid" }}>
          {s.notes.filter(i => step.notes![i].placement === "before").map(note)}
          <h4>Step {s.number}{step.n !== undefined && step.n !== null ? ` · Source step ${step.n}` : ""}</h4><p>{step.section}{step.subheading ? ` · ${step.subheading}` : ""}</p>
          {renderField(`steps[${s.index}].text`, step.text)}{step.applicability && renderField(`steps[${s.index}].applicability`, step.applicability)}
          {s.notes.filter(i => step.notes![i].placement !== "before").map(note)}
          {s.measurements.map(i => <p key={i}>Measurement/specification: {packet.measurements[i].name.value ?? "unknown"} — see the sourced measurement table below.</p>)}
          {s.figures.map((figure, i) => <ImportedFigure key={i} figure={figure} />)}
          {candidateView ? <><p>Revised instruction: not marked performed. Candidate guide revisions do not inherit source-job execution marks.</p>
            {execution && <p>Original execution evidence: “{execution.text}” · source job {view.jobId.slice(0, 8)}, change {view.seq} · {execution.done ? `reported performed by ${execution.doneBy ?? "unknown"} at ${execution.doneAt}` : "not marked performed"}{execution.note ? ` · ${execution.note}` : ""}</p>}</> :
            <p>Current job execution: {execution ? execution.done ? `recorded performed by ${execution.doneBy ?? "unknown"} at ${execution.doneAt}` : "not marked performed" : "excluded from execution"}{execution?.note ? ` · ${execution.note}` : ""}</p>}
        </div>;
      })}
    </div>)}
    {unplacedFigures(packet).length > 0 && <section><h3>Source images not matched to one step</h3>{unplacedFigures(packet).map((figure, i) => <ImportedFigure key={i} figure={figure} />)}</section>}
    {packet.steps.length > 0 && (packet.figures?.length ?? 0) === 0 && <p>No images were captured in this packet. Consult the cited original source.</p>}
  </section>;
}

/** Pure props-to-guide renderer, shared by saved screen preview and browser PDF. */
export function LivingInstructionGuideContent({ record }: { record: InstructionRecordV2 }) {
  const metadata = record.sourceEvidence;
  if (!metadata) return <p>This job has no imported repair guide.</p>;
  const effective = effectiveInstruction(record)!;
  const original = effective.originalPacket;
  const packet = guidePacket(effective.packet);
  const qc = record.closeout?.body.instruction?.closeout;
  const imported = effective.originalRecord;
  const view = record.snapshot;
  const renderField = (path: string, f: Field) => {
    const changes = fieldValueChanges(packet, f.copyOf ?? path);
    const change = changes[changes.length - 1];
    return <div key={path} style={{ margin: "6px 0" }}>
    <span style={f.struck ? { textDecoration: "line-through" } : undefined}>{f.value ?? "Unknown — no answer recorded"}</span>
    {f.struck && <strong> — EXCLUDED. Do not use.</strong>}
    <div style={{ fontSize: "0.88em" }}>{f.label === "unknown" ? "Unknown" : "Draft statement"} · {f.basis}</div>
    {change && <p>{correctionOrigin(effective, change.index, view.jobId)}: previous value {String(change.entry.previous ?? "unknown")} · reported by {change.entry.by} at {change.entry.at}{change.entry.source ? ` · correction source: ${change.entry.source}` : " · correction source not recorded"}</p>}
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
    <p data-no-print>Server-captured machine: {metadata.imported.asset.name} · {metadata.imported.asset.entityId}<br />UNS: {metadata.imported.asset.unsPath}<br />
      Identity: {metadata.imported.identity.manufacturer ?? "unknown"} / {metadata.imported.identity.model ?? "unknown"} · Serial {metadata.imported.identity.serialNumber ?? "unknown"}<br />
      Imported by user {metadata.imported.userId} at {metadata.imported.at}</p>
    <div className="guide-print-only"><p><strong>Machine:</strong> {metadata.imported.asset.name} · {metadata.imported.identity.manufacturer ?? "unknown"} {metadata.imported.identity.model ?? "unknown"} · Serial {metadata.imported.identity.serialNumber ?? "unknown"}<br />
      <strong>UNS:</strong> {metadata.imported.asset.unsPath}<br />
      <strong>Work order:</strong> {original.workOrder.id} · Asset {original.workOrder.assetTag ?? "unknown"} · Site {original.workOrder.site ?? "unknown"}<br />
      <strong>Assignment:</strong> {original.workOrder.description}</p><p>Private draft. Share workplace data and images only with the data owner’s permission.{original.workOrder.synthetic ? " Synthetic work-order input." : ""}</p></div>
    <p data-no-print>Private work material. Benchmark exposure and exact question/answer linkage are unknown. This guide does not grant permission to publish workplace data or images.</p>
    {original.version === 1 && <p><strong>Legacy packet version 1: known procedure/other-model coverage limitations. Rebuild and check the original manual before use.</strong></p>}
    <p data-no-print>Packet source matches, names, times, revision claims and figures below are imported evidence. They do not establish attached-document ownership or human approval. New execution marks come only from this saved job.</p>
    <p className="guide-print-only">Source matches, revision claims and images are imported evidence; they do not establish human approval. Execution marks below belong to this saved job.</p>
    <section data-no-print><h2>Job and assignment as imported</h2><dl>{packetHeaderRows(original).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      {original.workOrder.synthetic && <p>Synthetic work-order input.</p>}</section>
    <CoverageStop packet={packet} />
    <BlockersSection packet={packet} renderField={renderField} />
    {fields("Scope", packet.scope, "scope")}
    {fields("Safety notices", packet.safety.cautions, "safety.cautions")}
    {packet.safety.hazardFlags.length > 0 && <p>Imported hazard flags: {packet.safety.hazardFlags.join(", ")}</p>}
    <section><h3>Site isolation and lockout</h3>{renderField("safety.siteIsolation", packet.safety.siteIsolation)}</section>
    {(packet.jha?.length ?? 0) > 0 && <JhaTable packet={packet} renderField={renderField} />}
    {packet.parts.length > 0 && <PartsTable packet={packet} renderField={renderField} />}
    {fields("Tools", packet.tools, "tools")}
    <GuideSteps packet={packet} view={view} renderField={renderField} candidateView={record.closeout !== null} />
    {packet.measurements.length > 0 && <LivingGuideMeasurements metadata={effective} jobId={view.jobId} />}
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

export function LivingInstructionGuide({ record }: { record: InstructionRecordV2 }) {
  return <><LivingInstructionGuideContent record={record} /><PrintPortal><div className={`${PRINT_PORTAL_CLASS} living-guide-print`}><style>{PRINT_PORTAL_CSS}</style><LivingInstructionGuideContent record={record} /></div></PrintPortal></>;
}
