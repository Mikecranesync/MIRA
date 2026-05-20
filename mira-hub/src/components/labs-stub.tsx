"use client";

// LabsStub — placeholder shown for routes gated behind NEXT_PUBLIC_LABS_ENABLED
// (ADR-0014). The route still exists and renders 200, but the mock UI is
// hidden until Labs is turned on. Avoids showing fake data on a paid product
// while preserving the page component for future real-data wiring.
//
// Wire-up pattern in each gated page (e.g. /conversations/page.tsx):
//
//   export default function ConversationsPage() {
//     if (process.env.NEXT_PUBLIC_LABS_ENABLED !== "true") {
//       return <LabsStub feature="Conversations" />;
//     }
//     // ... original mock UI ...
//   }
//
// The env var must be NEXT_PUBLIC_-prefixed so Next.js inlines it for the
// client bundle. Default off — production builds get the stub.

import Link from "next/link";
import { FlaskConical } from "lucide-react";

type Props = {
  feature: string;
  description?: string;
};

export function LabsStub({ feature, description }: Props) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <div
        className="max-w-md w-full rounded-2xl p-8 text-center"
        style={{
          backgroundColor: "var(--card-bg, #FFFFFF)",
          border: "1px solid var(--card-border, #E2E8F0)",
        }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{
            background: "linear-gradient(135deg, #FBBF24, #F97316)",
          }}
        >
          <FlaskConical className="w-7 h-7 text-white" />
        </div>

        <h1
          className="text-xl font-semibold mb-2"
          style={{ color: "var(--card-fg, #0F172A)" }}
        >
          {feature} — Coming Soon
        </h1>

        <p
          className="text-sm leading-relaxed mb-6"
          style={{ color: "var(--card-muted-fg, #475569)" }}
        >
          {description ??
            `${feature} is in development. Turn on Labs to preview the upcoming UI with placeholder data.`}
        </p>

        <div className="space-y-3">
          <Link
            href="/feed"
            className="inline-flex items-center justify-center w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--brand-blue, #2563EB)",
              color: "white",
            }}
          >
            Back to Feed
          </Link>

          <p
            className="text-[11px] uppercase tracking-wider"
            style={{ color: "#94A3B8" }}
          >
            Enable Labs by setting{" "}
            <code
              className="font-mono px-1.5 py-0.5 rounded"
              style={{ backgroundColor: "#F1F5F9", color: "#0F172A" }}
            >
              NEXT_PUBLIC_LABS_ENABLED=true
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}
