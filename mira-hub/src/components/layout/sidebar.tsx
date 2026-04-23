"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, ClipboardList, Wrench, Calendar,
  MessageSquare, Package, FileText, BarChart2, Users, Settings,
  Factory,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/providers/access-control";

const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard, ClipboardList, Wrench, Calendar,
  MessageSquare, Package, FileText, BarChart2, Users, Settings,
};

export function Sidebar({ role = "admin" }: { role?: string }) {
  const pathname = usePathname();

  const visible = NAV_ITEMS.filter((item) =>
    (item.roles as readonly string[]).includes(role)
  );

  return (
    <aside className="hidden md:flex flex-col w-60 h-screen bg-[--sidebar-background] text-[--sidebar-foreground] fixed left-0 top-0 z-40">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-[--sidebar-border]">
        <Factory className="w-7 h-7 text-blue-400" />
        <span className="font-bold text-lg tracking-tight">FactoryLM</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {visible.map((item) => {
          const Icon = ICON_MAP[item.icon] ?? Settings;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-[--sidebar-accent] text-white"
                  : "text-slate-400 hover:bg-[--sidebar-accent] hover:text-white"
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[--sidebar-border]">
        <div className="flex items-center gap-3 px-2">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">MH</div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">Mike Harper</p>
            <p className="text-xs text-slate-400 truncate capitalize">{role}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
