"use client";
/**
 * Work Packet V2 sections — the readiness summary, "Before you start" questions, tables for the
 * hazard analysis, parts and torque values, the phased numbered procedure and the left-out appendix.
 *
 * Presentation only. Arrangement comes from `./work-packet-v2-view` (pure, tested); every editable
 * value is rendered by the panel's own `FieldRow` through `renderField`, so the edit/quote/badge
 * behaviour is the same everywhere. Tables print as tables; their edit controls sit in a
 * screen-only "Correct this row" fold. `--fl-*` tokens only; every control is at least 44px tall.
 */
import type { CSSProperties, ReactNode } from "react";
import type { Field, PacketFigure, WorkPacket } from "@/capabilities/work-packet/types";
import type { JobRecord } from "@/capabilities/work-packet/job-record";
import { badgeText, sourceChipLabel } from "./work-packet-view";
import { measurementRows, phasedSteps, readinessSummary, unplacedFigures } from "./work-packet-v2-view";

export type RenderField = (path: string, field: Field) => ReactNode;

const S: Record<string, CSSProperties> = {
  section: { border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius-card, 10px)", padding: 14, marginTop: 12 },
  title: { fontSize: "var(--fl-fs-sm)", fontWeight: 600, margin: "0 0 8px 0" },
  phase: { fontSize: "var(--fl-fs-sm)", fontWeight: 700, margin: "14px 0 4px 0", breakAfter: "avoid" },
  muted: { color: "var(--fl-muted)", fontSize: "var(--fl-fs-xs)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "var(--fl-fs-sm)", marginTop: 6 },
  th: { textAlign: "left", borderBottom: "1px solid var(--fl-line-strong)", padding: "6px 4px", verticalAlign: "bottom", fontWeight: 600 },
  td: { borderBottom: "1px solid var(--fl-line)", padding: "6px 4px", verticalAlign: "top" },
  fold: { marginTop: 4 },
  foldSummary: {
    display: "flex", alignItems: "center", minHeight: 44, padding: "0 12px", cursor: "pointer",
    border: "1px solid var(--fl-line-strong)", borderRadius: "var(--fl-radius, 8px)", fontSize: "var(--fl-fs-sm)", width: "fit-content",
  },
  step: { borderTop: "1px solid var(--fl-line)", paddingTop: 8, marginTop: 8, breakInside: "avoid" },
  num: { display: "inline-block", minWidth: 28, fontWeight: 700 },
  note: { marginTop: 6, marginLeft: 12, padding: "6px 10px", borderLeft: "3px solid var(--fl-warn)", background: "var(--fl-warn-bg)" },
  torque: { marginTop: 6, marginLeft: 12, fontSize: "var(--fl-fs-sm)" },
  figure: { margin: "10px 0 0 12px", breakInside: "avoid" },
  figureImg: { display: "block", maxWidth: "100%", width: 240, height: "auto", border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius, 6px)" },
  review: { background: "var(--fl-warn-bg)", border: "1px solid var(--fl-warn)", borderRadius: "var(--fl-radius-sm, 6px)", padding: 12, fontSize: "var(--fl-fs-sm)" },
  draft: { background: "var(--fl-surface)", border: "1px solid var(--fl-line-strong)", borderRadius: "var(--fl-radius-sm, 6px)", padding: 12, fontSize: "var(--fl-fs-sm)" },
  stop: { background: "var(--fl-fault-bg)", border: "2px solid var(--fl-fault)", borderRadius: "var(--fl-radius-sm, 6px)", padding: 12, fontSize: "var(--fl-fs-sm)", marginTop: 0, marginBottom: 8, breakInside: "avoid" },
  blocker: { borderTop: "1px solid var(--fl-line)", paddingTop: 8, marginTop: 8 },
};

/** A value with its badge and page, for a table cell (screen and paper). */
function Cell({ field }: { field: Field }) {
  const chip = sourceChipLabel(field.source);
  return (
    <>
      <span style={field.struck ? { textDecoration: "line-through", color: "var(--fl-muted)" } : undefined}>{field.value ?? "(unknown)"}</span>
      <div style={S.muted}>{badgeText(field.label)}{chip ? ` · ${chip}` : ""}</div>
    </>
  );
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details style={S.fold} data-no-print>
      <summary style={S.foldSummary}>{label}</summary>
      {children}
    </details>
  );
}

function Figure({ f }: { f: PacketFigure }) {
  return (
    <figure style={S.figure} data-testid="wp-figure">
      {f.image
        ? // eslint-disable-next-line @next/next/no-img-element -- an inline data: URL photo; next/image cannot optimise it
          <img src={f.image} alt={f.caption.join(" — ") || `Manufacturer photo, p.${f.page}`} style={S.figureImg} />
        : <div style={S.muted}>Photo could not be read — see the manual.</div>}
      <figcaption style={S.muted}>{[...f.caption, `Manufacturer photo, p.${f.page} ${f.filename ?? "document"}`].join(" · ")}</figcaption>
      {/* Where it sits is matched by words, not stated by the manual (Codex EGM F33). */}
      {f.placement && <div style={S.muted} data-testid="wp-figure-placement">{badgeText(f.placement.label)}: placed next to this step by matching words — check it shows this step.</div>}
    </figure>
  );
}

/** N1: a packet built from part of the manual's procedure stops itself — the first thing on screen
 *  and on page 1 of the PDF. Says how much was read and which parts are missing, in plain words. */
export function CoverageStop({ packet }: { packet: WorkPacket }) {
  const c = packet.coverage;
  if (!c || c.complete) return null;
  const missing = c.sections.filter((s) => s.status !== "read");
  return (
    <section role="alert" style={{ ...S.section, ...S.stop }} data-testid="wp-coverage-stop">
      <strong>Not the whole job — do not work from this packet alone.</strong>
      <div style={{ marginTop: 4 }}>{c.summary}</div>
      <ul style={{ margin: "6px 0 0 0", padding: "0 0 0 18px" }}>
        {missing.map((s) => (
          <li key={s.heading}>
            {s.heading}: {s.status === "partly" ? `partly read (${s.stepsRead} read, at least ${s.stepsNotRead} not read)` : `not read (at least ${s.stepsNotRead} steps)`}
            {s.source ? ` — starts p.${s.source.page}` : ""}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 6 }}>Work from the manual itself for the missing parts. Nothing in this packet is marked Verified until the whole procedure can be read.</div>
    </section>
  );
}

/** What is still open, before anything else. Never says the equipment is safe or ready for service. */
export function ReadinessBlock({ packet }: { packet: WorkPacket }) {
  const r = readinessSummary(packet);
  return (
    <section style={{ ...S.section, ...(r.status === "needs_review" ? S.review : S.draft) }} data-testid="wp-readiness">
      <strong>{r.status === "needs_review" ? "Needs review before work starts." : "Draft — not approved for field use."}</strong>
      <ul style={{ margin: "6px 0 0 0", padding: "0 0 0 18px" }}>
        {r.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </section>
  );
}

/** Restrictions the documents state but cannot settle (style, date, application, bulletin). */
export function BlockersSection({ packet, renderField }: { packet: WorkPacket; renderField: RenderField }) {
  const blockers = packet.blockers ?? [];
  if (blockers.length === 0) return null;
  return (
    <section style={S.section} data-testid="wp-blockers">
      <h3 style={S.title}>Before you start — open questions</h3>
      <div style={S.muted}>The manual limits these lines to some pumps or uses, and the documents do not say whether yours is one. They are not guessed. A qualified person settles each one from the pump and the bulletin named.</div>
      {blockers.map((b, i) => <div key={i} style={S.blocker}>{renderField(`blockers[${i}]`, b)}</div>)}
    </section>
  );
}

export function JhaTable({ packet, renderField }: { packet: WorkPacket; renderField: RenderField }) {
  const rows = packet.jha ?? [];
  if (rows.length === 0) return null;
  return (
    <section style={S.section} data-testid="wp-jha">
      <h3 style={S.title}>Job hazard analysis</h3>
      <div style={S.muted}>Hazards are the manufacturer&apos;s cautions, quoted. Controls, PPE and isolation are set by your site.</div>
      <table style={S.table}>
        <thead><tr><th style={S.th}>#</th><th style={S.th}>Hazard (manufacturer)</th><th style={S.th}>Where</th><th style={S.th}>Controls (site)</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} data-testid={`wp-jha-row-${i}`}>
              <td style={S.td}>{i + 1}</td>
              <td style={S.td}><Cell field={r.hazard} /></td>
              <td style={S.td}><Cell field={r.task} /></td>
              <td style={S.td}>{r.controls.value ?? <span style={S.muted}>Set by your site</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.map((r, i) => (
        <Fold key={i} label={`Correct hazard row ${i + 1}`}>
          {renderField(`jha[${i}].hazard`, r.hazard)}
          {renderField(`jha[${i}].task`, r.task)}
          {renderField(`jha[${i}].controls`, r.controls)}
        </Fold>
      ))}
    </section>
  );
}

export function PartsTable({ packet, renderField }: { packet: WorkPacket; renderField: RenderField }) {
  return (
    <section style={S.section} data-testid="wp-parts">
      <h3 style={S.title}>Parts &amp; kits</h3>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Part number</th><th style={S.th}>Description</th><th style={S.th}>Qty</th><th style={S.th}>Kit</th></tr></thead>
        <tbody>
          {packet.parts.map((p, i) => (
            <tr key={i} data-testid={`wp-part-row-${i}`}>
              <td style={S.td}><Cell field={p.partNumber} /></td>
              <td style={S.td}><Cell field={p.description} /></td>
              <td style={S.td}><Cell field={p.qty} /></td>
              <td style={S.td}>{p.kit ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {packet.parts.map((p, i) => (
        <Fold key={i} label={`Correct part row ${i + 1}`}>
          {renderField(`parts[${i}].partNumber`, p.partNumber)}
          {renderField(`parts[${i}].description`, p.description)}
          {renderField(`parts[${i}].qty`, p.qty)}
        </Fold>
      ))}
    </section>
  );
}

/** Numbered steps in the order they are done, grouped removal / service / reinstall. Each step
 *  carries its notes, the figure that shows it and the torque value it uses. */
export function PhasedSteps({ packet, renderField, stepExtra }: { packet: WorkPacket; renderField: RenderField; stepExtra?: (index: number) => ReactNode }) {
  const loose = unplacedFigures(packet);
  const rows = measurementRows(packet, null);
  return (
    <section style={S.section} data-testid="wp-steps">
      <h3 style={S.title}>Procedure</h3>
      <div style={S.muted}>Do the steps in order. Each step is the manual&apos;s own line, cited. A warning about a step is shown above it, so it is read before the step is done; other notes are shown below their step.</div>
      {phasedSteps(packet).map((g, gi) => (
        <div key={gi} data-testid={`wp-phase-${g.phase ?? "all"}`}>
          {g.phase && <h4 style={S.phase}>{g.title}</h4>}
          {g.inclusion.map((f, k) => <div key={k} style={S.muted}>{badgeText(f.label)}: {f.basis}</div>)}
          {g.steps.map((s) => {
            const step = packet.steps[s.index];
            const note = (j: number) => (
              <div key={j} style={S.note} data-testid="wp-step-note">
                <strong>{(step.notes![j].kind || "NOTE").toUpperCase()}</strong>
                {renderField(`steps[${s.index}].notes[${j}].text`, step.notes![j].text)}
                {step.notes![j].applicability && renderField(`steps[${s.index}].notes[${j}].applicability`, step.notes![j].applicability!)}
              </div>
            );
            const before = s.notes.filter((j) => step.notes![j].placement === "before");
            return (
              <div key={s.index} style={S.step} data-testid={`wp-step-${s.number}`}>
                {before.map(note)}
                <span style={S.num}>{s.number}.</span>
                {renderField(`steps[${s.index}].text`, step.text)}
                {step.applicability && renderField(`steps[${s.index}].applicability`, step.applicability)}
                {s.notes.filter((j) => step.notes![j].placement !== "before").map(note)}
                {s.measurements.map((k) => {
                  // The manual's value, and a correction only as a pending one (Codex EGM F06).
                  const row = rows[k];
                  const fix = row.correction;
                  return (
                    <div key={k} style={S.torque} data-testid="wp-step-torque">
                      Torque: {row.item} — {row.manual.value ?? "unknown"} (manual){fix ? ` · correction ${fix.value ?? "marked unknown"} by ${fix.by}, ${row.approval.toLowerCase()}` : ""} (see the torque table)
                    </div>
                  );
                })}
                {s.figures.map((f, j) => <Figure key={j} f={f} />)}
                {stepExtra?.(s.index)}
              </div>
            );
          })}
        </div>
      ))}
      {loose.length > 0 && (
        <div data-testid="wp-loose-figures">
          <h4 style={S.phase}>Figures from the manual not matched to one step</h4>
          <div style={S.muted}>Shown by page. Match each to its step in the manual.</div>
          {loose.map((f, j) => <Figure key={j} f={f} />)}
        </div>
      )}
      {packet.steps.length > 0 && (packet.figures?.length ?? 0) === 0 && (
        <div style={{ ...S.muted, marginTop: 8 }}>Photos: open the cited manual page (this document was read as text only).</div>
      )}
    </section>
  );
}

/** Manual value, a technician's correction, approval and the measured value — four separate columns. */
export function MeasurementsTable({ packet, record, renderField, measureInput }: {
  packet: WorkPacket; record: JobRecord | null; renderField: RenderField; measureInput?: (index: number) => ReactNode;
}) {
  const rows = measurementRows(packet, record);
  return (
    <section style={S.section} data-testid="wp-measurements">
      <h3 style={S.title}>Torque / measurements</h3>
      <table style={S.table}>
        <thead>
          <tr><th style={S.th}>Item</th><th style={S.th}>Manual value</th><th style={S.th}>Proposed correction</th><th style={S.th}>Approval</th><th style={S.th}>Measured</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.index} data-testid={`wp-measure-row-${r.index}`}>
              <td style={S.td}>
                {r.item}
                {r.steps.length > 0 && <div style={S.muted}>Step {r.steps.join(", ")}</div>}
              </td>
              <td style={S.td}>
                {r.manual.value ?? "(unknown)"}
                <div style={S.muted}>{r.manual.label ? badgeText(r.manual.label) : "as built"}{sourceChipLabel(packet.measurements[r.index].value.source) ? ` · ${sourceChipLabel(packet.measurements[r.index].value.source)}` : ""}</div>
              </td>
              <td style={S.td}>{r.correction ? <>{r.correction.value ?? "(unknown)"}<div style={S.muted}>by {r.correction.by}, {r.correction.at.slice(0, 16).replace("T", " ")} UTC</div></> : <span style={S.muted}>none</span>}</td>
              <td style={S.td}>{r.approval}</td>
              <td style={S.td}>{r.measured ? <>{r.measured.value}<div style={S.muted}>by {r.measured.by}</div></> : <span style={S.muted}>not recorded</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.map((r) => (
        <Fold key={r.index} label={`Correct or record row ${r.index + 1}`}>
          {renderField(`measurements[${r.index}].name`, packet.measurements[r.index].name)}
          {renderField(`measurements[${r.index}].value`, packet.measurements[r.index].value)}
          {renderField(`measurements[${r.index}].tool`, packet.measurements[r.index].tool)}
          {measureInput?.(r.index)}
        </Fold>
      ))}
    </section>
  );
}

/** Manual content deliberately not in this packet — listed, never silently dropped. */
export function LeftOutAppendix({ packet, renderField }: { packet: WorkPacket; renderField: RenderField }) {
  const items = packet.leftOut ?? [];
  if (items.length === 0) return null;
  return (
    <section style={S.section} data-testid="wp-left-out">
      <h3 style={S.title}>Appendix — manual content left out of this packet ({items.length})</h3>
      <div style={S.muted}>Other models, steps outside this job, torque rows no step uses, and figures for other models. Each says why. If one applies to your pump, add it back by hand.</div>
      {items.map((f, i) => <div key={i}>{renderField(`leftOut[${i}]`, f)}</div>)}
    </section>
  );
}
