"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/config";
import Link from "next/link";
import {
  Building2, Users, Shield, Lock, Plug, BarChart2, ScrollText, Inbox, KeyRound,
} from "lucide-react";

type Me = {
  name: string;
  email: string;
  role: string;
  status: string;
  capabilities?: string[];
};

type Card = {
  title: string;
  description: string;
  href: string;
  icon: React.ElementType;
  /** When set, the card renders only if the user has this capability. */
  capability?: string;
};

const CARDS: Card[] = [
  { title: "Organization", description: "Workspace name, plan, and trial status.", href: "/settings/organization", icon: Building2 },
  { title: "Users", description: "People in your workspace and their roles.", href: "/settings/users", icon: Users },
  { title: "Roles & Permissions", description: "What each role and access tier can do.", href: "/settings/roles", icon: Shield },
  { title: "Security", description: "Sign-in, sessions, and API access.", href: "/settings/security", icon: Lock },
  { title: "Integrations", description: "CMMS, webhooks, and connected systems.", href: "/settings/integrations", icon: Plug },
  { title: "Usage", description: "Activity and consumption for your workspace.", href: "/settings/usage", icon: BarChart2 },
  { title: "Audit Log", description: "Recent events across your workspace.", href: "/settings/audit-log", icon: ScrollText },
  { title: "Review Queue", description: "Pending proposals and findings to review.", href: "/settings/review-queue", icon: Inbox, capability: "review_queue.read" },
  { title: "API Keys", description: "Programmatic access tokens for the i3X API.", href: "/settings/api-keys", icon: KeyRound },
];

export default function SettingsIndexPage() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/me/`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Me | null) => d && setMe(d))
      .catch(() => {});
  }, []);

  const caps = me?.capabilities ?? [];
  const cards = CARDS.filter((c) => !c.capability || caps.includes(c.capability));

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 py-3">
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Settings</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
            Manage your workspace{me?.name ? ` · ${me.name}` : ""}
          </p>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <Link key={c.href} href={c.href} className="card p-4 transition-colors hover:bg-[var(--surface-1)]" data-testid={`settings-card-${c.href.split("/").pop()}`}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ backgroundColor: "var(--surface-1)" }}>
                  <Icon className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
                </div>
                <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{c.title}</h2>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--foreground-muted)" }}>{c.description}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
