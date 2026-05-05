import { Button } from "@vibe/core";

export default function UpsellCTA({ plate, queued }) {
  const signupUrl =
    import.meta.env.VITE_FACTORYLM_SIGNUP_URL ||
    "https://app.factorylm.com/signup";
  const params = new URLSearchParams();
  if (plate?.make) params.set("make", plate.make);
  if (plate?.model) params.set("model", plate.model);
  if (plate?.serial) params.set("serial", plate.serial);
  const href = `${signupUrl}?${params.toString()}`;

  const label = [plate?.make, plate?.model].filter(Boolean).join(" ") || "this asset";

  return (
    <div className="card">
      <h3 style={{ margin: 0, fontSize: 16 }}>No manuals on file yet</h3>
      <p className="muted" style={{ marginTop: 4 }}>
        We don&apos;t have OEM documentation for <strong>{label}</strong> in
        the MIRA knowledge base.
      </p>

      {queued ? (
        <div
          style={{
            marginTop: 8,
            padding: "8px 12px",
            background: "var(--positive-color-selected, #d6f4e0)",
            color: "var(--positive-color, #00854d)",
            borderRadius: 6,
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          ✓ Queued an automatic manual search (request #{queued.id}
          {queued.times_seen > 1 ? `, seen ${queued.times_seen}× now` : ""}).
          Check back in a few hours — the next ingest cycle runs every 6
          hours.
        </div>
      ) : (
        <div
          className="muted"
          style={{ marginTop: 8, fontSize: 13, lineHeight: 1.4 }}
        >
          Couldn&apos;t reach the request queue right now — try again, or skip
          straight to FactoryLM below.
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 12 }}>
        <Button onClick={() => window.open(href, "_blank", "noopener,noreferrer")}>
          Add to FactoryLM for instant access
        </Button>
      </div>
    </div>
  );
}
