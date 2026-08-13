// Walking-skeleton shell (ADR-0034 Phase 2): login → assets → asset detail →
// chat → sign out, plus deep-link routing. Deliberately a tiny state router —
// the Phase-3 five-tab shell replaces it.
import { useEffect, useState } from "react";
import {
  getMe,
  signIn,
  signOut,
  listAssets,
  getAsset,
  getAssetByTag,
  listNotebooks,
  askNotebook,
  type Me,
  type Asset,
  type Notebook,
  type ChatTurn,
} from "./api";

type Route =
  | { name: "login" }
  | { name: "assets" }
  | { name: "asset"; id: string }
  | { name: "chat" }
  | { name: "tag"; tag: string; error?: string };

let navigate: (r: Route) => void = () => {};

/** Hub extractAssetTag semantics: full URL | /m/<TAG> path | raw tag. */
export function extractAssetTag(input: string): string | null {
  const s = input.trim();
  const m = s.match(/(?:^|\/m\/)([A-Za-z0-9][A-Za-z0-9._-]{1,63})\/?$/);
  if (!m) return null;
  // Reject foreign absolute URLs that aren't ours (trust boundary).
  if (/^[a-z]+:\/\//i.test(s)) {
    const ok =
      s.startsWith("https://app.factorylm.com/m/") ||
      s.startsWith("factorylm://m/");
    if (!ok) return null;
  }
  return m[1];
}

export function handleDeepLink(url: string): void {
  const tag = extractAssetTag(url);
  navigate(
    tag ? { name: "tag", tag } : { name: "tag", tag: "", error: `Unrecognized link: ${url}` },
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [booted, setBooted] = useState(false);
  const [route, setRoute] = useState<Route>({ name: "login" });
  navigate = setRoute;

  useEffect(() => {
    void (async () => {
      const m = await getMe(); // persisted session → skip login
      setMe(m);
      setBooted(true);
      if (m) setRoute((r) => (r.name === "login" ? { name: "assets" } : r));
    })();
  }, []);

  if (!booted) return <Splash />;
  if (!me && route.name !== "tag")
    return (
      <Login
        onSignedIn={async () => {
          setMe(await getMe());
          setRoute({ name: "assets" });
        }}
      />
    );

  return (
    <div className="shell">
      <div className="topbar">
        <span>
          FactoryLM <small>{me ? me.email : "signed out"}</small>
        </span>
        {me && (
          <button
            className="btn-link"
            onClick={async () => {
              await signOut();
              setMe(null);
              setRoute({ name: "login" });
            }}
          >
            Sign out
          </button>
        )}
      </div>
      {route.name === "assets" && me && (
        <Assets me={me} onOpen={(id) => setRoute({ name: "asset", id })} onChat={() => setRoute({ name: "chat" })} />
      )}
      {route.name === "asset" && (
        <AssetDetail id={route.id} onBack={() => setRoute({ name: "assets" })} />
      )}
      {route.name === "chat" && <Chat onBack={() => setRoute({ name: "assets" })} />}
      {route.name === "tag" && (
        <TagLanding
          tag={route.tag}
          error={route.error}
          authed={Boolean(me)}
          onOpen={(id) => setRoute({ name: "asset", id })}
          onHome={() => setRoute(me ? { name: "assets" } : { name: "login" })}
        />
      )}
    </div>
  );
}

function Splash() {
  return <div className="empty">FactoryLM…</div>;
}

function Login({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="shell">
      <div className="topbar">FactoryLM</div>
      <div className="content bottompad">
        <div className="card">
          <h3>Sign in</h3>
          <label>Email</label>
          <input
            inputMode="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div style={{ marginTop: 14 }}>
            <button
              className="btn-primary"
              disabled={busy || !email || !password}
              onClick={async () => {
                setBusy(true);
                setError("");
                const r = await signIn(email, password);
                setBusy(false);
                if (r.ok) await onSignedIn();
                else setError(r.error ?? "sign-in failed");
              }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

function Assets({
  me,
  onOpen,
  onChat,
}: {
  me: Me;
  onOpen: (id: string) => void;
  onChat: () => void;
}) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  useEffect(() => {
    void listAssets().then(setAssets);
  }, []);
  return (
    <div className="content bottompad">
      <button className="btn-primary" onClick={onChat} style={{ marginBottom: 12 }}>
        Open Chat
      </button>
      {assets === null && <div className="empty">Loading assets…</div>}
      {assets?.length === 0 && <div className="empty">No assets yet in this workspace.</div>}
      {assets?.map((a) => (
        <div key={a.id} className="card" onClick={() => onOpen(a.id)}>
          <h3>{a.name || a.model_number || a.id}</h3>
          <div className="meta">
            {[a.manufacturer, a.model_number, a.equipment_number]
              .filter(Boolean)
              .join(" · ") || a.equipment_type || "asset"}
          </div>
        </div>
      ))}
      <div className="meta" style={{ marginTop: 16, textAlign: "center" }}>
        role: {me.role || "(none — least privilege)"} · {me.capabilities.length} capabilities
      </div>
    </div>
  );
}

function AssetDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [asset, setAsset] = useState<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => {
    void getAsset(id).then((a) => setAsset(a));
  }, [id]);
  const a = (asset as { asset?: Record<string, unknown> } | null | undefined)?.asset ?? asset;
  return (
    <div className="content bottompad">
      <button className="btn-link" onClick={onBack}>
        ← Assets
      </button>
      {asset === undefined && <div className="empty">Loading…</div>}
      {asset === null && <div className="empty">Asset not found (or no access).</div>}
      {a && asset !== null && (
        <div className="card">
          <h3>{String((a as Record<string, unknown>).name ?? id)}</h3>
          <div className="meta">
            {["manufacturer", "model_number", "equipment_type", "equipment_number", "uns_path"]
              .map((k) => (a as Record<string, unknown>)[k])
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      )}
    </div>
  );
}

function Chat({ onBack }: { onBack: () => void }) {
  const [nbs, setNbs] = useState<Notebook[] | null>(null);
  const [nb, setNb] = useState<Notebook | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<{ q: string; a: ChatTurn }[]>([]);
  useEffect(() => {
    void listNotebooks().then((list) => {
      setNbs(list);
      if (list.length === 1) setNb(list[0]);
    });
  }, []);
  return (
    <>
      <div className="content">
        <button className="btn-link" onClick={onBack}>
          ← Assets
        </button>
        {nbs === null && <div className="empty">Loading notebooks…</div>}
        {nbs?.length === 0 && <div className="empty">No equipment notebooks yet.</div>}
        {nbs && nbs.length > 0 && !nb && (
          <>
            {nbs.map((n) => (
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
              const a = await askNotebook(nb.id, question);
              setTurns((t) => [...t, { q: question, a }]);
              setBusy(false);
            }}
          >
            Send
          </button>
        </div>
      )}
    </>
  );
}

function TagLanding({
  tag,
  error,
  authed,
  onOpen,
  onHome,
}: {
  tag: string;
  error?: string;
  authed: boolean;
  onOpen: (id: string) => void;
  onHome: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "notfound" | "unauth">("idle");
  useEffect(() => {
    if (!tag || error) return;
    if (!authed) {
      setState("unauth");
      return;
    }
    setState("loading");
    void getAssetByTag(tag).then((a) => {
      if (a?.id) onOpen(a.id);
      else setState("notfound");
    });
  }, [tag, error, authed]);
  return (
    <div className="content bottompad">
      {error && <div className="empty">{error}</div>}
      {state === "unauth" && (
        <div className="empty">Sign in to open asset “{tag}”.</div>
      )}
      {state === "loading" && <div className="empty">Resolving {tag}…</div>}
      {state === "notfound" && (
        <div className="empty">No asset with tag “{tag}” in this workspace.</div>
      )}
      <button onClick={onHome} style={{ marginTop: 16 }}>
        Continue
      </button>
    </div>
  );
}
