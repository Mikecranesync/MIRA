import Link from "next/link";
import { Lock } from "lucide-react";

// Shared "you don't have access" panel. Use this instead of surfacing a raw
// "HTTP 403" string (the #1932 bug) when a user reaches a surface their
// capabilities don't allow. Renders inside the hub content area.
export function NoAccess({
  title = "You don't have access to this area",
  message = "This section is limited to administrators. If you think you should have access, contact your workspace owner.",
  backHref = "/feed",
  backLabel = "Back to dashboard",
}: {
  title?: string;
  message?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div
      className="mx-auto max-w-md px-4 py-16 text-center"
      data-testid="no-access"
    >
      <div
        className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--surface-1)" }}
      >
        <Lock className="h-6 w-6" style={{ color: "var(--foreground-subtle)" }} />
      </div>
      <h1 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: "var(--foreground-muted)" }}>
        {message}
      </p>
      <Link
        href={backHref}
        className="mt-6 inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}
      >
        {backLabel}
      </Link>
    </div>
  );
}
