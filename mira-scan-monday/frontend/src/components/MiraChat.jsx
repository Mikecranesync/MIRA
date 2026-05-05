import { useState } from "react";
import { Button, TextField } from "@mondaydotcomorg/vibe";
import { chatMessage } from "../lib/api.js";

export default function MiraChat({ assetId, sessionToken }) {
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
      const res = await chatMessage(text, assetId, history, sessionToken);
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
        Grounded in the OEM manual for this asset.
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
      <div className="row" style={{ marginTop: 8 }}>
        <div style={{ flex: 1 }}>
          <TextField
            placeholder="Ask about this asset…"
            value={input}
            onChange={setInput}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
        </div>
        <Button onClick={send} disabled={busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </Button>
      </div>
      {error && (
        <p style={{ color: "var(--negative-color, #d83a52)", marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
