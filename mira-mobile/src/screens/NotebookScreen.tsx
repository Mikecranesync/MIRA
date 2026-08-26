// One machine's workspace — the mobile collapse of the three-panel core
// (build spec §4.1): a Sources · Chat · Studio tab switcher, Chat default.
// Sources = per-source include checkboxes that scope retrieval (sourceDocIds);
// "+ Add sources" opens the source-type sheet (PDF upload + workspace picker
// now; the rest labeled honestly as not-yet). Chat = persisted server turns +
// live grounded turns with numbered citation chips and a "{N} sources"
// composer counter. Studio = locked tile grid (generators land server-side
// first — tiles never fake a generation).
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { canPickNatively, pickNameplatePhoto, pickPdf } from "../lib/native-pick";
import {
  getNotebookDetail,
  askNotebook,
  attachFileToTargets,
  setSourceEnabled,
  detachSource,
  uploadSourceToNotebook,
  getSourcePassage,
  getFile,
  enabledDocIds,
  canBeChatSource,
  fileCapabilityLabel,
  type NotebookDetail,
  type NotebookSource,
  type SourcePassage,
  type WorkspaceFile,
  deleteNotebook,
} from "../api/resources";
import { preferencesStore } from "../lib/offline-queue";
import { answerBody } from "../lib/chat-copy";
import { createSubmitGuard, deleteFailureMessage } from "../lib/notebook-delete";
import { normalizeCitations, type ChatCitation, type ChatTurn } from "../lib/sse";
import { AttachFileSheet } from "./AttachFileSheet";
import { ComponentNameplateFlow } from "./ComponentNameplateFlow";
import { FilePreview } from "./FilePreview";
import { PickWorkspaceFileSheet } from "./FilesScreen";
import { Loading, Empty, ErrorState, load, type Loadable } from "./common";

type Panel = "sources" | "chat" | "studio";

const QUICK_STARTS = [
  "Diagnose a fault",
  "Look up a spec or part",
  "Show the safety steps",
];

/** Persisted-evidence rows are the live citation shape stored as JSON — so
 *  they go through the SAME normalizer as a live `sources` frame. One mapping
 *  means a saved citation can never carry less than a live one (notably
 *  `fileId`, which powers "Open original at cited page"). */
export function citationsFromEvidence(evidence: unknown[] | undefined): ChatCitation[] {
  return normalizeCitations(evidence);
}

/** How a source row presents itself. Three kinds, never blurred:
 *  - `searchable`  — materialized + confirmed: chat can cite it (checkbox).
 *  - `viewable`    — a real attachment you can open, but not chat evidence.
 *  - `stored`      — kept, but the pipeline can't read it.
 *  A `candidate` or `rejected` match is NEVER searchable, however good the
 *  file is: an unconfirmed proposal is not grounded evidence. */
export type SourceKind = "searchable" | "viewable" | "stored";

export function sourceKind(s: Pick<NotebookSource, "docId" | "matchState" | "status">): SourceKind {
  if (canBeChatSource(s)) return "searchable";
  return s.docId ? "viewable" : "stored";
}

export function sourceKindLabel(s: Pick<NotebookSource, "docId" | "matchState" | "status">): string {
  const kind = sourceKind(s);
  const base =
    kind === "searchable"
      ? fileCapabilityLabel("indexable")
      : kind === "viewable"
        ? fileCapabilityLabel("viewable")
        : fileCapabilityLabel("stored");
  if (s.matchState === "candidate") return `${base} · proposed match — confirm before using`;
  if (s.matchState === "rejected") return `${base} · you rejected this match`;
  return base;
}

// Studio generators (STU-03): each runs a GROUNDED generation through the
// same chat endpoint — same retrieval scope, same citation rules. Results are
// cached device-local (purged on sign-out) until server-side storage exists.
const STUDIO_KEY = (notebookId: string) => `flm.studio.v1.${notebookId}`;
interface StudioOutput {
  tile: string;
  generatedAt: string;
  answer: string;
  citations: ChatCitation[];
}
const STUDIO_TILES: { t: string; d: string; prompt?: string }[] = [
  {
    t: "Spec & parts table",
    d: "Torque specs, part numbers, fault codes",
    prompt:
      "Create a reference table (markdown) of every concrete specification in the sources: torque specs, voltages, part/catalog numbers, fault codes with meanings, dimensions, ratings. One row per item with its value and units, citing each row. If a category has no data, omit it.",
  },
  {
    t: "Maintenance report",
    d: "How this machine works + key procedures",
    prompt:
      "Write a concise maintenance briefing for this machine from the sources: what it is, the key procedures covered by the documentation, the faults it can report and their first checks, and any safety-critical steps. Use short sections with headings, cite every claim.",
  },
  { t: "Shift briefing", d: "Hands-free audio walkthrough" },
  { t: "Training pack", d: "Flashcards + quiz for sign-off" },
];

export function NotebookScreen({
  id,
  openAddSources,
  backRef,
  onExit,
}: {
  id: string;
  openAddSources?: boolean;
  backRef: MutableRefObject<(() => boolean) | null>;
  onExit: () => void;
}) {
  const [detail, setDetail] = useState<Loadable<NotebookDetail>>({ state: "loading" });
  const [panel, setPanel] = useState<Panel>(openAddSources ? "sources" : "chat");
  const [sheetOpen, setSheetOpen] = useState(Boolean(openAddSources));
  const [liveTurns, setLiveTurns] = useState<{ q: string; a: ChatTurn }[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState<unknown>(null);
  const [viewCitation, setViewCitation] = useState<ChatCitation | null>(null);
  const [passages, setPassages] = useState<Loadable<SourcePassage[]> | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [openSource, setOpenSource] = useState<NotebookSource | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Ref, not state: a double-tap must be rejected synchronously, before
  // React commits `deleting` and disables the button.
  const deleteGuard = useRef(createSubmitGuard());
  const [attachSource, setAttachSource] = useState<NotebookSource | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  backRef.current = () => {
    if (attachSource) {
      setAttachSource(null);
      return true;
    }
    if (openSource) {
      setOpenSource(null);
      return true;
    }
    if (viewCitation) {
      setViewCitation(null);
      setPassages(null);
      setShowOriginal(false);
      return true;
    }
    if (sheetOpen) {
      setSheetOpen(false);
      return true;
    }
    return false; // let the tab pop back to home
  };

  const refresh = () => {
    void load(() => getNotebookDetail(id)).then(setDetail);
  };
  useEffect(() => {
    setDetail({ state: "loading" });
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [liveTurns, busy, panel]);

  if (detail.state === "loading") return <Loading what="notebook" />;
  if (detail.state === "error")
    return (
      <div className="content">
        <button className="btn-link" onClick={onExit}>
          ← Notebooks
        </button>
        <ErrorState error={detail.error} onRetry={refresh} />
      </div>
    );
  const { notebook, sources, turns } = detail.data;
  // Chat scope is fail-closed: only CONFIRMED, materialized sources can ever
  // enter it, whatever the checkbox says about a candidate row.
  const scope = enabledDocIds(sources.filter(canBeChatSource));

  return (
    <>
      <div className="content" style={{ paddingBottom: 8, flex: "none" }}>
        <button className="btn-link" onClick={onExit}>
          ← Notebooks
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <h3 style={{ margin: "4px 0 0", flex: 1, minWidth: 0 }}>{notebook.displayName}</h3>
          <button
            className="btn-link"
            aria-label="Delete notebook"
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
            style={{ color: "var(--fl-danger, #dc2626)", flex: "none" }}
          >
            Delete
          </button>
        </div>
        <div className="meta">
          {sources.length} source{sources.length === 1 ? "" : "s"}
          {notebook.manufacturer ? ` · ${notebook.manufacturer}` : ""}
          {notebook.model ? ` ${notebook.model}` : ""}
        </div>
        <div className="panel-tabs">
          {(["sources", "chat", "studio"] as const).map((p) => (
            <button
              key={p}
              className={`panel-tab ${p === panel ? "panel-tab-active" : ""}`}
              onClick={() => setPanel(p)}
            >
              {p === "sources" ? `Sources (${sources.length})` : p === "chat" ? "Chat" : "Studio"}
            </button>
          ))}
        </div>
      </div>

      {confirmDelete && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Delete notebook"
          className="sheet-backdrop"
          onClick={() => !deleting && setConfirmDelete(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--fl-bg, #fff)",
              border: "1px solid var(--fl-line, #ddd)",
              borderRadius: "var(--fl-radius, 12px)",
              padding: 16,
              maxWidth: 360,
              width: "100%",
            }}
          >
            <h3 style={{ margin: 0 }}>Delete this notebook?</h3>
            <p className="meta" style={{ marginTop: 8 }}>
              {/* Name it explicitly — the technician must see WHICH notebook
                  is being destroyed, not merely that one is. */}
              <strong>{notebook.displayName}</strong> and its chat history will be
              permanently deleted. This cannot be undone.
            </p>
            <p className="meta" style={{ marginTop: 6 }}>
              Uploaded documents are kept — they may be attached to other notebooks.
            </p>
            {deleteError && (
              <p role="alert" className="meta" style={{ color: "var(--fl-danger, #dc2626)" }}>
                {deleteError}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn-link" disabled={deleting} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={deleting}
                aria-busy={deleting}
                onClick={async () => {
                  await deleteGuard.current.run(async () => {
                    setDeleting(true);
                    setDeleteError(null);
                    try {
                      await deleteNotebook(id);
                      setConfirmDelete(false);
                      // onExit re-lists notebooks, so the deleted row leaves the
                      // UI immediately rather than on some later refresh.
                      onExit();
                    } catch (e) {
                      const status = (e as { status?: number } | null)?.status ?? 0;
                      setDeleteError(deleteFailureMessage(status));
                      setDeleting(false);
                    }
                  });
                }}
                style={{ background: "var(--fl-danger, #dc2626)" }}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {panel === "sources" && (
        <div className="content bottompad" style={{ paddingTop: 0 }}>
          <button className="btn-primary" onClick={() => setSheetOpen(true)}>
            + Add sources
          </button>
          {sources.length > 0 && (
            <div className="meta" style={{ margin: "10px 0 2px" }}>
              The checkbox means: include this source in notebook chat. Only
              searchable, confirmed sources can be included — you can still open
              everything else.
            </div>
          )}
          {sources.length === 0 && (
            <Empty text="Saved sources will appear here. Add the machine's manual to get cited, machine-specific answers — you can ask general questions right now." />
          )}
          {sources.map((s) => {
            const chattable = canBeChatSource(s);
            return (
              <div key={s.docId || s.fileId || s.filename} className="source-row">
                {chattable ? (
                  <input
                    type="checkbox"
                    title="Include this source in notebook chat"
                    checked={s.enabledByDefault}
                    onChange={async (e) => {
                      const enabled = e.target.checked;
                      // Optimistic: flip locally NOW; server truth wins on error.
                      setDetail((d) =>
                        d.state === "ready"
                          ? {
                              state: "ready",
                              data: {
                                ...d.data,
                                sources: d.data.sources.map((x) =>
                                  x.docId === s.docId ? { ...x, enabledByDefault: enabled } : x,
                                ),
                              },
                            }
                          : d,
                      );
                      try {
                        await setSourceEnabled(id, s.docId, enabled);
                      } catch {
                        refresh();
                      }
                    }}
                  />
                ) : (
                  // No checkbox at all — the box means "include in chat", and
                  // this row cannot be included, so offering one would lie.
                  <span
                    aria-hidden
                    style={{ width: 22, textAlign: "center", color: "var(--fl-ink-muted)" }}
                  >
                    —
                  </span>
                )}
                <div className="grow">
                  <div className="title">
                    {s.sourceRole === "photo" ? "🖼" : "📄"} {s.filename ?? s.docId}
                  </div>
                  <div className="meta">
                    {s.pages ? `${s.pages} pages · ` : ""}
                    {sourceKindLabel(s)}
                    {s.sourceRole && s.sourceRole !== "manual" ? ` · ${s.sourceRole}` : ""}
                  </div>
                </div>
                {/* Open is independent of the checkbox AND of detach. */}
                <button
                  className="detach row-action"
                  title="Open the original"
                  disabled={!s.fileId}
                  onClick={() => s.fileId && setOpenSource(s)}
                >
                  Open
                </button>
                <button
                  className="detach row-action"
                  title="Attach this file somewhere else too"
                  disabled={!s.fileId}
                  onClick={() => s.fileId && setAttachSource(s)}
                >
                  Attach to another…
                </button>
                <button
                  className="detach"
                  title="Detach from this notebook"
                  onClick={async () => {
                    // Mis-tap protection (punch list SRC-11).
                    if (
                      !window.confirm(
                        `Detach "${s.filename ?? "this source"}" from this notebook? The file stays in your workspace.`,
                      )
                    )
                      return;
                    await detachSource(id, s.docId).catch(() => {});
                    refresh();
                  }}
                >
                  Detach
                </button>
              </div>
            );
          })}
        </div>
      )}

      {panel === "chat" && (
        <>
          <div className="content" style={{ paddingTop: 0 }} ref={scrollRef}>
            {turns.length === 0 && liveTurns.length === 0 && (
              <>
                <Empty
                  text={
                    scope.length === 0
                      ? "Ask anything now — answers are general until this notebook has documents; then they're grounded and cited."
                      : "Ask this machine anything. Answers cite the manual."
                  }
                />
                {scope.length > 0 && (
                  <div className="chip-row" style={{ justifyContent: "center" }}>
                    {QUICK_STARTS.map((s) => (
                      <button key={s} className="chip" onClick={() => setQ(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {turns.map((t) => (
              <div key={t.id}>
                <div className="msg-user">{t.question}</div>
                <div className="msg-answer">{answerBody(t.answerText, t.answerStatus)}</div>
                <div>
                  {citationsFromEvidence(t.evidence).map((c) => (
                    <button
                      key={c.citationId}
                      className="cite-chip"
                      style={{ border: "none", cursor: "pointer" }}
                      onClick={() => setViewCitation(c)}
                    >
                      {c.citationId} · {c.sourceTitle}
                      {c.page ? ` p.${c.page}` : ""}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {liveTurns.map((t, i) => (
              <div key={`live-${i}`}>
                <div className="msg-user">{t.q}</div>
                <div className="msg-answer">{answerBody(t.a.answer, t.a.status)}</div>
                {/* Evidence basis (spec 1.3). Rendered only for a general answer:
                    a grounded one already shows its citation chips, and a second
                    badge saying "grounded" would be noise. Silence here never
                    means "trust it" — an unlabelled answer shows its chips. */}
                {t.a.evidenceBasis === "general_reasoning" && (
                  <div className="evidence-basis-general">
                    {t.a.evidenceLabel || "General guidance — not grounded in this machine's documents."}
                  </div>
                )}
                <div>
                  {t.a.citations.map((c) => (
                    <button
                      key={c.citationId}
                      className="cite-chip"
                      style={{ border: "none", cursor: "pointer" }}
                      onClick={() => setViewCitation(c)}
                    >
                      {c.citationId} · {c.sourceTitle}
                      {c.page ? ` p.${c.page}` : ""}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {busy && <div className="empty">Searching your docs…</div>}
            {chatError != null && <ErrorState error={chatError} />}
          </div>
          <div className="composer">
            <input
              placeholder={
                scope.length === 0 ? "Ask anything — no manual loaded yet" : "Ask a question…"
              }
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="counter">
              {scope.length} source{scope.length === 1 ? "" : "s"}
            </span>
            <button
              className="btn-primary"
              disabled={busy || !q.trim()}
              onClick={async () => {
                const question = q.trim();
                setQ("");
                setBusy(true);
                setChatError(null);
                try {
                  // With no source attached the only honest answer is a general
                  // one, and the server labels it as such. With sources present
                  // this stays the strict grounded path — the mode is never sent
                  // as a fallback when retrieval comes back empty.
                  const a = await askNotebook(id, question, scope, scope.length === 0 ? "general" : undefined);
                  setLiveTurns((t) => [...t, { q: question, a }]);
                } catch (e) {
                  setChatError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send
            </button>
          </div>
        </>
      )}

      {panel === "studio" && (
        <StudioPanel
          notebookId={id}
          scope={scope}
          ask={(prompt) => askNotebook(id, prompt, scope)}
          onCitation={setViewCitation}
        />
      )}

      {viewCitation && (
        <div
          className="sheet-backdrop"
          onClick={() => {
            setViewCitation(null);
            setPassages(null);
            setShowOriginal(false);
          }}
        >
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>
              [{viewCitation.citationId}] {viewCitation.sourceTitle}
              {viewCitation.page ? ` — p.${viewCitation.page}` : ""}
            </h3>
            {passages === null && viewCitation.quote && (
              <div
                className="msg-answer"
                style={{
                  borderLeft: "2px solid var(--flm-citation-fg)",
                  paddingLeft: 12,
                  color: "var(--fl-ink-muted)",
                }}
              >
                “{viewCitation.quote.trim()}…”
              </div>
            )}
            {passages === null && !viewCitation.quote && (
              <div className="meta">
                The quote isn't stored for this older answer — open the full
                passage below.
              </div>
            )}
            {passages?.state === "loading" && <Loading what="passage" />}
            {passages?.state === "error" && <ErrorState error={passages.error} />}
            {passages?.state === "ready" && passages.data.length === 0 && (
              <Empty text="No passage text available for this page." />
            )}
            {passages?.state === "ready" &&
              passages.data.map((p, i) => (
                <div
                  key={i}
                  className="msg-answer"
                  style={{
                    borderLeft: "2px solid var(--flm-citation-fg)",
                    paddingLeft: 12,
                    marginBottom: 10,
                  }}
                >
                  {p.text}
                </div>
              ))}
            {passages === null && viewCitation.docId && (
              <button
                style={{ marginTop: 12 }}
                onClick={() => {
                  setPassages({ state: "loading" });
                  void load(() =>
                    getSourcePassage(id, viewCitation.docId!, viewCitation.page ?? null),
                  ).then(setPassages);
                }}
              >
                Show full passage
              </button>
            )}
            {/* The original bytes, fetched WITH the session (requestBinary) and
                rendered in-app. Never window.open: on native that would land
                on a login page and would mean handing the session cookie to an
                external browser. */}
            {viewCitation.fileId && !showOriginal && (
              <button style={{ marginTop: 12 }} onClick={() => setShowOriginal(true)}>
                Open original{viewCitation.page ? ` at cited page ${viewCitation.page}` : ""}
              </button>
            )}
            {viewCitation.fileId && showOriginal && (
              <div style={{ marginTop: 12 }}>
                <FilePreview
                  fileId={viewCitation.fileId}
                  filename={viewCitation.sourceTitle}
                  page={viewCitation.page ?? null}
                />
              </div>
            )}
            {!viewCitation.fileId && (
              <div className="meta" style={{ marginTop: 12 }}>
                This answer didn't record which file the passage came from, so
                the original can't be opened from here.
              </div>
            )}
            <div className="meta" style={{ marginTop: 10 }}>
              Cited from the source document
              {viewCitation.page ? ` at page ${viewCitation.page}` : ""}. Verify
              against the manual before acting.
            </div>
            <button
              style={{ marginTop: 12 }}
              onClick={() => {
                setViewCitation(null);
                setPassages(null);
                setShowOriginal(false);
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {openSource?.fileId && (
        <div className="sheet-backdrop" onClick={() => setOpenSource(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{openSource.filename ?? "Source"}</h3>
            <div className="meta" style={{ marginBottom: 10 }}>
              {sourceKindLabel(openSource)}
            </div>
            <FilePreview
              fileId={openSource.fileId}
              filename={openSource.filename ?? "document"}
            />
            <button style={{ marginTop: 12 }} onClick={() => setOpenSource(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {attachSource?.fileId && (
        <NotebookSourceAttachSheet
          source={attachSource}
          onClose={() => setAttachSource(null)}
          onAttached={() => {
            setAttachSource(null);
            refresh();
          }}
        />
      )}

      {sheetOpen && (
        <AddSourcesSheet
          notebook={notebook}
          attachedFileIds={sources.map((s) => s.fileId).filter((f): f is string => Boolean(f))}
          onClose={() => setSheetOpen(false)}
          onChanged={() => {
            refresh();
          }}
        />
      )}
    </>
  );
}

/** "Attach to another…" from a source row — the shared sheet, but its existing
 *  filings have to be fetched first so they render pre-checked. */
function NotebookSourceAttachSheet({
  source,
  onClose,
  onAttached,
}: {
  source: NotebookSource;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [links, setLinks] = useState<Loadable<{ id: string; targetType: string; targetId: string }[]>>({
    state: "loading",
  });
  useEffect(() => {
    void load(() => getFile(source.fileId!).then((r) => r.links)).then(setLinks);
  }, [source.fileId]);

  if (links.state === "loading")
    return (
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <Loading what="where this file is filed" />
        </div>
      </div>
    );
  if (links.state === "error")
    return (
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <ErrorState error={links.error} />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    );
  return (
    <AttachFileSheet
      fileId={source.fileId!}
      filename={source.filename ?? "this file"}
      existingLinks={links.data}
      onClose={onClose}
      onAttached={onAttached}
    />
  );
}

function StudioPanel({
  notebookId,
  scope,
  ask,
  onCitation,
}: {
  notebookId: string;
  scope: string[];
  ask: (prompt: string) => Promise<ChatTurn>;
  onCitation: (c: ChatCitation) => void;
}) {
  const [outputs, setOutputs] = useState<Record<string, StudioOutput>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  const [genError, setGenError] = useState<unknown>(null);

  useEffect(() => {
    void preferencesStore.get(STUDIO_KEY(notebookId)).then((raw) => {
      if (!raw) return;
      try {
        setOutputs(JSON.parse(raw) as Record<string, StudioOutput>);
      } catch {
        /* corrupt cache = empty */
      }
    });
  }, [notebookId]);

  const generate = async (tile: (typeof STUDIO_TILES)[number]) => {
    if (!tile.prompt || scope.length === 0 || generating) return;
    setGenerating(tile.t);
    setGenError(null);
    try {
      const a = await ask(tile.prompt);
      const out: StudioOutput = {
        tile: tile.t,
        generatedAt: new Date().toISOString(),
        answer: answerBody(a.answer, a.status),
        citations: a.citations,
      };
      const next = { ...outputs, [tile.t]: out };
      setOutputs(next);
      await preferencesStore.set(STUDIO_KEY(notebookId), JSON.stringify(next));
    } catch (e) {
      setGenError(e);
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div className="content bottompad" style={{ paddingTop: 0 }}>
      <div className="meta">
        Reusable artifacts generated ONLY from this notebook's enabled sources,
        with citations. Stored on this device.
      </div>
      <div className="studio-grid">
        {STUDIO_TILES.map((tile) => {
          const runnable = Boolean(tile.prompt);
          const locked = scope.length === 0;
          return (
            <div
              key={tile.t}
              className="studio-tile"
              style={{
                opacity: runnable && !locked ? 1 : 0.6,
                cursor: runnable && !locked ? "pointer" : "default",
              }}
              onClick={() => void generate(tile)}
            >
              <div className="t">{tile.t}</div>
              <div className="d">
                {locked
                  ? "Add sources first."
                  : !runnable
                    ? `${tile.d} — coming soon`
                    : generating === tile.t
                      ? "Generating from your sources…"
                      : outputs[tile.t]
                        ? "Tap to regenerate"
                        : tile.d}
              </div>
            </div>
          );
        })}
      </div>
      {genError != null && <ErrorState error={genError} />}
      {Object.values(outputs)
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
        .map((o) => (
          <div key={o.tile} className="card" style={{ marginTop: 12 }}>
            <h3>{o.tile}</h3>
            <div className="meta" style={{ marginBottom: 6 }}>
              Generated {new Date(o.generatedAt).toLocaleString()} · grounded in your sources
            </div>
            <div className="msg-answer">{o.answer}</div>
            <div>
              {o.citations.map((c) => (
                <button
                  key={c.citationId}
                  className="cite-chip"
                  style={{ border: "none", cursor: "pointer" }}
                  onClick={() => onCitation(c)}
                >
                  {c.citationId} · {c.sourceTitle}
                  {c.page ? ` p.${c.page}` : ""}
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function AddSourcesSheet({
  notebook,
  attachedFileIds,
  onClose,
  onChanged,
}: {
  notebook: NotebookDetail["notebook"];
  attachedFileIds: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "files" | "paste" | "nameplate">("menu");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // On device the phone's own picker is used (#3353 — the WebView turned
  // capture="environment" into a chooser). The hidden inputs below stay for the
  // web build, which has no native picker to call.
  const cameraRef = useRef<HTMLInputElement | null>(null);

  /** Nameplate photo: phone picker on device, hidden input on web. */
  const openNameplatePicker = async () => {
    if (!canPickNatively()) return cameraRef.current?.click();
    const f = await pickNameplatePhoto();
    if (!f) return; // backed out
    setNote(null);
    setPhoto(f);
    setMode("nameplate");
  };

  /** PDF: phone document picker on device, hidden input on web. */
  const openPdfPicker = async () => {
    if (!canPickNatively()) return fileRef.current?.click();
    const f = await pickPdf();
    if (!f) return;
    await uploadPdf(f);
  };

  const uploadPdf = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await uploadSourceToNotebook(notebook, file, { sourceRole: "manual" });
      if (r.attached) {
        setNote(r.duplicate ? "Already in your workspace — attached here." : "Source added. Ask away.");
        onChanged();
      } else {
        setNote(r.warning);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Upload failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  // "From Files" is the FULL workspace — photos and stored-only files included,
  // each labelled with what it can actually do, not just parsed documents.
  const attachExisting = async (f: WorkspaceFile) => {
    setBusy(true);
    setNote(null);
    try {
      await attachFileToTargets(
        f.id,
        [
          {
            targetType: "equipment_notebook",
            targetId: notebook.id,
            role: f.mimeType.startsWith("image/") ? "photo" : "manual",
            matchState: "user_confirmed",
          },
        ],
        crypto.randomUUID(),
      );
      setNote(
        f.capability === "indexable"
          ? "Attached — it's a searchable source now."
          : `Attached as a ${fileCapabilityLabel(f.capability).toLowerCase()}.`,
      );
      onChanged();
      setMode("menu");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't attach that file.");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "files")
    return (
      <PickWorkspaceFileSheet
        title="From Files"
        hint="Everything in your workspace — manuals, drawings, photos, and stored files."
        excludeFileIds={attachedFileIds}
        busy={busy}
        onClose={() => setMode("menu")}
        onPick={(f) => void attachExisting(f)}
      />
    );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {mode === "menu" && (
          <>
            <h3>Add sources</h3>
            <div className="meta" style={{ marginBottom: 10 }}>
              Answers are grounded ONLY in what you add here.
            </div>
            <button
              className="sheet-option"
              disabled={busy}
              onClick={() => void openPdfPicker()}
            >
              📄 {busy ? "Uploading…" : "Upload a PDF manual"}
            </button>
            <button
              className="sheet-option"
              disabled={busy}
              onClick={() => void openNameplatePicker()}
            >
              📷 Photograph a component nameplate
            </button>
            <button className="sheet-option" onClick={() => setMode("files")}>
              🗂 From Files
            </button>
            <button className="sheet-option" onClick={() => setMode("paste")}>
              📋 Paste text (error notes, nameplate data…)
            </button>
            {note && <div className="meta">{note}</div>}
            <button style={{ marginTop: 6 }} onClick={onClose}>
              Done
            </button>
          </>
        )}
        {mode === "paste" && (
          <>
            <h3>Paste text</h3>
            <div className="meta" style={{ marginBottom: 8 }}>
              Becomes a grounded, citable source — same pipeline as an uploaded
              document (private to your workspace).
            </div>
            <label>Name (optional)</label>
            <input
              value={pasteTitle}
              placeholder="e.g. Fault notes from the floor"
              onChange={(e) => setPasteTitle(e.target.value)}
            />
            <label>Text</label>
            <textarea
              value={pasteText}
              rows={7}
              placeholder="Paste the error text, nameplate data, or technician note…"
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button
              className="btn-primary"
              style={{ marginTop: 10 }}
              disabled={busy || !pasteText.trim()}
              onClick={async () => {
                // A pasted note IS a text file — reuse the ONE upload pipeline
                // (writeTextChunksForNode downstream), no paste-specific fork.
                const base =
                  pasteTitle.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
                  "pasted-note";
                const file = new File([pasteText], `${base}.txt`, { type: "text/plain" });
                setBusy(true);
                setNote(null);
                try {
                  // A pasted note is a NOTE, not a manual — say so on the wire.
                  const r = await uploadSourceToNotebook(notebook, file, {
                    sourceRole: "note",
                  });
                  if (r.attached) {
                    setNote(r.duplicate ? "Already in your workspace — attached here." : "Note added as a source.");
                    setPasteText("");
                    setPasteTitle("");
                    onChanged();
                    setMode("menu");
                  } else {
                    setNote(r.warning);
                  }
                } catch (e) {
                  setNote(e instanceof Error ? e.message : "Couldn't save the note — try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : "Add as source"}
            </button>
            {!pasteText.trim() && (
              <div className="meta" style={{ marginTop: 6 }}>
                To add: paste some text.
              </div>
            )}
            {note && <div className="meta">{note}</div>}
            <button style={{ marginTop: 6 }} onClick={() => setMode("menu")}>
              ← Back
            </button>
          </>
        )}
        {mode === "nameplate" && photo && (
          <ComponentNameplateFlow
            notebookId={notebook.id}
            photo={photo}
            onDone={onChanged}
            onCancel={() => {
              setPhoto(null);
              setMode("menu");
            }}
            onUploadInstead={() => {
              setPhoto(null);
              setMode("menu");
              // Next tick: the picker must open after this flow unmounts, or the
              // input click is swallowed by the screen that is going away. The
              // native picker is its own activity, so it has no such problem —
              // but the deferral is harmless and keeps one code path.
              setTimeout(() => void openPdfPicker(), 0);
            }}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            void uploadPdf(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (!f) return;
            setNote(null);
            setPhoto(f);
            setMode("nameplate");
          }}
        />
      </div>
    </div>
  );
}
