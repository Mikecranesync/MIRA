"use client";

import { useActiveLocale, useSetLocale, LOCALE_META, type Locale } from "@/providers/i18n-provider";

const LOCALES = Object.keys(LOCALE_META) as Locale[];

export function LanguageSelector({ collapsed = false }: { collapsed?: boolean }) {
  const locale = useActiveLocale();
  const setLocale = useSetLocale();
  const current = LOCALE_META[locale];

  return (
    <div className={`relative group ${collapsed ? "flex justify-center" : ""}`}>
      <button
        className="w-full flex items-center rounded-lg transition-colors px-2 py-1.5"
        style={{ color: "#64748B" }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
        title={collapsed ? current.label : undefined}
      >
        <span className="text-base leading-none flex-shrink-0">{current.flag}</span>
        {!collapsed && (
          <span className="ml-3 text-xs truncate">{current.label}</span>
        )}
      </button>

      {/* Dropdown */}
      <div
        className="absolute bottom-full mb-1 left-0 min-w-[160px] rounded-xl border shadow-lg overflow-hidden opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50"
        style={{
          backgroundColor: "var(--surface-0)",
          borderColor: "var(--border)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
        }}
      >
        {LOCALES.map(l => {
          const meta = LOCALE_META[l];
          const isActive = l === locale;
          return (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors text-left"
              style={{
                backgroundColor: isActive ? "var(--sidebar-active)" : "transparent",
                color: isActive ? "white" : "var(--foreground)",
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.backgroundColor = "var(--surface-1)";
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span className="text-base leading-none">{meta.flag}</span>
              <span className="font-medium">{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
