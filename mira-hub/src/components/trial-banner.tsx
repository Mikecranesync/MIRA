"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { Zap, X } from "lucide-react";
import { useState } from "react";

function daysRemaining(isoDate: string): number {
  const ms = new Date(isoDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function TrialBanner() {
  const { data: session } = useSession();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const status = session?.user?.status;
  const trialExpiresAt = session?.user?.trialExpiresAt;

  if (status !== "trial" || !trialExpiresAt) return null;

  const days = daysRemaining(trialExpiresAt);
  const urgent = days <= 4;

  return (
    <div
      className="w-full px-4 py-2.5 flex items-center justify-between text-sm relative"
      style={{
        backgroundColor: urgent ? "#92400E" : "#1E3A5F",
        borderBottom: `1px solid ${urgent ? "#B45309" : "#1D4ED8"}`,
      }}
    >
      <div className="flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color: urgent ? "#FCD34D" : "#60A5FA" }} />
        <span style={{ color: urgent ? "#FDE68A" : "#BFDBFE" }}>
          {days === 0
            ? "Your free trial has ended."
            : `Free trial: ${days} day${days === 1 ? "" : "s"} remaining`}
        </span>
        <Link
          href="/upgrade"
          className="ml-2 px-3 rounded text-xs font-semibold inline-flex items-center"
          style={{ backgroundColor: urgent ? "#F59E0B" : "#2563EB", color: "#fff", minHeight: 44 }}
        >
          Upgrade
        </Link>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="flex items-center justify-center text-slate-400 hover:text-white transition-colors"
        style={{ minWidth: 44, minHeight: 44, marginLeft: 8 }}
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
