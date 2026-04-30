"use client";

import Link from "next/link";
import {
  MessageSquare, AlertTriangle, BookOpen, Wrench,
  ClipboardList, CalendarDays, Inbox, Package, FileText,
  TrendingUp, Radio, Plug, BarChart2, Users, Settings, ChevronRight, Download,
} from "lucide-react";
import { useTranslations } from "next-intl";

export default function MorePage() {
  const t = useTranslations("more");
  const tNav = useTranslations("nav");

  const MORE_ITEMS = [
    { label: tNav("conversations"), desc: t("items.conversations"), Icon: MessageSquare, href: "/conversations" },
    { label: tNav("alerts"),        desc: t("items.alerts"),        Icon: AlertTriangle, href: "/alerts" },
    { label: tNav("knowledge"),     desc: t("items.knowledge"),     Icon: BookOpen,      href: "/knowledge" },
    { label: tNav("assets"),        desc: t("items.assets"),        Icon: Wrench,        href: "/assets" },
    { label: tNav("workOrders"),    desc: t("items.workorders"),    Icon: ClipboardList, href: "/workorders" },
    { label: tNav("schedule"),      desc: t("items.schedule"),      Icon: CalendarDays,  href: "/schedule" },
    { label: tNav("requests"),      desc: t("items.requests"),      Icon: Inbox,         href: "/requests" },
    { label: tNav("parts"),         desc: t("items.parts"),         Icon: Package,       href: "/parts" },
    { label: tNav("documents"),     desc: t("items.documents"),     Icon: FileText,      href: "/documents" },
    { label: tNav("reports"),       desc: t("items.reports"),       Icon: TrendingUp,    href: "/reports" },
    { label: tNav("channels"),      desc: t("items.channels"),      Icon: Radio,         href: "/channels" },
    { label: tNav("integrations"),  desc: t("items.integrations"),  Icon: Plug,          href: "/integrations" },
    { label: tNav("usage"),         desc: t("items.usage"),         Icon: BarChart2,     href: "/usage" },
    { label: tNav("team"),          desc: t("items.team"),          Icon: Users,         href: "/team" },
    { label: tNav("admin"),         desc: t("items.admin"),         Icon: Settings,      href: "/admin/users" },
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

        <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <a href="/api/export" download
            className="card p-4 flex items-center gap-4 hover:bg-[var(--surface-1)] transition-colors block">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: "var(--surface-1)" }}>
              <Download className="w-5 h-5" style={{ color: "var(--brand-blue)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{t("exportData.label")}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{t("exportData.desc")}</p>
            </div>
            <Download className="w-4 h-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
          </a>
        </div>
      </div>
    </div>
  );
}
