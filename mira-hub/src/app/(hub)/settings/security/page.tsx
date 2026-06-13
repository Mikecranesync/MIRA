"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// Honest scaffold: rows describe security controls that are planned but not yet
// available. No interactive dead controls — nothing here pretends to work.

const ROWS: { label: string; description: string }[] = [
  { label: "Two-factor authentication", description: "Require a second factor at sign-in." },
  { label: "Single sign-on (SSO)", description: "Sign in with your company identity provider." },
  { label: "Active sessions", description: "Review and revoke signed-in devices." },
  { label: "API keys", description: "Programmatic access tokens for your workspace." },
];

export default function SettingsSecurityPage() {
  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 py-3">
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs mb-1" style={{ color: "var(--foreground-muted)" }}>
            <ChevronLeft className="w-3.5 h-3.5" /> Settings
          </Link>
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Security</h1>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 max-w-2xl mx-auto">
        <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
          {ROWS.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{r.label}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{r.description}</p>
              </div>
              <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-subtle)" }}>
                Not yet available
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
