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

// Map of OEM-host substrings → friendly brand name. Picks up subdomains
// (download.beckhoff.com, support.industry.siemens.com, etc.) without
// having to enumerate them.
const OEM_HOSTS = [
  ["beckhoff.com", "Beckhoff"],
  ["rockwellautomation.com", "Rockwell Automation"],
  ["industry.siemens.com", "Siemens"],
  ["siemens.com", "Siemens"],
  ["abb.com", "ABB"],
  ["yaskawa.com", "Yaskawa"],
  ["automationdirect.com", "AutomationDirect"],
  ["se.com", "Schneider Electric"],
  ["schneider-electric.com", "Schneider Electric"],
  ["omron.com", "Omron"],
  ["mitsubishielectric.com", "Mitsubishi Electric"],
  ["danfoss.com", "Danfoss"],
  ["lenze.com", "Lenze"],
  ["sew-eurodrive.com", "SEW-Eurodrive"],
  ["eaton.com", "Eaton"],
  ["fluke.com", "Fluke"],
  ["panduit.com", "Panduit"],
  ["phoenixcontact.com", "Phoenix Contact"],
  ["meanwell.com", "MEAN WELL"],
  ["festo.com", "Festo"],
  ["ifm.com", "ifm"],
];

function brandFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [needle, brand] of OEM_HOSTS) {
      if (host === needle || host.endsWith("." + needle)) return brand;
    }
    // Strip "www." for display
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isOemUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OEM_HOSTS.some(([n]) => host === n || host.endsWith("." + n));
  } catch {
    return false;
  }
}

function titleFromNotes(notes) {
  if (!notes) return null;
  const first = notes.split(" | ")[0]?.trim();
  return first || null;
}

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
    const brand = item.manual_url ? brandFromUrl(item.manual_url) : null;
    const oem = item.manual_url ? isOemUrl(item.manual_url) : false;
    const title = titleFromNotes(item.notes);
    const headline = oem
      ? `${brand} Official Manual`
      : brand
      ? `Manual on ${brand}`
      : "Manual found";

    return (
      <div
        style={{
          ...baseStyle,
          background: "var(--positive-color-selected, #d6f4e0)",
          color: "var(--positive-color, #00854d)",
        }}
      >
        <div style={{ fontWeight: 600 }}>✓ {headline}</div>
        {title && (
          <div style={{ marginTop: 2, fontSize: 12, opacity: 0.85 }}>{title}</div>
        )}
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
          Queued for ingest — chat about <strong>{label}</strong> should
          come online after the next ingest cycle.
        </div>
        {item.manual_url && (
          <div style={{ marginTop: 6 }}>
            <a
              href={item.manual_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--positive-color, #00854d)", fontWeight: 500 }}
            >
              Open manual ↗
            </a>
          </div>
        )}
      </div>
    );
  }

  if (status === "candidate") {
    const title = titleFromNotes(item.notes);
    return (
      <div
        style={{
          ...baseStyle,
          background: "#fff5dd",
          color: "#9c6a00",
        }}
      >
        <div style={{ fontWeight: 600 }}>
          Found a candidate, but it didn&apos;t verify as a PDF
        </div>
        {title && (
          <div style={{ marginTop: 2, fontSize: 12, opacity: 0.85 }}>{title}</div>
        )}
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
          Flagged for human review — not auto-queued for ingest.
        </div>
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
