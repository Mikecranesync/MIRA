// Chat tab — grounded equipment-notebook chat (proven Phase-2 flow, now a tab).
import { useEffect, useState, type MutableRefObject } from "react";
import { listNotebooks, askNotebook, type Notebook } from "../api/resources";
import type { ChatTurn } from "../lib/sse";
import { Loading, Empty, ErrorState, load, type Loadable } from "./common";

export function ChatTab({
  backRef,
}: {
  backRef: MutableRefObject<(() => boolean) | null>;
}) {
  const [nbs, setNbs] = useState<Loadable<Notebook[]>>({ state: "loading" });
  const [nb, setNb] = useState<Notebook | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<{ q: string; a: ChatTurn }[]>([]);
  const [error, setError] = useState<unknown>(null);

  backRef.current = () => {
    if (nb) {
      setNb(null);
      setTurns([]);
      return true;
    }
    return false;
  };

  const refresh = () => {
    setNbs({ state: "loading" });
    void load(listNotebooks).then((s) => {
      setNbs(s);
      if (s.state === "ready" && s.data.length === 1) setNb(s.data[0]);
    });
  };
  useEffect(refresh, []);

  return (
    <>
      <div className="content">
        {nbs.state === "loading" && <Loading what="notebooks" />}
        {nbs.state === "error" && <ErrorState error={nbs.error} onRetry={refresh} />}
        {nbs.state === "ready" && nbs.data.length === 0 && (
          <Empty text="No equipment notebooks yet — create one on the web hub." />
        )}
        {nbs.state === "ready" && nbs.data.length > 0 && !nb && (
          <>
            <div className="meta" style={{ margin: "8px 0" }}>
              Pick a machine to chat with:
            </div>
            {nbs.data.map((n) => (
              <div key={n.id} className="card" onClick={() => setNb(n)}>
                <h3>{n.displayName}</h3>
              </div>
            ))}
          </>
        )}
        {nb && (
          <>
            <div className="meta" style={{ margin: "8px 0" }}>
              {nb.displayName}
            </div>
            {turns.map((t, i) => (
              <div key={i} className="card">
                <div className="meta">{t.q}</div>
                <div className="chat-answer">{t.a.answer || `(${t.a.status})`}</div>
                <div>
                  {t.a.citations.map((c) => (
                    <span key={c.citationId} className="cite-chip">
                      [{c.citationId}] {c.sourceTitle}
                      {c.page ? ` p.${c.page}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {busy && <div className="empty">Thinking…</div>}
            {error != null && <ErrorState error={error} />}
          </>
        )}
      </div>
      {nb && (
        <div className="composer">
          <input
            placeholder="Ask this machine anything…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className="btn-primary"
            disabled={busy || !q.trim()}
            onClick={async () => {
              const question = q.trim();
              setQ("");
              setBusy(true);
              setError(null);
              try {
                const a = await askNotebook(nb.id, question);
                setTurns((t) => [...t, { q: question, a }]);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Send
          </button>
        </div>
      )}
    </>
  );
}
