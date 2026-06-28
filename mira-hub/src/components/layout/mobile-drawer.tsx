"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  X,
  MessageSquare, AlertTriangle, BookOpen, Wrench,
  ClipboardList, CalendarDays, Inbox, Package, FileText,
  TrendingUp, Radio, Plug, BarChart2, Users, Settings, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/config";
import { signOutToLogin } from "./sign-out-action";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

type MeData = {
  name?: string;
  email?: string;
  initials?: string;
  role?: string;
};

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const drawerRef = useRef<HTMLDivElement>(null);
  const [me, setMe] = useState<MeData | null>(null);

  useEffect(() => {
    if (!open || me) return;
    fetch(`${API_BASE}/api/me/`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MeData | null) => d && setMe(d))
      .catch(() => {});
  }, [open, me]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Swipe-right to close
  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    let startX = 0;
    const onTouchStart = (e: TouchEvent) => { startX = e.touches[0].clientX; };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches[0].clientX - startX > 60) onClose();
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [onClose]);

  const ITEMS = [
    { label: t("conversations"), Icon: MessageSquare, href: "/conversations" },
    { label: t("alerts"),        Icon: AlertTriangle, href: "/alerts" },
    { label: t("knowledge"),     Icon: BookOpen,      href: "/knowledge" },
    { label: t("assets"),        Icon: Wrench,        href: "/assets" },
    { label: t("workOrders"),    Icon: ClipboardList, href: "/workorders" },
    { label: t("schedule"),      Icon: CalendarDays,  href: "/schedule" },
    { label: t("requests"),      Icon: Inbox,         href: "/requests" },
    { label: t("parts"),         Icon: Package,       href: "/parts" },
    { label: t("documents"),     Icon: FileText,      href: "/documents" },
    { label: t("reports"),       Icon: TrendingUp,    href: "/reports" },
    { label: t("channels"),      Icon: Radio,         href: "/channels" },
    { label: t("integrations"),  Icon: Plug,          href: "/integrations" },
    { label: t("usage"),         Icon: BarChart2,     href: "/usage" },
    { label: t("team"),          Icon: Users,         href: "/team" },
    { label: "Settings",         Icon: Settings,      href: "/settings" },
  ];

  return (
    <>
      {/* Overlay */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "md:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          "md:hidden fixed top-0 right-0 h-full z-50 flex flex-col transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{
          width: 280,
          backgroundColor: "var(--sidebar-bg)",
          borderLeft: "1px solid var(--sidebar-border)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--sidebar-border)" }}
        >
          <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Menu</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex items-center justify-center rounded-lg transition-colors"
            style={{ width: 48, height: 48, color: "var(--foreground-muted)" }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto py-2">
          {ITEMS.map(({ label, Icon, href }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-4 transition-colors",
                  active ? "bg-[var(--surface-1)]" : "hover:bg-[var(--surface-1)]",
                )}
                style={{ minHeight: 48 }}
              >
                <Icon
                  className="w-5 h-5 flex-shrink-0"
                  style={{ color: active ? "var(--brand-blue)" : "var(--foreground-muted)" }}
                />
                <span
                  className="text-sm"
                  style={{
                    color: active ? "var(--foreground)" : "var(--foreground-muted)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </div>

        <div
          className="flex-shrink-0 space-y-3 p-3"
          style={{ borderTop: "1px solid var(--sidebar-border)" }}
        >
          <div className="flex items-center gap-3 px-1">
            <div
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
              style={{ background: "var(--brand-blue)", color: "white" }}
              aria-hidden
            >
              {me?.initials ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" style={{ color: "var(--sidebar-fg)" }}>
                {me?.name ?? "Account"}
              </p>
              <p className="truncate text-xs" style={{ color: "var(--foreground-muted)" }}>
                {me?.email ?? me?.role ?? ""}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={signOutToLogin}
            className="flex w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-[var(--surface-1)]"
            style={{
              minHeight: 48,
              color: "var(--foreground)",
              border: "1px solid var(--sidebar-border)",
            }}
            aria-label={t("signOut")}
          >
            <LogOut className="h-5 w-5 flex-shrink-0" style={{ color: "var(--foreground-muted)" }} />
            <span>{t("signOut")}</span>
          </button>
        </div>
      </div>
    </>
  );
}
