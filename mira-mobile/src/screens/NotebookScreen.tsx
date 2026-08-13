// One machine's workspace — the mobile collapse of the three-panel core
// (build spec §4.1): a Sources · Chat · Studio tab switcher, Chat default.
// Sources = per-source include checkboxes that scope retrieval (sourceDocIds);
// "+ Add sources" opens the source-type sheet (PDF upload + workspace picker
// now; the rest labeled honestly as not-yet). Chat = persisted server turns +
// live grounded turns with numbered citation chips and a "{N} sources"
// composer counter. Studio = locked tile grid (generators land server-side
// first — tiles never fake a generation).
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  getNotebookDetail,
  askNotebook,
  attachSource,
  setSourceEnabled,
  detachSource,
  listWorkspaceDocs,
  uploadSourceToNotebook,
  enabledDocIds,
  type NotebookDetail,
  type WorkspaceDoc,
} from "../api/resources";
import { preferencesStore } from "../lib/offline-queue";
import { answerBody } from "../lib/chat-copy";
import type { ChatCitation, ChatTurn } from "../lib/sse";
import { Loading, Empty, ErrorState, load, type Loadable } from "./common";

type Panel = "sources" | "chat" | "studio";

const QUICK_STARTS = [
  "Diagnose a fault",
  "Look up a spec or part",
  "Show the safety steps",
];

/** Persisted-evidence rows are the live citation shape stored as JSON —
 *  parse defensively so a malformed row never breaks the chat render. */
export function citationsFromEvidence(evidence: unknown[] | undefined): ChatCitation[] {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .filter(
      (e): e is Record<string, unknown> =>
        typeof e === "object" && e !== null && "citationId" in e,
    )
    .map((e) => ({
      citationId: String(e.citationId),
      sourceTitle: String(e.sourceTitle ?? "Attached document"),
      page: typeof e.page === "number" ? e.page : null,
      quote: typeof e.quote === "string" ? e.quote : null,
      docId: typeof e.docId === "string" ? e.docId : null,
    }));
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
  const scrollRef = useRef<HTMLDivElement | null>(null);

  backRef.current = () => {
    if (viewCitation) {
      setViewCitation(null);
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
  const scope = enabledDocIds(sources);

  return (
    <>
      <div className="content" style={{ paddingBottom: 8, flex: "none" }}>
        <button className="btn-link" onClick={onExit}>
          ← Notebooks
        </button>
        <h3 style={{ margin: "4px 0 0" }}>{notebook.displayName}</h3>
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

      {panel === "sources" && (
        <div className="content bottompad" style={{ paddingTop: 0 }}>
          <button className="btn-primary" onClick={() => setSheetOpen(true)}>
            + Add sources
          </button>
          {sources.length === 0 && (
            <Empty text="Saved sources will appear here. Add the machine's manual to start asking questions." />
          )}
          {sources.map((s) => (
            <div key={s.docId} className="source-row">
              <input
                type="checkbox"
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
              <div className="grow">
                <div className="title">📄 {s.filename ?? s.docId}</div>
                <div className="meta">
                  {s.pages ? `${s.pages} pages` : "document"}
                  {s.matchState && s.matchState !== "user_confirmed" ? ` · ${s.matchState}` : ""}
                </div>
              </div>
              <button
                className="detach"
                title="Remove from this notebook"
                onClick={async () => {
                  // Mis-tap protection (punch list SRC-11).
                  if (
                    !window.confirm(
                      `Remove "${s.filename ?? "this source"}" from the notebook? The document stays in your workspace.`,
                    )
                  )
                    return;
                  await detachSource(id, s.docId).catch(() => {});
                  refresh();
                }}
              >
                ✕
              </button>
            </div>
          ))}
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
                      ? "Add a source first — answers are grounded only in this notebook's documents."
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
              placeholder={scope.length === 0 ? "Add a source to start" : "Ask a question…"}
              value={q}
              disabled={scope.length === 0}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="counter">
              {scope.length} source{scope.length === 1 ? "" : "s"}
            </span>
            <button
              className="btn-primary"
              disabled={busy || !q.trim() || scope.length === 0}
              onClick={async () => {
                const question = q.trim();
                setQ("");
                setBusy(true);
                setChatError(null);
                try {
                  const a = await askNotebook(id, question, scope);
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
        <div className="sheet-backdrop" onClick={() => setViewCitation(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>
              [{viewCitation.citationId}] {viewCitation.sourceTitle}
              {viewCitation.page ? ` — p.${viewCitation.page}` : ""}
            </h3>
            {viewCitation.quote ? (
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
            ) : (
              <div className="meta">
                The cited passage isn't stored for this older answer — re-ask the
                question to get a linked citation.
              </div>
            )}
            <div className="meta" style={{ marginTop: 10 }}>
              Cited from the source document
              {viewCitation.page ? ` at page ${viewCitation.page}` : ""}. Full
              in-app page view is coming; verify against the manual before acting.
            </div>
            <button style={{ marginTop: 12 }} onClick={() => setViewCitation(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {sheetOpen && (
        <AddSourcesSheet
          notebook={notebook}
          attachedDocIds={sources.map((s) => s.docId)}
          onClose={() => setSheetOpen(false)}
          onChanged={() => {
            refresh();
          }}
        />
      )}
    </>
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
  attachedDocIds,
  onClose,
  onChanged,
}: {
  notebook: NotebookDetail["notebook"];
  attachedDocIds: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "workspace">("menu");
  const [docs, setDocs] = useState<Loadable<WorkspaceDoc[]> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const uploadPdf = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await uploadSourceToNotebook(notebook, file);
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
              onClick={() => fileRef.current?.click()}
            >
              📄 {busy ? "Uploading…" : "Upload a PDF manual"}
            </button>
            <button
              className="sheet-option"
              onClick={() => {
                setMode("workspace");
                setDocs({ state: "loading" });
                void load(listWorkspaceDocs).then(setDocs);
              }}
            >
              🗂 From this workspace
            </button>
            <div className="meta" style={{ margin: "2px 0 10px" }}>
              Website, copied text, and photo sources are coming soon.
            </div>
            {note && <div className="meta">{note}</div>}
            <button style={{ marginTop: 6 }} onClick={onClose}>
              Done
            </button>
          </>
        )}
        {mode === "workspace" && (
          <>
            <h3>From this workspace</h3>
            {docs?.state === "loading" && <Loading what="documents" />}
            {docs?.state === "error" && <ErrorState error={docs.error} />}
            {docs?.state === "ready" && docs.data.length === 0 && (
              <Empty text="No documents in this workspace yet." />
            )}
            {docs?.state === "ready" &&
              docs.data.map((d) => {
                const attached = attachedDocIds.includes(d.docId);
                return (
                  <button
                    key={d.docId}
                    className="sheet-option"
                    disabled={attached || busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await attachSource(notebook.id, d.docId);
                        setNote("Source attached.");
                        onChanged();
                        setMode("menu");
                      } catch (e) {
                        setNote(e instanceof Error ? e.message : "Couldn't attach that document.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    📄 {d.filename ?? d.docId}
                    {d.pages ? ` · ${d.pages}p` : ""}
                    {attached ? " · attached" : ""}
                  </button>
                );
              })}
            <button style={{ marginTop: 6 }} onClick={() => setMode("menu")}>
              ← Back
            </button>
          </>
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
      </div>
    </div>
  );
}
