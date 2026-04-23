"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardList, MessageSquare, Package, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const MOBILE_TABS = [
  { label: "Feed",    icon: LayoutDashboard, href: "/feed" },
  { label: "Orders",  icon: ClipboardList,   href: "/workorders" },
  { label: "Request", icon: MessageSquare,   href: "/requests" },
  { label: "Parts",   icon: Package,         href: "/parts" },
  { label: "More",    icon: Settings,        href: "/admin/users" },
];

export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[--sidebar-background] border-t border-[--sidebar-border] flex">
      {MOBILE_TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
              active ? "text-blue-400" : "text-slate-500"
            )}
          >
            <tab.icon className="w-5 h-5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
