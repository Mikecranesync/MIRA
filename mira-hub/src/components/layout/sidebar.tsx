"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Activity, MessageSquare, Zap, AlertTriangle, BookOpen,
  Wrench, Radio, Plug, BarChart2, Users, Settings,
  ClipboardList, CalendarDays, Inbox, Package, FileText, TrendingUp,
  Factory, ChevronLeft, ChevronRight, LogOut, Sun, Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/providers/access-control";
import { useTheme } from "@/providers/theme-provider";
import { LanguageSelector } from "@/components/ui/language-selector";

const ICON_MAP: Record<string, React.ElementType> = {
  Activity, MessageSquare, Zap, AlertTriangle, BookOpen,
  Wrench, Radio, Plug, BarChart2, Users, Settings,
  ClipboardList, CalendarDays, Inbox, Package, FileText, TrendingUp,
};

type NavItemProps = {
  item: { key: string; icon: string; href: string };
  collapsed: boolean;
  active: boolean;
  label: string;
};

function NavItem({ item, collapsed, active, label }: NavItemProps) {
  const Icon = ICON_MAP[item.icon] ?? Settings;
  return (
    <Link
      href={item.href}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center rounded-lg text-sm font-medium transition-all duration-150",
        collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5"
      )}
      style={{
        backgroundColor: active ? "var(--sidebar-active)" : "transparent",
        color: active ? "white" : "#94A3B8",
      }}
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.backgroundColor = "var(--sidebar-hover)";
        if (!active) (e.currentTarget.querySelector(".nav-label") as HTMLElement | null)?.style.setProperty("color", "white");
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.backgroundColor = "transparent";
        if (!active) (e.currentTarget.querySelector(".nav-label") as HTMLElement | null)?.style.setProperty("color", "#94A3B8");
      }}
    >
      <Icon style={{ width: 18, height: 18, flexShrink: 0 }} />
      {!collapsed && <span className="nav-label text-sm">{label}</span>}
      {collapsed && active && (
        <span className="absolute left-0 w-0.5 h-5 rounded-r-full"
          style={{ backgroundColor: "var(--brand-blue)" }} />
      )}
    </Link>
  );
}

type MeData = { name: string; initials: string; role: string };

export function Sidebar({ role = "admin" }: { role?: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const t = useTranslations("nav");
  const tTheme = useTranslations("theme");
  const [me, setMe] = useState<MeData | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then(r => r.ok ? r.json() : null)
      .then((d: MeData | null) => d && setMe(d))
      .catch(() => {});
  }, []);

  const visible = NAV_ITEMS.filter((item) =>
    (item.roles as readonly string[]).includes(role)
  );
  const primary   = visible.filter((item) => item.group === "primary");
  const secondary = visible.filter((item) => item.group === "secondary");

  function navLabel(key: string): string {
    const map: Record<string, string> = {
      "event-log":     t("eventLog"),
      "conversations": t("conversations"),
      "actions":       t("actions"),
      "alerts":        t("alerts"),
      "knowledge":     t("knowledge"),
      "assets":        t("assets"),
      "channels":      t("channels"),
      "integrations":  t("integrations"),
      "usage":         t("usage"),
      "team":          t("team"),
      "workorders":    t("workOrders"),
      "schedule":      t("schedule"),
      "requests":      t("requests"),
      "parts":         t("parts"),
      "documents":     t("documents"),
      "reports":       t("reports"),
      "admin/users":   t("admin"),
      "admin/roles":   t("admin"),
    };
    return map[key] ?? key;
  }

  return (
    <aside
      className="hidden md:flex flex-col h-screen fixed left-0 top-0 z-40 transition-all duration-200"
      style={{
        width: collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)",
        backgroundColor: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-4"
        style={{ borderBottom: "1px solid var(--sidebar-border)", minHeight: 56 }}>
        <Link href="/feed" className="flex items-center gap-2.5 min-w-0">
          {!collapsed && (
            <>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
                <Factory className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-sm tracking-tight" style={{ color: "var(--sidebar-fg)" }}>
                FactoryLM
              </span>
            </>
          )}
          {collapsed && (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center mx-auto"
              style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
              <Factory className="w-4 h-4 text-white" />
            </div>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-6 h-6 rounded-md flex items-center justify-center transition-colors ml-auto"
          style={{ color: "#64748B" }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5" />
            : <ChevronLeft className="w-3.5 h-3.5" />
          }
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {primary.map((item) => (
          <NavItem key={item.key} item={item} collapsed={collapsed}
            active={pathname === item.href || pathname.startsWith(item.href + "/")}
            label={navLabel(item.key)} />
        ))}

        {secondary.length > 0 && (
          <>
            <div className="mx-1 my-2" style={{ borderTop: "1px solid var(--sidebar-border)" }} />
            {!collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#475569" }}>
                More
              </p>
            )}
            {secondary.map((item) => (
              <NavItem key={item.key} item={item} collapsed={collapsed}
                active={pathname === item.href || pathname.startsWith(item.href + "/")}
                label={navLabel(item.key)} />
            ))}
          </>
        )}
      </nav>

      {/* User section */}
      <div className="p-3 space-y-1" style={{ borderTop: "1px solid var(--sidebar-border)" }}>
        {!collapsed && (
          <p className="text-[10px] text-center leading-tight pb-1" style={{ color: "#475569" }}>
            Maintenance Intelligence Platform
          </p>
        )}

        <LanguageSelector collapsed={collapsed} dropUp />

        <button onClick={toggleTheme}
          className="w-full flex items-center rounded-lg transition-colors px-2 py-1.5"
          style={{ color: "#64748B" }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
          title={theme === "dark" ? tTheme("light") : tTheme("dark")}>
          {theme === "dark"
            ? <Sun className="w-4 h-4 flex-shrink-0" />
            : <Moon className="w-4 h-4 flex-shrink-0" />
          }
          {!collapsed && (
            <span className="ml-3 text-xs">
              {theme === "dark" ? tTheme("light") : tTheme("dark")}
            </span>
          )}
        </button>

        {collapsed ? (
          <div className="flex justify-center">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", color: "white" }}>
              {me?.initials ?? "?"}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", color: "white" }}>
              {me?.initials ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: "var(--sidebar-fg)" }}>{me?.name ?? "—"}</p>
              <p className="text-[11px] capitalize" style={{ color: "#64748B" }}>{me?.role ?? role}</p>
            </div>
            <button
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{ color: "#64748B" }}
              title={t("signOut")}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
