import { HelpHeader } from "../_components/HelpHeader";
import { Feedback } from "../_components/Feedback";
import { FAQ } from "../_content/faq";

export const metadata = {
  title: "FAQ · Help · FactoryLM",
  description: "Top 10 questions about FactoryLM and MIRA, answered plainly.",
};

export default function FaqPage() {
  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <HelpHeader
        title="FAQ"
        subtitle="The 10 questions we hear most often."
        backHref="/help"
        backLabel="Help"
      />

      <div className="px-4 py-4 max-w-3xl mx-auto space-y-3">
        {FAQ.map((item, i) => (
          <details
            key={i}
            className="card p-4"
            style={{ borderColor: "var(--border)" }}
          >
            <summary
              className="text-sm font-semibold cursor-pointer list-none flex items-center justify-between gap-2"
              style={{ color: "var(--foreground)" }}
            >
              <span>{item.q}</span>
              <span
                className="text-xs flex-shrink-0"
                style={{ color: "var(--foreground-muted)" }}
                aria-hidden
              >
                +
              </span>
            </summary>
            <p className="text-sm mt-3 leading-relaxed" style={{ color: "var(--foreground-muted)" }}>
              {item.a}
            </p>
          </details>
        ))}

        <Feedback pageSlug="faq" />
      </div>
    </div>
  );
}
