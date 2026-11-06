// Badge: a short label on a soft fill. Tones say what it is about, not a
// colour: neutral, success, danger, warning, info, accent.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

export const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-xs font-medium leading-5 [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "border-line bg-sunken text-fg-secondary",
        success: "border-success-line bg-success-soft text-success",
        danger: "border-danger-line bg-danger-soft text-danger",
        warning: "border-warning-line bg-warning-soft text-warning",
        info: "border-info-line bg-info-soft text-info",
        accent: "border-transparent bg-ink text-on-ink",
        outline: "border-line bg-transparent text-fg-tertiary",
      },
      shape: { pill: "rounded-full", square: "rounded-md px-1.5" },
    },
    defaultVariants: { tone: "neutral", shape: "pill" },
  },
);

export function Pill({ className, tone, shape, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone, shape }), className)} {...props} />;
}
