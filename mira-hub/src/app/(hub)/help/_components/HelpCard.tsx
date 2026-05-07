import Link from "next/link";
import {
  BookOpen, MessageSquare, ListChecks, Keyboard, LifeBuoy, FileText,
  Activity, Wrench, ClipboardList, CalendarDays, Plug, Radio, TrendingUp, Settings,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  BookOpen, MessageSquare, ListChecks, Keyboard, LifeBuoy, FileText,
  Activity, Wrench, ClipboardList, CalendarDays, Plug, Radio, TrendingUp, Settings,
};

type Props = {
  icon: string;
  title: string;
  description: string;
  href: string;
  external?: boolean;
};

export function HelpCard({ icon, title, description, href, external }: Props) {
  const Icon = ICON_MAP[icon] ?? BookOpen;

  const content = (
    <>
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: "var(--surface-1)" }}
      >
        <Icon className="w-5 h-5" style={{ color: "var(--brand-blue)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          {title}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
          {description}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
    </>
  );

  const className =
    "card p-4 flex items-center gap-4 hover:bg-[var(--surface-1)] transition-colors block";

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
