"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type Me = {
  name: string;
  email: string;
  role: string;
  status: string;
  tenantId: string;
};

const STATUS_LABEL: Record<string, string> = {
  admin: "Admin",
  approved: "Approved",
  trial: "Trial",
  pending: "Pending",
  expired: "Expired",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: "var(--border)" }}>
      <span className="text-sm" style={{ color: "var(--foreground-muted)" }}>{label}</span>
      <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{value}</span>
    </div>
  );
}

export default function OrganizationSettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Me | null) => setMe(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 py-3">
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs mb-1" style={{ color: "var(--foreground-muted)" }}>
            <ChevronLeft className="w-3.5 h-3.5" /> Settings
          </Link>
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Organization</h1>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 max-w-2xl mx-auto">
        {loading ? (
          <p className="text-sm" style={{ color: "var(--foreground-subtle)" }}>Loading…</p>
        ) : (
          <div className="card p-4">
            <Row label="Workspace ID" value={me?.tenantId ?? "—"} />
            <Row label="Plan / status" value={me ? (STATUS_LABEL[me.status] ?? me.status) : "—"} />
            <Row label="Primary contact" value={me?.email ?? "—"} />
            <div className="pt-3">
              <p className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                Editing workspace details isn&apos;t available yet. Contact support to change your plan or workspace name.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
