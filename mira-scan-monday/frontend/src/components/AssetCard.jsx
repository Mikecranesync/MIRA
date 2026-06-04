import { Button } from "@vibe/core";
import { mondayUpdateItem } from "../lib/api.js";
import { redirectToInstall } from "../lib/monday.js";
import { useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const FIELDS = [
  ["make", "Make"],
  ["model", "Model"],
  ["serial", "Serial"],
  ["voltage", "Voltage"],
  ["hp", "HP"],
  ["rpm", "RPM"],
  ["hz", "Hz"],
  ["frame", "Frame"],
];

export default function AssetCard({ plate, mondayContext, sessionToken }) {
  const [savedId, setSavedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const canSave = !!(mondayContext?.itemId && mondayContext?.boardId);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const columns = {};
      for (const [k] of FIELDS) {
        if (plate[k]) columns[k] = String(plate[k]);
      }
      const res = await mondayUpdateItem(
        mondayContext.boardId,
        mondayContext.itemId,
        columns,
        sessionToken
      );
      if (res.ok) {
        setSavedId(res.monday_item_id);
      } else if (typeof res.error === "string" && res.error.startsWith("reinstall_required")) {
        // Backend says the per-account OAuth token was revoked. Bounce
        // the user through the install flow so monday issues a fresh one.
        redirectToInstall(API_BASE_URL);
        return;
      } else {
        setSaveError(res.error || "Save failed");
      }
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const conf = Math.round((plate.confidence || 0) * 100);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Extracted specs</h3>
        <span
          className="muted confidence"
          title="Vision model self-reported confidence"
        >
          {conf}% confidence
        </span>
      </div>
      <dl className="spec-grid">
        {FIELDS.map(([k, label]) => (
          <div key={k}>
            <dt>{label}</dt>
            <dd>{plate[k] || <span className="muted">—</span>}</dd>
          </div>
        ))}
      </dl>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <Button onClick={handleSave} disabled={!canSave || saving}>
          {saving ? "Saving…" : "Save to monday item"}
        </Button>
        {savedId && (
          <span className="muted">Saved (item {savedId}).</span>
        )}
        {saveError && (
          <span style={{ color: "var(--negative-color, #d83a52)" }}>
            {saveError}
          </span>
        )}
      </div>
    </div>
  );
}
