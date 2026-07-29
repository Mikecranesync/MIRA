import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default:     "bg-[var(--brand-blue)] text-white hover:bg-[var(--brand-blue-hover)] shadow-sm",
        secondary:   "bg-[var(--surface-1)] text-[var(--foreground)] hover:bg-[var(--surface-2)]",
        destructive: "bg-[var(--status-red)] text-white hover:bg-red-700",
        outline:     "border border-[var(--border)] bg-transparent hover:bg-[var(--surface-1)]",
        ghost:       "hover:bg-[var(--surface-1)] text-[var(--foreground-muted)]",
        link:        "text-[var(--brand-blue)] underline-offset-4 hover:underline p-0 h-auto",
        cyan:        "bg-[var(--brand-cyan)] text-white hover:opacity-90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm:      "h-8 px-3 text-xs",
        lg:      "h-11 px-6 text-base",
        xl:      "h-12 px-8 text-base",
        icon:    "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
