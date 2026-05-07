import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type Props = {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
};

export function HelpHeader({ title, subtitle, backHref, backLabel }: Props) {
  return (
    <div
      className="sticky top-0 z-20 border-b"
      style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
    >
      <div className="px-4 pt-3 pb-3 max-w-3xl mx-auto">
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs mb-2 hover:underline"
            style={{ color: "var(--foreground-muted)" }}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {backLabel ?? "Back"}
          </Link>
        )}
        <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs mt-1" style={{ color: "var(--foreground-muted)" }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
