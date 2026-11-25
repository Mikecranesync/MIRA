"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

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
        <div className="card p-6 text-center">
          <p className="text-sm mb-2" style={{ color: "var(--foreground)" }}>
            Security features are being developed
          </p>
          <p className="text-xs leading-relaxed" style={{ color: "var(--foreground-muted)" }}>
            Two-factor authentication, single sign-on, session management, and API keys will be available in a future release.
            For security questions or to request early access, contact support.
          </p>
        </div>
      </div>
    </div>
  );
}
