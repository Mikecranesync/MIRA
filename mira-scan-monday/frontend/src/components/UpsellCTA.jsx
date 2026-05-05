import { useEffect, useRef, useState } from "react";
import { Button } from "@vibe/core";
import { queueStatus } from "../lib/api.js";

const POLL_MS = 3000;
const MAX_POLLS = 60; // ~3 minutes ceiling

const TERMINAL_STATUSES = new Set([
  "found",
  "candidate",
  "no_match",
  "failed",
]);

function StatusBox({ status, item, label }) {
  const baseStyle = {
    marginTop: 8,
    padding: "8px 12px",
    borderRadius: 6,
    fontSize: 13,
    lineHeight: 1.4,
  };

  if (!status || status === "pending" || status === "searching") {
    return (
      <div
        style={{
          ...baseStyle,
          background: "var(--ui-background-color, #f0f2f5)",
          color: "var(--secondary-text-color, #676879)",
        }}
      >
        🔍 Searching the open web for a manual for{" "}
        <strong>{label}</strong>…
      </div>
    );
  }

  if (status === "found") {
    return (
      <div
        style={{
          ...baseStyle,
          background: "var(--positive-color-selected, #d6f4e0)",
          color: "var(--positive-color, #00854d)",
        }}
      >
        ✓ Found <strong>{item.notes?.split(" | ")[0] || "a manual"}</strong>.
        Queued for ingest — you should be able to chat about{" "}
        <strong>{label}</strong> in ~10 minutes.
        {item.manual_url && (
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8, wordBreak: "break-all" }}>
            <a href={item.manual_url} target="_blank" rel="noopener noreferrer">
              {item.manual_url}
            </a>
          </div>
        )}
      </div>
    );
  }

  if (status === "candidate") {
    return (
      <div
        style={{
          ...baseStyle,
          background: "#fff5dd",
          color: "#9c6a00",
        }}
      >
        Found a candidate (
        <strong>{item.notes?.split(" | ")[0] || "result"}</strong>) but it
        isn&apos;t a direct PDF — flagged for review.
      </div>
    );
  }

  if (status === "no_match") {
    return (
      <div
        style={{
          ...baseStyle,
          background: "#fde8e8",
          color: "#a8071a",
        }}
      >
        No manual found automatically. Add to FactoryLM for manual sourcing.
      </div>
    );
  }

  // failed
  return (
    <div
      style={{
        ...baseStyle,
        background: "#fde8e8",
        color: "#a8071a",
      }}
    >
      Search failed: {item?.notes || "unknown error"}
    </div>
  );
}

export default function UpsellCTA({ plate, queued, sessionToken }) {
  const signupUrl =
    import.meta.env.VITE_FACTORYLM_SIGNUP_URL ||
    "https://app.factorylm.com/signup";
  const params = new URLSearchParams();
  if (plate?.make) params.set("make", plate.make);
  if (plate?.model) params.set("model", plate.model);
  if (plate?.serial) params.set("serial", plate.serial);
  const href = `${signupUrl}?${params.toString()}`;

  const label = [plate?.make, plate?.model].filter(Boolean).join(" ") || "this asset";

  const [item, setItem] = useState(null);
  const pollsRef = useRef(0);

  useEffect(() => {
    if (!plate?.make || !plate?.model) return undefined;
    pollsRef.current = 0;
    let timer;
    let cancelled = false;

    const tick = async () => {
      pollsRef.current += 1;
      try {
        const res = await queueStatus(sessionToken, plate.make, plate.model);
        const next = res?.items?.[0];
        if (cancelled) return;
        if (next) setItem(next);
        if (next && TERMINAL_STATUSES.has(next.status)) return;
        if (pollsRef.current >= MAX_POLLS) return;
      } catch {
        // Poll quietly; UI will keep showing the previous state.
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [plate?.make, plate?.model, sessionToken]);

  return (
    <div className="card">
      <h3 style={{ margin: 0, fontSize: 16 }}>No manuals on file yet</h3>
      <p className="muted" style={{ marginTop: 4 }}>
        We don&apos;t have OEM documentation for <strong>{label}</strong> in
        the MIRA knowledge base.
      </p>

      <StatusBox status={item?.status} item={item} label={label} />

      {queued && !item && (
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Request #{queued.id}
          {queued.times_seen > 1 ? `, seen ${queued.times_seen}× now` : ""}
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
