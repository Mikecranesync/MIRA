"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, Check } from "lucide-react";

type Props = {
  pageSlug: string;
};

export function Feedback({ pageSlug }: Props) {
  const [submitted, setSubmitted] = useState<"up" | "down" | null>(null);

  function record(vote: "up" | "down") {
    setSubmitted(vote);
    if (typeof window !== "undefined") {
      console.info("help_feedback", { page: pageSlug, vote, ts: new Date().toISOString() });
    }
  }

  if (submitted) {
    return (
      <div
        className="card p-4 flex items-center gap-3 mt-8"
        style={{ borderColor: "var(--border)" }}
      >
        <Check className="w-5 h-5" style={{ color: "var(--success, #16A34A)" }} />
        <p className="text-sm" style={{ color: "var(--foreground)" }}>
          Thanks for the feedback. We use it to improve these pages.
        </p>
      </div>
    );
  }

  return (
    <div
      className="card p-4 mt-8"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="text-sm font-semibold mb-2" style={{ color: "var(--foreground)" }}>
        Was this helpful?
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => record("up")}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground)" }}
          aria-label="Yes, this was helpful"
        >
          <ThumbsUp className="w-4 h-4" />
          Yes
        </button>
        <button
          onClick={() => record("down")}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground)" }}
          aria-label="No, this was not helpful"
        >
          <ThumbsDown className="w-4 h-4" />
          No
        </button>
      </div>
    </div>
  );
}
