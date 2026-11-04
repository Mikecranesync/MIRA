"use client";
/**
 * Living Work Sheet — print-only view (TASK-S5). Renders `printModel`'s
 * output (living-sheet-print.ts, pure, already tested) for print ONLY:
 * portrait, black on white, >=11pt. Hidden on screen (`@media screen`);
 * visible only inside a browser print/PDF pass. A running header is pinned
 * via a table <thead>, which Chromium repeats on every printed page; `@page` adds a "Page N of M"
 * margin box where the browser's Paged Media support allows it (degrades
 * silently elsewhere — CSS Paged Media is advisory, not required).
 *
 * The print-isolation technique (hide everything else, show only this
 * root) is COPIED from WorkPacketPanel.tsx's PRINT_CSS — reimplemented
 * independently with its own class names (`ls-print-*`). WorkPacketPanel
 * itself is never imported or edited (it is a frozen, unrelated capability
 * — work-packet/**).
 *
 * `[data-testid="living-sheet-layer"]` and `[data-testid="shift-report-layer"]`
 * are the full-screen `position: fixed; overflow-y: auto` panels this
 * component is normally mounted inside (LivingSheet.tsx, LivingSheetShiftReport.tsx).
 * A fixed, scrolling ancestor would otherwise clip print output to one
 * viewport's worth of content, so this file's print CSS also forces those
 * two selectors back to a normal, unclipped flow during print — the same
 * problem WorkPacketPanel's CSS solves for its own `dialog[data-testid="wp-dialog"]`.
 */
import type { CSSProperties } from "react";
import { printModel, type PrintModel, type PrintSection } from "./living-sheet-print";
import type { SheetView } from "@/capabilities/living-sheet/reduce";
import { fileUrl } from "./to-interaction";
import { PRINT_PORTAL_CLASS, PRINT_PORTAL_CSS, PrintPortal } from "./print-portal";

export type LivingSheetPrintProps = {
  view: SheetView;
  seq: number;
  printedAt: string;
  machineName?: string;
  jobIdShort?: string;
  /** R2-17: entries queued locally (e.g. offline, or persistence still
   *  in-flight) that are NOT yet reflected in `view` — the server-derived
   *  snapshot this component renders. The caller (LivingSheet.tsx) counts
   *  them; this component only renders the warning. Default 0 keeps every
   *  existing caller byte-identical. */
  pendingCount?: number;
};

const PRINT_CSS = `
@page {
  size: portrait;
  margin: 0.9in 0.6in 0.6in 0.6in;
  /* "Page N of M" — CSS Paged Media is advisory; browsers without
     @bottom-right support simply omit it. Never required for a correct
     print, per the task's own "where the browser supports it" wording. */
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 9pt; color: #000; }
}
@media print {
  .ls-print-root { background: #fff; color: #000; }
  .ls-print-header { background: #fff; color: #000; border-bottom: 1px solid #000; padding: 4px 0 6px; }
  .ls-print-frame { width: 100%; border-collapse: collapse; }
  .ls-print-frame > thead { display: table-header-group; }
  .ls-print-frame td { padding: 0; vertical-align: top; }
}
${PRINT_PORTAL_CSS}`;

const S: Record<string, CSSProperties> = {
  root: { background: "#fff", color: "#000", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "11pt" },
  header: { fontSize: "11pt", fontWeight: 700 },
  section: { marginTop: "12pt" },
  sectionTitle: { fontSize: "12pt", fontWeight: 700, borderBottom: "1px solid #000", marginBottom: "4pt" },
  row: { fontSize: "11pt", marginBottom: "2pt" },
  box: { display: "inline-block", fontSize: "13pt", lineHeight: 1, marginInlineEnd: "6pt", verticalAlign: "middle" },
  struck: { textDecoration: "line-through", color: "#555" },
  photo: { width: "120pt", height: "120pt", objectFit: "cover", border: "1px solid #000", marginInlineEnd: "8pt" },
  footer: { marginTop: "16pt", fontSize: "11pt" },
  sigLine: { marginTop: "18pt", borderTop: "1px solid #000", width: "200pt", paddingTop: "2pt" },
};

const SECTION_TITLES: Record<PrintSection["kind"], string> = {
  banner: "",
  safety: "Safety",
  cautions: "Cautions",
  checks: "Return-to-service checks",
  templateNotes: "Template notes",
  bringToJob: "Bring to the job",
  steps: "Steps",
  readings: "Readings",
  notes: "Notes",
  questions: "Open questions",
  parts: "Parts used",
  torques: "Torques & settings",
  photos: "Photos",
  handover: "Handover",
};

function renderSection(section: PrintSection, index: number) {
  switch (section.kind) {
    case "banner":
      return (
        <p key={index} style={{ ...S.row, fontWeight: 700, border: "1px solid #000", padding: "4pt" }} data-testid="ls-print-draft-banner">
          {section.text}
        </p>
      );
    case "safety":
      return (
        <section key={index} style={S.section} data-testid="ls-print-safety">
          <div style={S.sectionTitle}>{SECTION_TITLES.safety}</div>
          <p style={S.row}>{section.text}</p>
        </section>
      );
    case "cautions":
      return (
        <section key={index} style={S.section} data-testid="ls-print-cautions">
          <div style={S.sectionTitle}>{SECTION_TITLES.cautions}</div>
          <p style={S.row}>{section.text}</p>
        </section>
      );
    case "checks":
      return (
        <section key={index} style={S.section} data-testid="ls-print-checks">
          <div style={S.sectionTitle}>{SECTION_TITLES.checks}</div>
          {section.items.map((item, i) => (
            <p key={i} style={S.row}>
              <span aria-hidden="true" style={S.box}>☐</span>
              {item}
            </p>
          ))}
        </section>
      );
    case "templateNotes":
      return (
        <section key={index} style={S.section} data-testid="ls-print-template-notes">
          <div style={S.sectionTitle}>{SECTION_TITLES.templateNotes}</div>
          <p style={S.row}>{section.text}</p>
        </section>
      );
    case "bringToJob":
      return (
        <section key={index} style={S.section} data-testid="ls-print-bring-to-job">
          <div style={S.sectionTitle}>{SECTION_TITLES.bringToJob}</div>
          {section.items.map((item) => (
            <p key={item.id} style={S.row}>
              {item.item}
              {item.spec ? ` — ${item.spec}` : ""}
              {item.qty !== null ? ` (qty ${item.qty})` : ""}
              {item.source ? ` — source: ${item.source}` : ""}
              {/* R2-13: a stored item annotation ("Only if bent.") is never dropped on print. */}
              {item.notes && <span style={{ color: "#555" }}> — {item.notes}</span>}
            </p>
          ))}
        </section>
      );
    case "steps":
      return (
        <section key={index} style={S.section} data-testid="ls-print-steps">
          <div style={S.sectionTitle}>{SECTION_TITLES.steps}</div>
          {section.items.map((step) => (
            <p key={step.id} style={S.row}>
              <span aria-hidden="true" style={S.box}>{step.done ? "☑" : "☐"}</span>
              {step.text}
              {/* R2-13: the step's source/drawing reference is never dropped on print. */}
              {step.source ? ` (ref: ${step.source})` : ""}
              {step.done ? ` — done by ${step.doneBy ?? "a technician"}, ${step.doneAt ? new Date(step.doneAt).toLocaleString() : ""}` : " — not done"}
              {/* R2-13: a note recorded against the step while it was worked is never dropped on print. */}
              {step.note && <span> — {step.note}</span>}
            </p>
          ))}
        </section>
      );
    case "readings":
      return (
        <section key={index} style={S.section} data-testid="ls-print-readings">
          <div style={S.sectionTitle}>{SECTION_TITLES.readings}</div>
          {section.items.map((reading) => (
            <p key={reading.id} style={S.row}>
              {reading.what}: {reading.current.value} {reading.current.unit}
              {" — "}
              {reading.current.by ?? "a technician"}, {new Date(reading.current.at).toLocaleString()}
              {reading.source ? ` (source: ${reading.source.kind}${reading.source.ref ? ` — ${reading.source.ref}` : ""})` : ""}
              {reading.history.filter((h) => h.superseded).map((h, i) => (
                <span key={i} style={S.struck}>
                  {" "}
                  ({h.value} {h.unit} — {h.by ?? "a technician"}, {new Date(h.at).toLocaleString()})
                </span>
              ))}
            </p>
          ))}
        </section>
      );
    case "notes":
      return (
        <section key={index} style={S.section} data-testid="ls-print-notes">
          <div style={S.sectionTitle}>{SECTION_TITLES.notes}</div>
          {section.items.map((note) => (
            <p key={note.id} style={S.row}>
              {note.text}
            </p>
          ))}
        </section>
      );
    case "questions":
      return (
        <section key={index} style={S.section} data-testid="ls-print-questions">
          <div style={S.sectionTitle}>{SECTION_TITLES.questions}</div>
          {section.items.length === 0 && <p style={S.row}>None recorded</p>}
          {section.items.map((q) => (
            <p key={q.id} style={S.row}>
              {q.text}
              {q.resolution ? ` — answered: ${q.resolution}` : " — open"}
            </p>
          ))}
        </section>
      );
    case "parts":
      return (
        <section key={index} style={S.section} data-testid="ls-print-parts">
          <div style={S.sectionTitle}>{SECTION_TITLES.parts}</div>
          {section.items.map((part) => (
            <p key={part.id} style={S.row}>
              {part.item} — {part.action}
              {part.qty !== null ? ` (qty ${part.qty})` : ""}
            </p>
          ))}
        </section>
      );
    case "torques":
      return (
        <section key={index} style={S.section} data-testid="ls-print-torques">
          <div style={S.sectionTitle}>{SECTION_TITLES.torques}</div>
          {section.items.map((t) => (
            <p key={t.id} style={S.row}>
              {t.what}: {t.value !== null ? `${t.value} ${t.unit ?? ""}` : "—"} ({t.sourceText})
              {t.pattern ? ` — pattern: ${t.pattern}` : ""}
              {t.threadLocker ? ` — thread-locker: ${t.threadLocker}` : ""}
              {t.tool ? ` — tool: ${t.tool}` : ""}
            </p>
          ))}
        </section>
      );
    case "photos":
      return (
        <section key={index} style={S.section} data-testid="ls-print-photos">
          <div style={S.sectionTitle}>{SECTION_TITLES.photos}</div>
          {section.items.map((photo) => (
            <div key={photo.id} style={{ marginBottom: "6pt" }}>
              <img src={fileUrl(photo.fileId)} alt={photo.caption ?? "job photo"} style={S.photo} />
              <div style={S.row}>
                {photo.caption ?? "no caption"} — {photo.by ?? "a technician"}, {new Date(photo.at).toLocaleString()}
              </div>
            </div>
          ))}
        </section>
      );
    case "handover":
      // F05: the technician's words are quoted VERBATIM — never rewritten or
      // stripped, even if they contain a word MIRA's own wording would never
      // use — with who wrote it and when attributed alongside.
      return (
        <section key={index} style={S.section} data-testid="ls-print-handover">
          <div style={S.sectionTitle}>{SECTION_TITLES.handover}</div>
          {section.current && (
            <p style={S.row}>
              &ldquo;{section.current.text}&rdquo; — {section.current.by ?? "a technician"},{" "}
              {new Date(section.current.at).toLocaleString()}
            </p>
          )}
          {section.history.filter((h) => h.eventId !== section.current?.eventId).map((h, i) => (
            <p key={i} style={{ ...S.row, ...S.struck }}>
              &ldquo;{h.text}&rdquo; — {h.by ?? "a technician"}, {new Date(h.at).toLocaleString()}
            </p>
          ))}
        </section>
      );
  }
}

export function LivingSheetPrint({ view, seq, printedAt, machineName, jobIdShort, pendingCount = 0 }: LivingSheetPrintProps) {
  const model: PrintModel = printModel(view, { printedAt, seq, machineName, jobIdShort });

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PrintPortal>
      <div className={`ls-print-root ${PRINT_PORTAL_CLASS}`} style={S.root} data-testid="living-sheet-print-root">
        <table className="ls-print-frame">
        <thead><tr><td>
        <div className="ls-print-header" style={S.header} data-testid="living-sheet-print-header">
          {model.header}
        </div>
        </td></tr></thead>
        <tbody><tr><td>
        <div className="ls-print-body" data-testid="living-sheet-print-body">
          {/* R2-17: this print renders `view`, a server-derived snapshot — any
             still-queued local entries are NOT in it. Say so on the page
             itself (never only on-screen), so a printed/PDF'd sheet is never
             silently incomplete. */}
          {pendingCount > 0 && (
            <p
              style={{ ...S.row, fontWeight: 700, border: "1px solid #000", padding: "4pt" }}
              data-testid="ls-print-pending-banner"
            >
              {pendingCount} changes made on this phone were not saved yet and are NOT on this print.
            </p>
          )}
          {model.sections.map((section, i) => renderSection(section, i))}
          <div style={S.footer} data-testid="ls-print-footer">
            <p style={S.row}>{model.footer.disclaimer}</p>
            {model.footer.signatureLines.map((line) => (
              <div key={line} style={S.sigLine}>
                {line}
              </div>
            ))}
          </div>
        </div>
        </td></tr></tbody>
        </table>
      </div>
      </PrintPortal>
    </>
  );
}
