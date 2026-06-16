import { useState } from "react";
import { Button } from "@vibe/core";
import { chatMessage } from "../lib/api.js";

export default function MiraChat({ assetId, assetLabel, sessionToken }) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...history, { role: "user", content: text }];
    setHistory(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await chatMessage(
        text,
        assetId,
        history,
        sessionToken,
        assetLabel,
      );
      setHistory([
        ...next,
        { role: "assistant", content: res.reply, sources: res.sources || [] },
      ]);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 style={{ margin: 0, fontSize: 16 }}>Ask MIRA</h3>
      <p className="muted" style={{ marginTop: 4 }}>
        Ask questions about fault codes, procedures, and parameters for this asset.
      </p>
      <div className="chat-log" role="log">
        {history.length === 0 && (
          <div className="muted">
            Try: "What's the bearing replacement procedure?" or "What does fault
            code F12 mean?"
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            <div>{m.content}</div>
            {m.sources?.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {m.sources.map((s, j) => (
                  <span key={j} className="source-tag">
                    {s.title}
                    {s.page ? ` p.${s.page}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <form
        className="row"
        style={{ marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          className="text-input"
          placeholder="Ask about this asset…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--ui-border-color, #c3c6d4)", fontSize: 14 }}
        />
        <Button type="submit" disabled={busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </Button>
      </form>
      {error && (
        <p style={{ color: "var(--negative-color, #d83a52)", marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
