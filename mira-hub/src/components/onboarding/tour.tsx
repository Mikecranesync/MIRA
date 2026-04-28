"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

const TOUR_KEY = "mira_tour_v1";
const RESTART_EVENT = "mira:restart-tour";

const STEPS = [
  {
    navKey: "conversations",
    title: "Chat with MIRA",
    description: "Ask MIRA anything about your equipment. It answers from OEM manuals and your maintenance history — and cites its sources.",
  },
  {
    navKey: "assets",
    title: "Equipment Registry",
    description: "Add your machines here. MIRA uses asset context to give you site-specific diagnostics instead of generic answers.",
  },
  {
    navKey: "knowledge",
    title: "Upload OEM Manuals",
    description: "Drop PDF manuals here. MIRA extracts fault codes and maintenance procedures — answers improve immediately.",
  },
  {
    navKey: "workorders",
    title: "Work Orders",
    description: "MIRA creates work orders from its diagnostic recommendations. Assign, track, and close them here.",
  },
  {
    navKey: "reports",
    title: "AI Reports",
    description: "Weekly maintenance summaries, fault trends, and PM compliance — generated automatically from your activity.",
  },
] as const;

type Pos = { top: number; left: number } | null;

function getNavPos(navKey: string): Pos {
  const el = document.querySelector<HTMLElement>(`[data-tour="${navKey}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top + r.height / 2, left: r.right + 16 };
}

export function OnboardingTour() {
  const [step, setStep] = useState(-1);
  const [pos, setPos] = useState<Pos>(null);

  const show = useCallback((s: number) => {
    setStep(s);
    setPos(getNavPos(STEPS[s].navKey));
  }, []);

  const complete = useCallback(() => {
    localStorage.setItem(TOUR_KEY, "1");
    setStep(-1);
  }, []);

  // First-login check
  useEffect(() => {
    if (!localStorage.getItem(TOUR_KEY)) show(0);
  }, [show]);

  // Re-trigger from sidebar "?" button
  useEffect(() => {
    const handler = () => show(0);
    window.addEventListener(RESTART_EVENT, handler);
    return () => window.removeEventListener(RESTART_EVENT, handler);
  }, [show]);

  // Reposition on resize
  useEffect(() => {
    if (step < 0) return;
    const handler = () => setPos(getNavPos(STEPS[step].navKey));
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [step]);

  if (step < 0 || step >= STEPS.length) return null;

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  // Tooltip sits to the right of the sidebar nav item; fall back to center
  const tooltipStyle: React.CSSProperties = pos
    ? { position: "fixed", top: pos.top - 64, left: pos.left }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)" };

  return (
    <>
      {/* Backdrop — click to skip */}
      <div
        className="fixed inset-0 z-[9000]"
        style={{ background: "rgba(0,0,0,0.55)" }}
        onClick={complete}
        aria-label="Skip tour"
      />

      {/* Tooltip card */}
      <div
        className="z-[9001] w-72 rounded-xl shadow-2xl"
        style={{
          ...tooltipStyle,
          background: "var(--card, #1e293b)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "var(--foreground, #f1f5f9)",
        }}
        // Stop backdrop click from closing when clicking the card
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={`Tour step ${step + 1} of ${STEPS.length}: ${current.title}`}
      >
        {/* Arrow pointing left toward sidebar */}
        {pos && (
          <div
            style={{
              position: "absolute",
              left: -8,
              top: 56,
              width: 0,
              height: 0,
              borderTop: "8px solid transparent",
              borderBottom: "8px solid transparent",
              borderRight: "8px solid var(--card, #1e293b)",
            }}
          />
        )}

        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold" style={{ color: "#64748b" }}>
              {step + 1} / {STEPS.length}
            </span>
            <button
              onClick={complete}
              className="w-6 h-6 rounded-md flex items-center justify-center transition-colors"
              style={{ color: "#64748b" }}
              aria-label="Skip tour"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="mb-3 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
            <div
              className="h-1 rounded-full transition-all duration-300"
              style={{
                width: `${((step + 1) / STEPS.length) * 100}%`,
                background: "linear-gradient(90deg, #2563eb, #0891b2)",
              }}
            />
          </div>

          <h3 className="font-semibold text-sm mb-1.5">{current.title}</h3>
          <p className="text-xs leading-relaxed mb-4" style={{ color: "#94a3b8" }}>
            {current.description}
          </p>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={complete}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{ color: "#64748b" }}
            >
              Skip
            </button>
            <div className="flex gap-2">
              {!isFirst && (
                <button
                  onClick={() => show(step - 1)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                  style={{ background: "rgba(255,255,255,0.08)", color: "#94a3b8" }}
                  aria-label="Previous step"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => (isLast ? complete() : show(step + 1))}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity"
                style={{ background: "linear-gradient(90deg, #2563eb, #0891b2)", color: "white" }}
              >
                {isLast ? "Done" : "Next"}
                {!isLast && <ChevronRight className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Call this from anywhere to re-open the tour from step 1. */
export function restartTour() {
  localStorage.removeItem(TOUR_KEY);
  window.dispatchEvent(new Event(RESTART_EVENT));
}
