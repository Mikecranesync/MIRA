"use client";

import { useState, useRef, useEffect } from "react";
import { useActiveLocale, useSetLocale, LOCALE_META, type Locale } from "@/providers/i18n-provider";

const LOCALES = Object.keys(LOCALE_META) as Locale[];

interface LanguageSelectorProps {
  collapsed?: boolean;
  dropUp?: boolean;
}

export function LanguageSelector({ collapsed = false, dropUp = false }: LanguageSelectorProps) {
  const locale = useActiveLocale();
  const setLocale = useSetLocale();
  const current = LOCALE_META[locale];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function select(l: Locale) {
    setLocale(l);
    setOpen(false);
  }

  return (
    <div ref={ref} className={`relative ${collapsed ? "flex justify-center" : ""}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center rounded-lg transition-colors px-2 py-1.5"
        style={{ color: "#64748B" }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
        title={collapsed ? current.label : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="text-base leading-none flex-shrink-0">{current.flag}</span>
        {!collapsed && (
          <span className="ml-3 text-xs truncate">{current.label}</span>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute ${dropUp ? "bottom-full mb-1" : "top-full mt-1"} left-0 min-w-[160px] rounded-xl border shadow-lg overflow-hidden z-[9999]`}
          style={{
            backgroundColor: "var(--surface-0)",
            borderColor: "var(--border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          }}
        >
          {LOCALES.map(l => {
            const meta = LOCALE_META[l];
            const isActive = l === locale;
            return (
              <button
                key={l}
                role="option"
                aria-selected={isActive}
                onClick={() => select(l)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs transition-colors text-left"
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
      )}
    </div>
  );
}
