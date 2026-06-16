"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, Network, Sparkles } from "lucide-react";
import { API_BASE } from "@/lib/config";

// Sub-tabs for the unified Knowledge section. "Map" is the relationship
// graph; "Suggestions" is the propose/verify queue (MIRA proposes, human
// verifies). Plain-English labels for maintenance technicians.
const TABS = [
  { key: "manuals", label: "Manuals", href: "/knowledge/manuals", Icon: BookOpen },
  { key: "map", label: "Map", href: "/knowledge/map", Icon: Network },
  { key: "suggestions", label: "Suggestions", href: "/knowledge/suggestions", Icon: Sparkles },
] as const;

export function KnowledgeTabs() {
  const pathname = usePathname();
  const [pending, setPending] = useState<number | null>(null);

  // Best-effort pending count for the badge; silent on failure. Uses the cheap
  // count-only mode (#1892) so the badge reflects the REAL pending total —
  // relationship proposals + ai_suggestions — not just the first page of edge
  // proposals (the old `proposals.length` undercounted past 100 and ignored
  // suggestions entirely).
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/proposals/?status=proposed&count=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { pendingTotal?: number } | null) => {
        if (!cancelled && typeof d?.pendingTotal === "number") setPending(d.pendingTotal);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <div
      className="flex gap-1 overflow-x-auto px-2 sm:px-4"
      style={{ borderBottom: "1px solid var(--sidebar-border, #1e293b)" }}
    >
      {TABS.map(({ key, label, href, Icon }) => {
        const active =
          pathname === href || (pathname === "/knowledge" && key === "map");
        return (
          <Link
            key={key}
            href={href}
            className="flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors"
            style={{
              borderBottom: active
                ? "2px solid var(--brand-blue, #2563EB)"
                : "2px solid transparent",
              color: active ? "var(--brand-blue, #2563EB)" : "#94A3B8",
            }}
          >
            <Icon style={{ width: 16, height: 16, flexShrink: 0 }} />
            {label}
            {key === "suggestions" && pending ? (
              <span className="ml-1 rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                {pending}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
