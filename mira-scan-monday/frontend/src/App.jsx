import { useEffect, useState } from "react";
import ScanPanel from "./components/ScanPanel.jsx";
import AssetCard from "./components/AssetCard.jsx";
import MiraChat from "./components/MiraChat.jsx";
import UpsellCTA from "./components/UpsellCTA.jsx";
import { getMondayContext } from "./lib/monday.js";
import { kbLookup } from "./lib/api.js";

export default function App() {
  const [mondayCtx, setMondayCtx] = useState(null);
  const [ctxReady, setCtxReady] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  const [plate, setPlate] = useState(null);
  const [kb, setKb] = useState(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const ctx = await getMondayContext();
      setMondayCtx(ctx?.data || ctx || {});
      setSessionToken(ctx?.sessionToken || null);
      setCtxReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!plate?.make && !plate?.model) {
      setKb(null);
      return;
    }
    setLookupBusy(true);
    kbLookup(plate.make, plate.model, sessionToken)
      .then(setKb)
      .catch((err) => {
        console.error("kb lookup failed", err);
        setKb({ matched: false, doc_count: 0 });
      })
      .finally(() => setLookupBusy(false));
  }, [plate, sessionToken]);

  if (!ctxReady) {
    return (
      <div className="app-shell">
        <p className="muted" style={{ padding: "24px 0", textAlign: "center" }}>
          Connecting…
        </p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>MIRA Scan</h1>
        {mondayCtx?.itemId && (
          <span className="muted">Item {mondayCtx.itemId}</span>
        )}
      </header>

      <ScanPanel sessionToken={sessionToken} onResult={setPlate} />

      {plate && (
        <AssetCard
          plate={plate}
          mondayContext={mondayCtx}
          sessionToken={sessionToken}
        />
      )}

      {plate && lookupBusy && <p className="muted">Searching MIRA KB…</p>}

      {plate && kb?.matched && (
        <MiraChat
          assetId={kb.asset_id}
          assetLabel={kb.asset_label}
          sessionToken={sessionToken}
        />
      )}

      {plate && kb && !kb.matched && (
        <UpsellCTA
          plate={plate}
          queued={kb.queued}
          sessionToken={sessionToken}
        />
      )}
    </div>
  );
}
