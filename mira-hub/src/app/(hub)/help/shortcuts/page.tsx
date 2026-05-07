import { HelpHeader } from "../_components/HelpHeader";
import { Feedback } from "../_components/Feedback";
import { SHORTCUTS, TIPS } from "../_content/shortcuts";

export const metadata = {
  title: "Keyboard shortcuts · Help · FactoryLM",
  description: "Work faster with the keyboard.",
};

export default function ShortcutsPage() {
  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <HelpHeader
        title="Keyboard shortcuts"
        subtitle="Work faster with the keyboard. Press ? from anywhere to open this page."
        backHref="/help"
        backLabel="Help"
      />

      <div className="px-4 py-4 max-w-3xl mx-auto space-y-6">
        {SHORTCUTS.map((group) => (
          <section key={group.group} className="card p-4">
            <h2
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: "var(--foreground-muted)" }}
            >
              {group.group}
            </h2>
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {group.shortcuts.map((sc, i) => (
                <li key={i} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-sm" style={{ color: "var(--foreground)" }}>
                    {sc.action}
                  </span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {sc.keys.map((k, j) => (
                      <kbd
                        key={j}
                        className="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded text-xs font-mono"
                        style={{
                          backgroundColor: "var(--surface-1)",
                          color: "var(--foreground)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3 px-1"
            style={{ color: "var(--foreground-muted)" }}
          >
            Tips
          </h2>
          <div className="space-y-2">
            {TIPS.map((tip, i) => (
              <div key={i} className="card p-4">
                <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                  {tip.title}
                </p>
                <p className="text-sm mt-1" style={{ color: "var(--foreground-muted)" }}>
                  {tip.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <Feedback pageSlug="shortcuts" />
      </div>
    </div>
  );
}
