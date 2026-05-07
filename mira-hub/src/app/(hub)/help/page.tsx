import Link from "next/link";
import { HelpHeader } from "./_components/HelpHeader";
import { HelpCard } from "./_components/HelpCard";

export const metadata = {
  title: "Help · FactoryLM",
  description: "Find what you need. Getting started, feature guides, FAQ, and contact.",
};

type TopLevelItem = {
  icon: string;
  title: string;
  description: string;
  href: string;
  external?: boolean;
};

const TOP_LEVEL: TopLevelItem[] = [
  {
    icon: "BookOpen",
    title: "Getting started",
    description: "5 minutes from sign-up to your first diagnosis.",
    href: "/help/getting-started",
  },
  {
    icon: "ListChecks",
    title: "Feature guides",
    description: "How every screen works.",
    href: "/help/features",
  },
  {
    icon: "MessageSquare",
    title: "FAQ",
    description: "Top 10 questions, answered plainly.",
    href: "/help/faq",
  },
  {
    icon: "Keyboard",
    title: "Keyboard shortcuts",
    description: "Work faster with the keyboard.",
    href: "/help/shortcuts",
  },
  {
    icon: "LifeBuoy",
    title: "Contact support",
    description: "Email, Telegram, response times.",
    href: "/help/contact",
  },
  {
    icon: "FileText",
    title: "What's new",
    description: "Recent releases and changes.",
    href: "https://github.com/Mikecranesync/MIRA/blob/main/docs/CHANGELOG.md",
    external: true,
  },
];

export default function HelpIndexPage() {
  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <HelpHeader
        title="Help"
        subtitle="Welcome to FactoryLM Help. Find what you need."
      />

      <div className="px-4 py-4 max-w-3xl mx-auto space-y-2">
        {TOP_LEVEL.map((item) => (
          <HelpCard
            key={item.href}
            icon={item.icon}
            title={item.title}
            description={item.description}
            href={item.href}
            external={item.external}
          />
        ))}

        <div
          className="mt-6 p-4 rounded-xl text-sm text-center"
          style={{
            backgroundColor: "var(--surface-1)",
            color: "var(--foreground-muted)",
          }}
        >
          Can&apos;t find what you need?{" "}
          <Link
            href="/help/contact"
            className="font-semibold hover:underline"
            style={{ color: "var(--brand-blue)" }}
          >
            Email mike@cranesync.com
          </Link>
        </div>
      </div>
    </div>
  );
}
