// Button: the one action control. Variants are what the action is (primary,
// secondary, ghost, danger, link); sizes are its box. `buttonVariants()` is a
// plain function, callable on the server, for a Link or a <summary> that must
// look like a button without being one.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "./cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-sm font-medium transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "border-transparent bg-ink text-on-ink hover:bg-ink-hover",
        secondary: "border-line bg-surface text-fg hover:border-line-strong hover:bg-sunken aria-expanded:bg-sunken",
        ghost: "border-transparent text-fg-tertiary hover:bg-muted hover:text-fg aria-expanded:bg-muted aria-expanded:text-fg",
        danger: "border-transparent bg-red-600 text-white hover:bg-red-700",
        "danger-outline": "border-line bg-surface text-danger hover:border-danger-line hover:bg-danger-soft",
        link: "h-auto border-transparent px-0 text-link underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-3.5",
        lg: "h-10 px-4",
        xs: "h-6 gap-1 rounded px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-xs": "size-6 rounded [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "sm" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
