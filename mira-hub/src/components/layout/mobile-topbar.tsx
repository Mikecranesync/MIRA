"use client";

import Link from "next/link";
import { Sun, Moon, Factory } from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/components/ui/language-selector";

export function MobileTopBar() {
  const { theme, toggleTheme } = useTheme();
  const tTheme = useTranslations("theme");

  return (
    <header
      className="md:hidden sticky top-0 z-50 flex items-center justify-between px-3 flex-shrink-0"
      style={{
        height: 56, // was 44 — increased to fit 48px buttons comfortably
        backgroundColor: "var(--sidebar-bg)",
        borderBottom: "1px solid var(--sidebar-border)",
      }}
    >
      {/* Logo — full-height tap target */}
      <Link
        href="/feed"
        className="flex items-center gap-2 self-stretch px-1"
        style={{ minWidth: 44 }}
      >
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}
        >
          <Factory className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-bold tracking-tight" style={{ color: "#F8FAFC" }}>
          FactoryLM
        </span>
      </Link>

      {/* Right controls */}
      <div className="flex items-center self-stretch">
        {/* Language selector (compact) */}
        <LanguageSelector collapsed />

        {/* Dark mode toggle — 48×48 touch target */}
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center rounded-lg transition-colors"
          style={{ width: 48, height: 48, color: "#94A3B8", flexShrink: 0 }}
          aria-label={theme === "dark" ? tTheme("light") : tTheme("dark")}
        >
          {theme === "dark"
            ? <Sun className="w-4 h-4" />
            : <Moon className="w-4 h-4" />
          }
        </button>
      </div>
    </header>
  );
}
