import {
  Mail, Send, Bug, DollarSign, ChevronRight, AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { HelpHeader } from "../_components/HelpHeader";
import { CONTACT_CHANNELS, SUPPORT_HOURS, ESCALATION } from "../_content/contact";

const ICON_MAP: Record<string, LucideIcon> = { Mail, Send, Bug, DollarSign };

export const metadata = {
  title: "Contact support · Help · FactoryLM",
  description: "Email, Telegram, response times, and how to escalate.",
};

export default function ContactPage() {
  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <HelpHeader
        title="Contact support"
        subtitle="We answer real humans, not auto-replies."
        backHref="/help"
        backLabel="Help"
      />

      <div className="px-4 py-4 max-w-3xl mx-auto space-y-6">
        <section className="space-y-2">
          {CONTACT_CHANNELS.map((channel) => {
            const Icon = ICON_MAP[channel.icon] ?? Mail;
            const isExternal = channel.href?.startsWith("http");
            const linkProps = isExternal
              ? { target: "_blank", rel: "noopener noreferrer" as const }
              : {};

            return (
              <a
                key={channel.title}
                href={channel.href ?? "#"}
                {...linkProps}
                className="card p-4 flex items-center gap-4 hover:bg-[var(--surface-1)] transition-colors block"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: "var(--surface-1)" }}
                >
                  <Icon className="w-5 h-5" style={{ color: "var(--brand-blue)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                    {channel.title}
                  </p>
                  <p className="text-sm truncate" style={{ color: "var(--brand-blue)" }}>
                    {channel.detail}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                    {channel.responseTime}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
              </a>
            );
          })}
        </section>

        <section className="card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "var(--foreground-muted)" }}>
            Hours
          </h2>
          <p className="text-sm" style={{ color: "var(--foreground)" }}>{SUPPORT_HOURS}</p>
        </section>

        <section
          className="card p-4 flex gap-3"
          style={{
            backgroundColor: "var(--surface-1)",
            borderColor: "var(--border)",
          }}
        >
          <AlertTriangle
            className="w-5 h-5 flex-shrink-0 mt-0.5"
            style={{ color: "#DC2626" }}
          />
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Machine down? Escalate fast.
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--foreground-muted)" }}>
              {ESCALATION}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
