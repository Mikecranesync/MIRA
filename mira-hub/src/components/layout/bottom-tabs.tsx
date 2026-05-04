"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Activity, Zap, Radio, Users, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileDrawer } from "./mobile-drawer";

export function BottomTabs() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const MOBILE_TABS = [
    { label: t("eventLog"), Icon: Activity, href: "/event-log" },
    { label: t("channels"), Icon: Radio,    href: "/channels"  },
    { label: t("actions"),  Icon: Zap,      href: "/actions"   },
    { label: t("team"),     Icon: Users,    href: "/team"      },
  ];

  return (
    <>
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

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
          const active = pathname === tab.href || (tab.href !== "/" && pathname.startsWith(tab.href));
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-1 transition-colors"
              style={{ color: active ? "#2563EB" : "#64748B", minHeight: "var(--min-touch)" }}
            >
              <tab.Icon
                className={cn("transition-transform", active ? "scale-110" : "scale-100")}
                style={{ width: 20, height: 20 }}
              />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}

        {/* More — opens drawer */}
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label={t("more")}
          className="flex-1 flex flex-col items-center justify-center gap-1 py-1 transition-colors"
          style={{ color: drawerOpen ? "#2563EB" : "#64748B", minHeight: "var(--min-touch)" }}
        >
          <MoreHorizontal
            className={cn("transition-transform", drawerOpen ? "scale-110" : "scale-100")}
            style={{ width: 20, height: 20 }}
          />
          <span className="text-[10px] font-medium">{t("more")}</span>
        </button>
      </nav>
    </>
  );
}
