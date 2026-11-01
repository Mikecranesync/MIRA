"use client";
/**
 * Work Packet (#4982 section E) — the phone panel that turns a confirmed machine identity plus
 * its attached manufacturer documents into a DRAFT job packet: sourced parts, kits, tools, prep
 * steps, safety cautions, and torque/measurement values a technician can correct, mark unknown,
 * and export as PDF. Pattern = GuidedProcedure.tsx (pill → full-height <dialog> sheet, --fl-*
 * tokens only, no hex, min 44px targets, phone-first ≤412px, keyboard/aria).
 *
 * This is NOT a diagnostic system and it never fabricates a part number, torque value, tolerance,
 * or safety instruction — every "verified" field traces to a line in an attached document; every
 * "proposed" field says why; every gap is "unknown", never guessed. `buildDraftPacket` (agent C,
 * `@/capabilities/work-packet/draft`) and the route (agent D, `.../work-packet/route.ts`) own that
 * grounding — this panel only renders their output and applies the technician's own edits locally
 * via the pure `applyEdit` (agent C, `@/capabilities/work-packet/edits`).
 *
 * The panel checks availability (GET) on mount/notebook change and renders NOTHING — no pill, no
 * dialog — when the route 404s (`NOTEBOOK_WORK_PACKET` off) or the check otherwise fails; it never
 * guesses the flag is on from render-time state. See `GuidedProcedure.tsx`'s own header for why a
 * native <dialog> (focus trap, Escape, the shell's Back handler) instead of a custom modal.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { API_BASE } from "@/lib/config";
import type {
  DraftRefusal,
  DraftResult,
  EditAction,
  Field,
  PacketDocument,
  SourceRef,
  WorkOrderInput,
  WorkPacket,
  WorkPacketAvailability,
} from "@/capabilities/work-packet/types";
import { applyEdit } from "@/capabilities/work-packet/edits";
import {
  badgeText,
  cautionFieldPath,
  confirmedRevisionsPayload,
  confidencePercent,
  documentsSignature,
  measurementFieldPath,
  packetForNotebook,
  packetHeaderRows,
  partFieldPath,
  printTitle,
  scopeFieldPath,
  sourceChipLabel,
  stepFieldPath,
  syntheticDemoWorkOrder,
  toolFieldPath,
  unknownFieldPath,
} from "./work-packet-view";

// ───────────────────────────────────────────── styles ("--fl-*" tokens only, no hex — ui-style.md)

const S: Record<string, CSSProperties> = {
  // Offset below GuidedProcedure's pill (top 72px + its own ~44px height + a gap) so the two
  // pills never overlap on a phone-width screen (task §E: "place it so it never overlaps the
  // guided pill (offset below it)").
  pill: {
    position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 128px)", right: 12, zIndex: 40,
    background: "var(--fl-accent)", color: "var(--fl-surface)", border: "none",
    borderRadius: "var(--fl-radius-pill, 999px)", padding: "8px 14px", fontSize: "var(--fl-fs-sm)",
    minHeight: 44, cursor: "pointer",
  },
  dialog: {
    border: "none", padding: 0, margin: "0 auto", width: "100%", maxWidth: 640, height: "100%", maxHeight: "100%",
    background: "var(--fl-surface)", color: "var(--fl-ink)",
  },
  sheet: { height: "100%", overflowY: "auto", padding: "var(--fl-pad, 16px)", boxSizing: "border-box", fontFamily: "var(--fl-font)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  title: { fontSize: "var(--fl-fs)", fontWeight: 600, margin: 0 },
  muted: { color: "var(--fl-muted)", fontSize: "var(--fl-fs-xs)" },
  section: { border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius-card, 10px)", padding: 14, marginTop: 12 },
  sectionTitle: { fontSize: "var(--fl-fs-sm)", fontWeight: 600, margin: "0 0 8px 0" },
  warn: { background: "var(--fl-warn-bg)", border: "1px solid var(--fl-warn)", borderRadius: "var(--fl-radius-sm, 6px)", padding: 12, whiteSpace: "pre-wrap", fontSize: "var(--fl-fs-sm)" },
  fault: { background: "var(--fl-fault-bg)", border: "1px solid var(--fl-fault)", borderRadius: "var(--fl-radius-sm, 6px)", padding: 12, whiteSpace: "pre-wrap", fontSize: "var(--fl-fs-sm)" },
  ok: { background: "var(--fl-ok-bg)", border: "1px solid var(--fl-ok)", borderRadius: "var(--fl-radius-sm, 6px)", padding: 12, fontSize: "var(--fl-fs-sm)" },
  btn: {
    display: "inline-block", marginTop: 8, marginRight: 8, padding: "10px 12px", minHeight: 44,
    border: "1px solid var(--fl-line-strong)", borderRadius: "var(--fl-radius, 8px)", background: "var(--fl-surface)",
    color: "var(--fl-ink)", fontSize: "var(--fl-fs-sm)", cursor: "pointer",
  },
  btnBlock: { display: "block", width: "100%", textAlign: "left" as const },
  primary: { background: "var(--fl-accent)", color: "var(--fl-surface)", borderColor: "var(--fl-accent)" },
  input: { width: "100%", boxSizing: "border-box", padding: 10, minHeight: 44, border: "1px solid var(--fl-line-strong)", borderRadius: "var(--fl-radius-sm, 6px)", fontSize: "var(--fl-fs)", marginTop: 4 },
  label: { display: "block", marginTop: 10, fontSize: "var(--fl-fs-sm)" },
  field: { borderTop: "1px solid var(--fl-line)", padding: "10px 0" },
  chip: {
    display: "inline-block", marginTop: 6, padding: "4px 8px", minHeight: 0, border: "1px solid var(--fl-line-strong)",
    borderRadius: "var(--fl-radius-sm, 6px)", background: "var(--fl-surface)", color: "var(--fl-muted)",
    fontSize: "var(--fl-fs-xs)", cursor: "pointer",
  },
  struck: { textDecoration: "line-through", color: "var(--fl-muted)" },
  stamp: {
    display: "inline-block", border: "2px solid var(--fl-fault)", color: "var(--fl-fault)", borderRadius: "var(--fl-radius-sm, 6px)",
    padding: "4px 10px", fontWeight: 700, fontSize: "var(--fl-fs-sm)", transform: "rotate(-4deg)", marginBottom: 10,
  },
};

/** The three-state badge color — kept outside `S` because it varies by label, unlike every other
 *  entry in that table (TS can't type a record of mixed CSSProperties-and-function values the way
 *  a plain record of static styles types). */
function badgeStyle(label: Field["label"]): CSSProperties {
  const color = label === "verified" ? "var(--fl-ok)" : label === "proposed" ? "var(--fl-warn)" : "var(--fl-muted)";
  const bg = label === "verified" ? "var(--fl-ok-bg)" : label === "proposed" ? "var(--fl-warn-bg)" : "var(--fl-line)";
  return {
    display: "inline-block", padding: "2px 8px", borderRadius: "var(--fl-radius-sm, 6px)", fontSize: "var(--fl-fs-xs)",
    marginRight: 8, background: bg, color, border: `1px solid ${label === "unknown" ? "var(--fl-line-strong)" : color}`,
  };
}

/** Watermark + print-only visibility, confined to the packet root (task §E step 6: "prints ONLY
 *  the packet (portal root)"). `[data-no-print]` hides every edit/nav control on paper; nothing
 *  outside `.wp-print-root` is visible on paper. */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  .wp-print-root, .wp-print-root * { visibility: visible; }
  html, body { height: auto !important; overflow: visible !important; }
  /* The open packet lives in a full-height modal <dialog> whose sheet scrolls; on paper both must
     grow with the content or only the visible scroll window prints (one page). */
  dialog[data-testid="wp-dialog"] {
    position: absolute !important; inset: 0 auto auto 0 !important; margin: 0 !important;
    width: 100% !important; max-width: none !important; height: auto !important; max-height: none !important;
    overflow: visible !important;
  }
  .wp-print-root { position: static !important; height: auto !important; overflow: visible !important; }
  .wp-print-root [data-no-print] { display: none !important; }
  .wp-print-root .wp-print-only { display: block !important; }
  .wp-watermark { display: block !important; }
}
.wp-print-only { display: none; }
.wp-watermark {
  display: none;
  position: fixed; top: 35%; left: 8%; font-size: 90px; font-weight: 800;
  color: rgba(120, 120, 120, 0.18); transform: rotate(-28deg); pointer-events: none; z-index: 1000;
}
`;

const DRAFT_KEY = (notebookId: string) => `work-packet-draft:${notebookId}`;

function loadDraft(notebookId: string): WorkPacket | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY(notebookId));
    return raw ? (JSON.parse(raw) as WorkPacket) : null;
  } catch {
    return null;
  }
}
function saveDraft(notebookId: string, packet: WorkPacket): void {
  try {
    window.localStorage.setItem(DRAFT_KEY(notebookId), JSON.stringify(packet));
  } catch {
    // localStorage unavailable (private mode, quota, disabled) — the packet still renders from
    // in-memory state; it just won't survive a reload. Never throw over this.
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `wo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const REFUSAL_LABEL: Record<DraftRefusal, string> = {
  safety_stop: "Stopped",
  identity_not_confirmed: "Identity not confirmed",
  no_documents: "No documents attached",
  unsupported_documents: "Unsupported documents",
  model_not_in_documents: "Model not in documents",
  no_task_matched: "No matching task",
  revision_not_confirmed: "Revisions not confirmed",
};

type WOFields = { id: string; title: string; description: string; assetTag: string; site: string };
const EMPTY_WO: WOFields = { id: "", title: "", description: "", assetTag: "", site: "" };

/** One editable/citable field row, used for every section the task lists as editable (Scope,
 *  Parts & kits, Tools, Steps, Torque/measurements, Unknowns). Equipment and site isolation are
 *  rendered separately (read-only) — see their own call sites below. */
export function FieldRow({
  path, field, onEdit, onOpenSource, busy,
}: {
  path: string;
  field: Field;
  onEdit: (path: string, action: EditAction, value?: string) => void;
  onOpenSource?: (source: SourceRef) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value ?? "");
  const [expanded, setExpanded] = useState(false);
  const chip = sourceChipLabel(field.source);

  return (
    <div style={S.field} data-testid={`field-${path}`}>
      <span style={badgeStyle(field.label)}>{badgeText(field.label)}</span>
      <span style={field.struck ? S.struck : undefined}>{field.value ?? "(unknown)"}</span>
      {field.basis && <div style={S.muted}>{field.basis}</div>}
      {chip && (
        <button
          type="button"
          data-no-print
          style={S.chip}
          onClick={() => (onOpenSource ? onOpenSource(field.source!) : setExpanded((e) => !e))}
        >
          {chip}
        </button>
      )}
      {/* The chip is a button and is hidden on paper; the PDF still says where each line came from. */}
      {chip && <div className="wp-print-only" style={S.muted} data-testid="wp-print-source">Source: {chip}</div>}
      {chip && !onOpenSource && expanded && <div style={S.muted}>{field.source!.line}</div>}
      {editing ? (
        <div data-no-print>
          <input style={S.input} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" style={{ ...S.btn, ...S.primary }} disabled={busy} onClick={() => { onEdit(path, "set", draft); setEditing(false); }}>Save</button>
          <button type="button" style={S.btn} onClick={() => { setDraft(field.value ?? ""); setEditing(false); }}>Cancel</button>
        </div>
      ) : (
        <div data-no-print>
          <button type="button" style={S.btn} disabled={busy} onClick={() => setEditing(true)}>Correct</button>
          <button type="button" style={S.btn} disabled={busy} onClick={() => onEdit(path, "confirm")}>Confirm</button>
          <button type="button" style={S.btn} disabled={busy} onClick={() => onEdit(path, "strike")}>Strike</button>
          <button type="button" style={S.btn} disabled={busy} onClick={() => onEdit(path, "mark_unknown")}>Mark unknown</button>
        </div>
      )}
    </div>
  );
}

/** Which job and which machine this packet is for — on screen and on the PDF (Codex #5062 F6). */
export function PacketHeader({ packet }: { packet: Pick<WorkPacket, "workOrder" | "equipment"> }) {
  return (
    <section style={S.section} data-testid="wp-packet-header">
      {packetHeaderRows(packet).map((r) => (
        <div key={r.label}><strong>{r.label}:</strong> {r.value}</div>
      ))}
    </section>
  );
}

function documentLine(doc: PacketDocument): string {
  const role = doc.role === "datasheet" ? "data sheet" : doc.role === "service_manual" ? "service manual" : "other document";
  const name = doc.filename ?? doc.docId;
  const pages = doc.modelFoundOn.length > 0 ? `model found on p.${doc.modelFoundOn.join(", ")}` : "model not found on this document";
  // Drafts saved before the revision field existed have no `revision` — treat that as unknown.
  const rev = doc.revision?.value
    ? `${doc.revision.value} (p.${doc.revision.source?.page ?? "?"} footer)`
    : "revision unknown — check the revision printed on your copy";
  return `${name} (${role}) — ${pages} — ${rev}`;
}

export function WorkPacketPanel({
  notebookId,
  technicianName,
  onOpenSource,
}: {
  notebookId: string;
  /** Recorded as the `by` on every ReviewEntry (task §E step 5). Falls back to a generic label
   *  when the shell has no signed-in name to offer — the edit is still attributed, just not to a
   *  specific person. */
  technicianName?: string | null;
  /** Opens a source citation in the shell's own viewer when the shell exposes one; otherwise the
   *  chip expands to show the source line in place (task §E step 5). */
  onOpenSource?: (source: SourceRef) => void;
}) {
  const [avail, setAvail] = useState<WorkPacketAvailability | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const by = technicianName && technicianName.trim() ? technicianName.trim() : "technician (Hub panel)";

  const baseUrl = `${API_BASE}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/work-packet/`;
  // The notebook this panel is showing right now. A response that arrives after the technician
  // moved to another notebook is dropped, never shown under the new machine (Codex #5062 F4).
  const liveNotebook = useRef(notebookId);
  useEffect(() => {
    liveNotebook.current = notebookId;
  }, [notebookId]);

  const refreshAvailability = useCallback(async () => {
    try {
      const res = await fetch(baseUrl, { credentials: "include", headers: { accept: "application/json" } });
      if (liveNotebook.current !== notebookId) return;
      if (!res.ok) {
        setAvail(null);
        return;
      }
      const body = (await res.json()) as WorkPacketAvailability;
      if (liveNotebook.current !== notebookId) return;
      setAvail(body);
    } catch {
      setAvail(null);
    }
  }, [baseUrl, notebookId]);

  useEffect(() => {
    setAvail(null);
    setOpen(false);
    void refreshAvailability();
  }, [refreshAvailability]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // ── Equipment step state (nameplate photo OR typed manufacturer/model) ───────────────────────
  const [napBusy, setNapBusy] = useState(false);
  const [napError, setNapError] = useState<string | null>(null);
  const [napFileId, setNapFileId] = useState<string | null>(null);
  const [napConfidence, setNapConfidence] = useState<number | null>(null);
  const [napRawText, setNapRawText] = useState<string[]>([]);
  const [napIdentity, setNapIdentity] = useState({ manufacturer: "", model: "", catalogNumber: "", serialNumber: "" });
  const [napOutcome, setNapOutcome] = useState<string | null>(null);

  const [typedManufacturer, setTypedManufacturer] = useState("");
  const [typedModel, setTypedModel] = useState("");
  const [typedCatalogNumber, setTypedCatalogNumber] = useState("");
  const [typedBusy, setTypedBusy] = useState(false);
  const [typedOutcome, setTypedOutcome] = useState<string | null>(null);

  const onNameplatePhoto = useCallback(async (file: File) => {
    setNapBusy(true);
    setNapError(null);
    setNapOutcome(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/nameplate/recognize/`, {
        method: "POST", credentials: "include", body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        fileId?: string; confidence?: number | null;
        candidate?: { manufacturer?: string | null; model?: string | null; catalogNumber?: string | null; serialNumber?: string | null };
        rawObservation?: { rawText?: string[] };
        message?: string;
      };
      if (!res.ok || !data.fileId) {
        setNapError(data.message ?? "Could not read the nameplate.");
        return;
      }
      setNapFileId(data.fileId);
      setNapConfidence(data.confidence ?? null);
      setNapRawText(data.rawObservation?.rawText ?? []);
      setNapIdentity({
        manufacturer: data.candidate?.manufacturer ?? "",
        model: data.candidate?.model ?? "",
        catalogNumber: data.candidate?.catalogNumber ?? "",
        serialNumber: data.candidate?.serialNumber ?? "",
      });
    } catch {
      setNapError("No connection. Try the photo again when you're back online.");
    } finally {
      setNapBusy(false);
    }
  }, [notebookId]);

  const onConfirmNameplate = useCallback(async () => {
    if (!napFileId) return;
    setNapBusy(true);
    setNapError(null);
    try {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/nameplate/confirm/`, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ fileId: napFileId, identity: napIdentity, confidence: napConfidence }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      // The manual-acquisition outcome is shown verbatim (task §E step 1) — never reworded.
      setNapOutcome(data.message ?? (data.ok ? "Confirmed." : "Could not confirm the nameplate."));
      if (data.ok) {
        setNapFileId(null);
        await refreshAvailability();
      }
    } catch {
      setNapError("No connection. Your nameplate photo is saved; try confirming again when you're back online.");
    } finally {
      setNapBusy(false);
    }
  }, [notebookId, napFileId, napIdentity, napConfidence, refreshAvailability]);

  const onConfirmTyped = useCallback(async () => {
    if (!typedManufacturer.trim() || !typedModel.trim()) return;
    setTypedBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/identity/confirm/`, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ manufacturer: typedManufacturer.trim(), model: typedModel.trim(), catalogNumber: typedCatalogNumber.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean; message?: string; error?: string; manufacturer?: string; model?: string;
      };
      if (res.status === 409 && data.error === "identity_already_confirmed") {
        setTypedOutcome(`This machine is already confirmed as ${data.manufacturer ?? "?"} ${data.model ?? "?"}.`);
      } else {
        // Shown verbatim, same as the nameplate path (task §E step 1).
        setTypedOutcome(data.message ?? (data.ok ? "Confirmed." : "Could not confirm the identity."));
      }
      if (data.ok) await refreshAvailability();
    } catch {
      setTypedOutcome("No connection. Try again when you're back online.");
    } finally {
      setTypedBusy(false);
    }
  }, [notebookId, typedManufacturer, typedModel, typedCatalogNumber, refreshAvailability]);

  // ── Work order step state ─────────────────────────────────────────────────────────────────────
  const [wo, setWo] = useState<WOFields>(EMPTY_WO);
  const [synthetic, setSynthetic] = useState(false);
  // The technician confirms the machine AND the manual revisions before a draft can be built.
  const [revConfirmed, setRevConfirmed] = useState(false);
  // A changed document list or revision voids an earlier "matches my paper copy" tick (Codex #5062 F5).
  const docsSig = documentsSignature(avail?.documents ?? []);
  useEffect(() => setRevConfirmed(false), [notebookId, docsSig]);

  const loadSyntheticDemo = useCallback(() => {
    const demo = syntheticDemoWorkOrder(newId());
    setWo({ id: demo.id, title: demo.title, description: demo.description, assetTag: demo.assetTag ?? "", site: demo.site ?? "" });
    setSynthetic(true);
  }, []);

  // ── Build draft packet ────────────────────────────────────────────────────────────────────────
  const [packet, setPacket] = useState<WorkPacket | null>(() => packetForNotebook(loadDraft(notebookId), notebookId));
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<{ reason: DraftRefusal; message: string } | null>(null);
  const [buildBusy, setBuildBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);

  useEffect(() => {
    setPacket(packetForNotebook(loadDraft(notebookId), notebookId));
  }, [notebookId]);

  const onBuild = useCallback(async () => {
    const id = wo.id.trim() || newId();
    const workOrder: WorkOrderInput = {
      id,
      title: wo.title.trim(),
      description: wo.description.trim(),
      assetTag: wo.assetTag.trim() || null,
      site: wo.site.trim() || null,
      synthetic,
    };
    setBuildBusy(true);
    setRefusal(null);
    setError(null);
    try {
      const res = await fetch(baseUrl, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          workOrder,
          confirmedRevisions: confirmedRevisionsPayload(revConfirmed, avail?.documents ?? []),
        }),
      });
      const data = (await res.json().catch(() => null)) as DraftResult | null;
      if (!data) {
        setError("No connection. Nothing was built — try again.");
        return;
      }
      if (!data.ok) {
        // Refusals are shown as the message (task §E step 4) — the server already wrote the
        // right text for safety_stop (served bare, no hazard banner — D5, #4372).
        setRefusal({ reason: data.reason, message: data.message });
        return;
      }
      if (liveNotebook.current !== notebookId || data.packet.notebookId !== notebookId) return;
      setPacket(data.packet);
      setWarnings(data.warnings);
      saveDraft(notebookId, data.packet);
    } catch {
      setError("No connection. Nothing was built — try again.");
    } finally {
      setBuildBusy(false);
    }
  }, [baseUrl, notebookId, wo, synthetic, revConfirmed, avail]);

  const onEditField = useCallback((path: string, action: EditAction, value?: string) => {
    setPacket((p) => {
      if (!p) return p;
      setEditBusy(true);
      try {
        const next = applyEdit(p, { path, action, value }, by, new Date().toISOString());
        saveDraft(notebookId, next);
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : "That edit could not be applied.");
        return p;
      } finally {
        setEditBusy(false);
      }
    });
  }, [notebookId, by]);

  // ── Export PDF ────────────────────────────────────────────────────────────────────────────────
  const onExport = useCallback(() => {
    if (!packet) return;
    const prior = document.title;
    document.title = printTitle(packet);
    window.print();
    document.title = prior;
  }, [packet]);

  const identity = avail?.identity;
  const identityConfirmed = identity?.status === "user_confirmed" || identity?.status === "verified";
  const blocked = avail?.blocking ?? null;

  const pillLabel = packet ? "Resume job packet" : "Prepare job";

  if (avail === null) return null; // not enabled (404), or the check hasn't resolved yet.

  return (
    <>
      <style data-testid="work-packet-print-css">{PRINT_CSS}</style>
      <button type="button" ref={openerRef} data-testid="wp-open" style={S.pill} onClick={() => { setOpen(true); void refreshAvailability(); }}>{pillLabel}</button>
      <dialog
        ref={dialogRef}
        style={S.dialog}
        aria-label="Prepare job packet"
        data-testid="wp-dialog"
        onClose={() => { setOpen(false); openerRef.current?.focus(); }}
      >
        {open && (
          <div className="wp-print-root" style={S.sheet} data-testid="wp-sheet">
            <div className="wp-watermark" aria-hidden="true">DRAFT</div>
            <div style={S.head} data-no-print>
              <h2 style={S.title}>Prepare job packet</h2>
              <button type="button" data-testid="wp-close" style={{ ...S.btn, width: "auto" }} onClick={() => setOpen(false)}>Close</button>
            </div>

            {/* ── (1) Equipment ──────────────────────────────────────────────────────────── */}
            <section style={S.section} data-testid="wp-equipment">
              <h3 style={S.sectionTitle}>Equipment</h3>
              <div>
                {identity?.manufacturer ?? "Unknown manufacturer"} {identity?.model ?? "unknown model"}
                {identity?.serialNumber ? ` · S/N ${identity.serialNumber}` : ""}
              </div>
              <div style={S.muted} data-testid="wp-identity-status">{identityConfirmed ? `Confirmed (${identity?.status})` : "Not yet confirmed"}</div>

              {!identityConfirmed && (
                <div data-no-print>
                  <label style={S.label}>
                    Photograph the nameplate
                    <input
                      type="file" accept="image/*" capture="environment" style={S.input}
                      data-testid="wp-nameplate-input"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void onNameplatePhoto(f); }}
                    />
                  </label>
                  {napBusy && <div style={S.muted}>Reading the nameplate…</div>}
                  {napError && <div role="alert" style={{ ...S.fault, marginTop: 8 }} data-testid="wp-nameplate-error">{napError}</div>}
                  {napFileId && (
                    <div style={S.section} data-testid="wp-nameplate-review">
                      <div style={S.warn}>Unconfirmed — check against the plate</div>
                      <div style={S.muted}>Confidence: {confidencePercent(napConfidence)}</div>
                      {(["manufacturer", "model", "catalogNumber", "serialNumber"] as const).map((f) => (
                        <label key={f} style={S.label}>
                          {f}
                          <input
                            style={S.input} value={napIdentity[f]}
                            onChange={(e) => setNapIdentity((cur) => ({ ...cur, [f]: e.target.value }))}
                          />
                        </label>
                      ))}
                      {napRawText.length > 0 && (
                        <details style={{ marginTop: 8 }}>
                          <summary style={S.muted}>Raw text read from the plate ({napRawText.length})</summary>
                          <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: "var(--fl-fs-xs)" }}>
                            {napRawText.map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        </details>
                      )}
                      <button type="button" style={{ ...S.btn, ...S.primary }} disabled={napBusy} onClick={() => void onConfirmNameplate()}>Confirm nameplate</button>
                    </div>
                  )}
                  {napOutcome && <div style={{ ...S.ok, marginTop: 8 }} data-testid="wp-nameplate-outcome">{napOutcome}</div>}

                  <div style={{ ...S.muted, marginTop: 12 }}>— or —</div>
                  <label style={S.label}>
                    Manufacturer
                    <input style={S.input} value={typedManufacturer} onChange={(e) => setTypedManufacturer(e.target.value)} data-testid="wp-typed-manufacturer" />
                  </label>
                  <label style={S.label}>
                    Model
                    <input style={S.input} value={typedModel} onChange={(e) => setTypedModel(e.target.value)} data-testid="wp-typed-model" />
                  </label>
                  <label style={S.label}>
                    Catalog number (optional)
                    <input style={S.input} value={typedCatalogNumber} onChange={(e) => setTypedCatalogNumber(e.target.value)} />
                  </label>
                  <button
                    type="button" style={{ ...S.btn, ...S.primary }} data-testid="wp-typed-confirm"
                    disabled={typedBusy || !typedManufacturer.trim() || !typedModel.trim()}
                    onClick={() => void onConfirmTyped()}
                  >
                    Confirm identity
                  </button>
                  {typedOutcome && <div style={{ ...S.ok, marginTop: 8 }} data-testid="wp-typed-outcome">{typedOutcome}</div>}
                </div>
              )}
            </section>

            {/* ── (2) Documents ─────────────────────────────────────────────────────────── */}
            <section style={S.section} data-testid="wp-documents">
              <h3 style={S.sectionTitle}>Documents</h3>
              {avail?.documents && avail.documents.length > 0 ? (
                <>
                  <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: "var(--fl-fs-sm)" }}>
                    {avail.documents.map((d) => <li key={d.docId} data-testid="wp-document">{documentLine(d)}</li>)}
                  </ul>
                  <label style={{ ...S.label, marginTop: 8 }} data-no-print>
                    <input
                      type="checkbox" data-testid="wp-rev-confirm" checked={revConfirmed}
                      disabled={!identityConfirmed} onChange={(e) => setRevConfirmed(e.target.checked)}
                    />{" "}
                    I checked the machine and these manual revisions against what I have in hand.
                  </label>
                </>
              ) : (
                <div style={S.muted}>
                  No manufacturer documents yet. Attach this machine&apos;s data sheet and service manual in Sources.
                </div>
              )}
            </section>

            {/* ── (3) Work order ────────────────────────────────────────────────────────── */}
            <section style={S.section} data-testid="wp-workorder" data-no-print>
              <h3 style={S.sectionTitle}>Work order</h3>
              <label style={S.label}>ID<input style={S.input} value={wo.id} onChange={(e) => setWo((c) => ({ ...c, id: e.target.value }))} /></label>
              <label style={S.label}>Title<input style={S.input} value={wo.title} onChange={(e) => setWo((c) => ({ ...c, title: e.target.value }))} /></label>
              <label style={S.label}>Description<textarea rows={3} style={S.input} value={wo.description} onChange={(e) => setWo((c) => ({ ...c, description: e.target.value }))} /></label>
              <label style={S.label}>Asset tag<input style={S.input} value={wo.assetTag} onChange={(e) => setWo((c) => ({ ...c, assetTag: e.target.value }))} /></label>
              <label style={S.label}>Site<input style={S.input} value={wo.site} onChange={(e) => setWo((c) => ({ ...c, site: e.target.value }))} /></label>
              <label style={S.label}>
                <input type="checkbox" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} /> Synthetic / demo work order (not a real job)
              </label>
              <button type="button" style={S.btn} data-testid="wp-load-synthetic" onClick={loadSyntheticDemo}>Load synthetic demo work order</button>

              <button
                type="button" data-testid="wp-build"
                style={{ ...S.btn, ...S.btnBlock, ...S.primary, marginTop: 12, ...(buildBusy || !revConfirmed ? { opacity: 0.45, cursor: "not-allowed" } : {}) }}
                disabled={buildBusy || !revConfirmed} onClick={() => void onBuild()}
              >
                Build draft packet
              </button>
              {!revConfirmed && (avail?.documents.length ?? 0) > 0 && (
                <div style={{ ...S.muted, marginTop: 8 }} data-testid="wp-rev-needed">
                  Confirm the machine and the manual revisions above before building.
                </div>
              )}
              {blocked && <div style={{ ...S.muted, marginTop: 8 }}>{blocked.message}</div>}
              {refusal && (
                <div role="alert" style={{ ...S.fault, marginTop: 8 }} data-testid="wp-refusal">
                  <strong>{REFUSAL_LABEL[refusal.reason]}.</strong> {refusal.message}
                </div>
              )}
              {error && <div role="alert" style={{ ...S.fault, marginTop: 8 }} data-testid="wp-error">{error}</div>}
            </section>

            {/* ── (5) Packet view ───────────────────────────────────────────────────────── */}
            {packet && (
              <div data-testid="wp-packet">
                {packet.workOrder.synthetic && <div style={S.stamp} data-testid="wp-synthetic-stamp">SYNTHETIC — not a real job</div>}
                <PacketHeader packet={packet} />
                <div style={S.warn} data-testid="wp-disclaimer">{packet.disclaimer}</div>
                {warnings.length > 0 && (
                  // Every warning is a verifyPacket line check; each such line is already shown below
                  // as Unknown with its reason. On paper only the count prints.
                  <details style={{ ...S.muted, marginTop: 8 }} data-testid="wp-warnings">
                    <summary>
                      {warnings.length === 1 ? "1 line" : `${warnings.length} lines`} from the manuals could not be
                      checked word-for-word against their source line, so they are marked Unknown below. Check
                      those against the manual.
                    </summary>
                    <div data-no-print>{warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
                  </details>
                )}
                {packet.safety.hazardFlags.map((h, i) => <div key={i} style={{ ...S.warn, marginTop: 8 }} data-testid={`wp-hazard-${i}`}>{h}</div>)}

                <section style={S.section}>
                  <h3 style={S.sectionTitle}>Scope</h3>
                  {packet.scope.map((f, i) => <FieldRow key={i} path={scopeFieldPath(i)} field={f} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />)}
                </section>

                <section style={S.section}>
                  <h3 style={S.sectionTitle}>Safety</h3>
                  {packet.safety.cautions.map((f, i) => <FieldRow key={i} path={cautionFieldPath(i)} field={f} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />)}
                  <div style={{ ...S.fault, marginTop: 10 }} data-testid="wp-site-isolation">
                    <strong>Site isolation / lockout — REQUIRED.</strong>{" "}
                    {packet.safety.siteIsolation.value ?? "Unknown — your site must confirm isolation and lockout before work starts."}
                  </div>
                </section>

                <section style={S.section}>
                  <h3 style={S.sectionTitle}>Parts &amp; kits</h3>
                  {packet.parts.map((p, i) => (
                    <div key={i} style={{ marginTop: i > 0 ? 10 : 0 }}>
                      {p.kit && <div style={S.muted}>{p.kit} kit</div>}
                      <FieldRow path={partFieldPath(i, "partNumber")} field={p.partNumber} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />
                      <FieldRow path={partFieldPath(i, "description")} field={p.description} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />
                      <FieldRow path={partFieldPath(i, "qty")} field={p.qty} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />
                    </div>
                  ))}
                </section>

                <section style={S.section}>
                  <h3 style={S.sectionTitle}>Tools</h3>
                  {packet.tools.map((f, i) => <FieldRow key={i} path={toolFieldPath(i)} field={f} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />)}
                </section>

                <section style={S.section}>
                  <h3 style={S.sectionTitle}>Steps</h3>
                  {packet.steps.map((s, i) => <FieldRow key={i} path={stepFieldPath(i)} field={s.text} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />)}
                </section>

                <section style={S.section}>
                  <h3 style={S.sectionTitle}>Torque / measurements</h3>
                  {packet.measurements.map((m, i) => (
                    <div key={i} style={{ marginTop: i > 0 ? 10 : 0 }}>
                      <FieldRow path={measurementFieldPath(i, "name")} field={m.name} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />
                      <FieldRow path={measurementFieldPath(i, "value")} field={m.value} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />
                      <FieldRow path={measurementFieldPath(i, "tool")} field={m.tool} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />
                    </div>
                  ))}
                </section>

                <section style={S.section}>
                  <h3 style={S.sectionTitle}>Unknowns</h3>
                  {packet.unknowns.map((f, i) => <FieldRow key={i} path={unknownFieldPath(i)} field={f} onEdit={onEditField} onOpenSource={onOpenSource} busy={editBusy} />)}
                </section>

                <section style={S.section}>
                  <h3 style={S.sectionTitle}>Sources</h3>
                  <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: "var(--fl-fs-sm)" }}>
                    {packet.documents.map((d) => <li key={d.docId}>{documentLine(d)}</li>)}
                    {packet.approval.technicianReview.entries
                      .filter((e) => /^documents\[\d+\]\.revision$/.test(e.path) && e.action === "confirm")
                      .map((e, i) => (
                        <li key={`rev-${i}`} data-testid="wp-rev-confirmed">
                          Revision {String(e.next ?? "unknown")} confirmed against the manual in hand by {e.by} at {e.at}
                        </li>
                      ))}
                  </ul>
                </section>

                <section style={S.section} data-testid="wp-signoff">
                  <div>Technician signature: ______________________________  Date: ____________</div>
                  <div style={{ marginTop: 10 }}>Supervisor signature: ______________________________  Date: ____________</div>
                </section>

                <button type="button" style={{ ...S.btn, ...S.primary }} data-no-print data-testid="wp-export" onClick={onExport}>Export PDF</button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
