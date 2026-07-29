import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:    "bg-[var(--brand-blue)] text-white",
        secondary:  "bg-[var(--surface-1)] text-[var(--foreground-muted)]",
        outline:    "border border-[var(--border)] text-[var(--foreground-muted)]",
        green:      "status-green",
        yellow:     "status-yellow",
        red:        "status-red",
        gray:       "status-gray",
        critical:   "bg-red-100 text-red-700 font-semibold",
        high:       "bg-orange-100 text-orange-700",
        medium:     "bg-yellow-100 text-yellow-700",
        low:        "bg-slate-100 text-slate-600",
        open:       "bg-blue-100 text-blue-700",
        inprogress: "bg-amber-100 text-amber-700",
        completed:  "bg-green-100 text-green-700",
        overdue:    "bg-red-100 text-red-700",
        indexed:    "bg-emerald-100 text-emerald-700",
        partial:    "bg-amber-100 text-amber-700",
        superseded: "bg-slate-100 text-slate-500",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
