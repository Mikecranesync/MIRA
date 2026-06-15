"use client";

import Link from "next/link";
import { ChevronLeft, Check, Minus } from "lucide-react";

// The REAL access model, mirroring src/lib/capabilities.ts. There is no
// fine-grained per-user RBAC yet, so this honestly describes the two access
// tiers that exist today and what each can do — no fabricated user counts.
//
// Keep in sync with getCapabilities() in src/lib/capabilities.ts.

type Tier = { key: string; label: string; description: string };

const TIERS: Tier[] = [
  {
    key: "member",
    label: "Workspace member",
    description: "Anyone signed in to your workspace. Read access to your own tenant's settings, team, usage, integrations, and audit log.",
  },
  {
    key: "platform",
    label: "FactoryLM admin",
    description: "FactoryLM staff. Adds the cross-workspace review queue and platform user administration.",
  },
];

type Capability = { key: string; label: string; member: boolean; platform: boolean };

const CAPABILITIES: Capability[] = [
  { key: "workspace.read", label: "View workspace settings", member: true, platform: true },
  { key: "team.read", label: "View workspace users", member: true, platform: true },
  { key: "usage.read", label: "View usage & activity", member: true, platform: true },
  { key: "integrations.read", label: "View integrations", member: true, platform: true },
  { key: "audit_log.read", label: "View audit log", member: true, platform: true },
  { key: "review_queue.read", label: "View review queue", member: false, platform: true },
  { key: "review_queue.decide", label: "Decide on review items", member: false, platform: true },
  { key: "platform.users.read", label: "Platform user administration", member: false, platform: true },
];

function Cell({ on }: { on: boolean }) {
  return on
    ? <Check className="w-4 h-4 mx-auto" style={{ color: "#16A34A" }} />
    : <Minus className="w-3 h-3 mx-auto" style={{ color: "var(--foreground-subtle)", opacity: 0.4 }} />;
}

export default function SettingsRolesPage() {
  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 py-3">
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs mb-1" style={{ color: "var(--foreground-muted)" }}>
            <ChevronLeft className="w-3.5 h-3.5" /> Settings
          </Link>
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Roles &amp; Permissions</h1>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 max-w-3xl mx-auto space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TIERS.map((t) => (
            <div key={t.key} className="card p-4">
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{t.label}</h2>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--foreground-muted)" }}>{t.description}</p>
            </div>
          ))}
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead style={{ backgroundColor: "var(--surface-1)", borderBottom: "1px solid var(--border)" }}>
              <tr>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--foreground-muted)", minWidth: 200 }}>Capability</th>
                <th className="px-3 py-3 text-center font-semibold" style={{ color: "var(--foreground-muted)" }}>Workspace member</th>
                <th className="px-3 py-3 text-center font-semibold" style={{ color: "var(--foreground-muted)" }}>FactoryLM admin</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <tr key={c.key} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-2.5" style={{ color: "var(--foreground-muted)" }}>{c.label}</td>
                  <td className="px-3 py-2.5 text-center"><Cell on={c.member} /></td>
                  <td className="px-3 py-2.5 text-center"><Cell on={c.platform} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
          Fine-grained per-user roles are coming soon. Today, everyone in your workspace is a member;
          FactoryLM administrators have the additional platform capabilities shown above.
        </p>
      </div>
    </div>
  );
}
