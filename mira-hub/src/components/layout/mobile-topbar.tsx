"use client";

import { Sun, Moon, Factory } from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/components/ui/language-selector";

export function MobileTopBar() {
  const { theme, toggleTheme } = useTheme();
  const tTheme = useTranslations("theme");

  return (
    <header
      className="md:hidden sticky top-0 z-50 flex items-center justify-between px-4 flex-shrink-0"
      style={{
        height: 44,
        backgroundColor: "var(--sidebar-bg)",
        borderBottom: "1px solid var(--sidebar-border)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}
        >
          <Factory className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-bold tracking-tight" style={{ color: "#F8FAFC" }}>
          FactoryLM
        </span>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-1">
        {/* Language selector (compact) */}
        <LanguageSelector collapsed />

        {/* Dark mode toggle */}
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          style={{ color: "#94A3B8" }}
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
