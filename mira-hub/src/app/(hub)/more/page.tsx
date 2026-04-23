"use client";

import Link from "next/link";
import {
  Calendar, MessageSquare, FileText, BarChart2,
  Users, Settings, Database, ChevronRight,
} from "lucide-react";
import { useTranslations } from "next-intl";

export default function MorePage() {
  const t = useTranslations("more");
  const tNav = useTranslations("nav");

  const MORE_ITEMS = [
    { label: tNav("schedule"),  desc: t("items.schedule"),  Icon: Calendar,      href: "/schedule" },
    { label: tNav("requests"),  desc: t("items.requests"),  Icon: MessageSquare, href: "/requests" },
    { label: tNav("documents"), desc: t("items.documents"), Icon: FileText,      href: "/documents" },
    { label: tNav("cmms"),      desc: t("items.cmms"),      Icon: Database,      href: "/cmms" },
    { label: tNav("reports"),   desc: t("items.reports"),   Icon: BarChart2,     href: "/reports" },
    { label: tNav("team"),      desc: t("items.team"),      Icon: Users,         href: "/team" },
    { label: tNav("admin"),     desc: t("items.admin"),     Icon: Settings,      href: "/admin/users" },
  ];

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 pt-3 pb-3">
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-2">
        {MORE_ITEMS.map(({ label, desc, Icon, href }) => (
          <Link key={href} href={href}
            className="card p-4 flex items-center gap-4 hover:bg-[var(--surface-1)] transition-colors block">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: "var(--surface-1)" }}>
              <Icon className="w-5 h-5" style={{ color: "var(--brand-blue)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{label}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{desc}</p>
            </div>
            <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
