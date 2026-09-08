"use client";

import { useEffect, useMemo, useState } from "react";
import { NAV_ITEMS, labsEnabled } from "@/providers/access-control";
import { API_BASE } from "@/lib/config";

/**
 * The `More ›` destinations.
 *
 * The V3 shell reduces 13 primary nav items to 5 plus `More ›` (2026-09-07 UX
 * recon: a category ceiling of 5-6, against ChatGPT 5 / Claude 5 / Gemini 6).
 * That reduction shipped before its destination did, so `More ›` was a row
 * advertising a submenu that did not exist — worse than the 13 items it
 * replaced, because it breaks a promise the interface makes.
 *
 * Driven by `NAV_ITEMS`, deliberately. The Hub already carries TWO nav
 * definitions — `NAV_ITEMS` and a hand-written `MORE_ITEMS` array in
 * `(hub)/more/page.tsx` which has already drifted (missing Command Center,
 * Namespace, Notebooks, Visual Workspace, PLC Import). A third hand-written
 * list here would drift the same way, so this reads the canonical one.
 *
 * Gating is server-authoritative: role and capabilities come from `/api/me`,
 * the same contract the Hub nav and mobile screens consume. A row appears only
 * when the caller's role is listed AND any declared capability is held. The
 * destination re-checks server-side regardless — this is presentation, never
 * enforcement (#1932: the nav once offered what the API then refused).
 */

type Me = { role?: string; capabilities?: string[] };

/** Words a technician already uses, replacing invented vocabulary the recon
 *  flagged. Anything absent keeps its existing label. */
const PLAIN_LABEL: Record<string, string> = {
  knowledge: "Manuals",
  namespace: "Equipment map",
  workorders: "Work orders",
  ctx: "Import mapping",
  "ctx-review": "Import review",
};

export function moreDestinations(me: Me, labs: boolean) {
  const role = me.role ?? "";
  const caps = new Set(me.capabilities ?? []);
  return NAV_ITEMS.filter((item) => {
    // The 5 primary items live in the sidebar; More carries the rest.
    if (item.group === "primary") return false;
    // Labs are mock-data surfaces, hidden on prod builds. Never offer a
    // destination backed by fixtures as though it were real.
    if (item.group === "labs" && !labs) return false;
    if (!item.roles.includes(role as never)) return false;
    const cap = (item as { capability?: string }).capability;
    if (cap && !caps.has(cap)) return false;
    return true;
  }).map((item) => ({
    key: item.key,
    href: item.href,
    label: PLAIN_LABEL[item.key] ?? item.label,
  }));
}

export default function MoreSheet({ onClose }: { onClose: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/api/me`, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setMe(d as Me))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const items = useMemo(() => (me ? moreDestinations(me, labsEnabled()) : []), [me]);

  return (
    <div className="v3-sheet" role="dialog" aria-modal="true" aria-label="More destinations">
      <div className="v3-sheet__head">
        <b>More</b>
        <button className="v3-icon" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      {failed && (
        // Plain language, and it says what still works. Never a status code.
        <p className="v3-sheet__note">Couldn&apos;t load your destinations. Everything else still works.</p>
      )}
      {!failed && !me && <p className="v3-sheet__note">Loading…</p>}
      {me && items.length === 0 && (
        <p className="v3-sheet__note">Nothing else is available for your role.</p>
      )}
      <nav className="v3-sheet__list">
        {items.map((i) => (
          <a key={i.key} className="v3-item" href={`${API_BASE}${i.href}`}>{i.label}</a>
        ))}
      </nav>
    </div>
  );
}
