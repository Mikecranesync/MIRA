import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { HelpHeader } from "../_components/HelpHeader";
import { Feedback } from "../_components/Feedback";
import { GETTING_STARTED_STEPS, GETTING_STARTED_NEXT } from "../_content/getting-started";

export const metadata = {
  title: "Getting started · Help · FactoryLM",
  description: "5 minutes from sign-up to your first diagnosis.",
};

function renderInline(text: string) {
  // Tiny markdown renderer for **bold** and *italic*. Avoids pulling in a full MD parser.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}

function renderBody(body: string) {
  return body.split("\n\n").map((para, i) => {
    if (para.startsWith("- ")) {
      const items = para.split("\n").map((line) => line.replace(/^- /, ""));
      return (
        <ul key={i} className="list-disc pl-5 space-y-1.5 text-sm" style={{ color: "var(--foreground)" }}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i} className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
        {renderInline(para)}
      </p>
    );
  });
}

export default function GettingStartedPage() {
  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <HelpHeader
        title="Getting started"
        subtitle="5 minutes from sign-up to your first diagnosis."
        backHref="/help"
        backLabel="Help"
      />

      <div className="px-4 py-4 max-w-3xl mx-auto space-y-6">
        {GETTING_STARTED_STEPS.map((step) => (
          <section key={step.number} className="card p-4">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, #2563EB, #0891B2)",
                  color: "white",
                }}
              >
                {step.number}
              </div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                {step.title}
              </h2>
            </div>

            <div className="space-y-2 ml-10">{renderBody(step.body)}</div>

            {step.tip && (
              <div
                className="ml-10 mt-3 p-3 rounded-lg text-xs"
                style={{
                  backgroundColor: "var(--surface-1)",
                  color: "var(--foreground-muted)",
                }}
              >
                <span className="font-semibold" style={{ color: "var(--brand-blue)" }}>Tip — </span>
                {renderInline(step.tip)}
              </div>
            )}
          </section>
        ))}

        <section
          className="card p-4 text-center"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-sm font-semibold mb-3" style={{ color: "var(--foreground)" }}>
            You&apos;re set. What&apos;s next?
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            {GETTING_STARTED_NEXT.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground)" }}
              >
                {item.label}
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            ))}
          </div>
        </section>

        <Feedback pageSlug="getting-started" />
      </div>
    </div>
  );
}
