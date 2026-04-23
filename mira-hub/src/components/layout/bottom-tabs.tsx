"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, ClipboardList, Plus, Wrench, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export function BottomTabs() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  const MOBILE_TABS = [
    { label: t("feed"),       Icon: LayoutDashboard, href: "/feed",            fab: false },
    { label: t("assets"),     Icon: Wrench,          href: "/assets",          fab: false },
    { label: "",              Icon: Plus,            href: "/workorders/new",  fab: true  },
    { label: t("workOrders"), Icon: ClipboardList,   href: "/workorders",      fab: false },
    { label: t("more"),       Icon: MoreHorizontal,  href: "/more",            fab: false },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center"
      style={{
        height: "var(--bottom-tab-height)",
        backgroundColor: "var(--sidebar-bg)",
        borderTop: "1px solid var(--sidebar-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {MOBILE_TABS.map((tab) => {
        if (tab.fab) {
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex-1 flex justify-center items-center"
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center -mt-4 shadow-lg"
                style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}
              >
                <tab.Icon className="w-5 h-5 text-white" />
              </div>
            </Link>
          );
        }

        const active = pathname === tab.href || (tab.href !== "/" && pathname.startsWith(tab.href));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-1 transition-colors"
            style={{ color: active ? "#2563EB" : "#64748B", minHeight: "var(--min-touch)" }}
          >
            <tab.Icon className={cn("transition-transform", active ? "scale-110" : "scale-100")}
              style={{ width: 20, height: 20 }} />
            <span className="text-[10px] font-medium">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
