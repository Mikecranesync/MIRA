import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-1 text-sm text-[var(--foreground)]",
        "placeholder:text-[var(--foreground-subtle)]",
        "focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)] focus:border-transparent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "transition-colors",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
