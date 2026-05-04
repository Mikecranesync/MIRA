"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, X, Info } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";
type Toast = { id: number; message: string; type: ToastType };

const ToastContext = createContext<{
  toast: (msg: string, type?: ToastType) => void;
}>({ toast: () => {} });

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = ++nextId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const dismiss = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  const ICON = { success: CheckCircle2, error: AlertCircle, warning: AlertTriangle, info: Info };
  const STYLE = {
    success: { bg: "#16A34A", border: "#15803D" },
    error:   { bg: "#DC2626", border: "#B91C1C" },
    warning: { bg: "#D97706", border: "#B45309" },
    info:    { bg: "#2563EB", border: "#1D4ED8" },
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
        style={{ minWidth: 240, maxWidth: "calc(100vw - 32px)" }}>
        {toasts.map(t => {
          const Icon = ICON[t.type];
          const s = STYLE[t.type];
          return (
            <div key={t.id}
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-white text-sm font-medium pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-200"
              style={{ backgroundColor: s.bg, border: `1px solid ${s.border}` }}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="ml-1 opacity-70 hover:opacity-100 transition-opacity">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
