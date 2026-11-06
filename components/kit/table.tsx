// Table: the list every noun uses. A white card with hairline rows, a quiet
// head, and rows that light up when they lead somewhere. Server-safe: plain
// elements and class names, no state.
import * as React from "react";
import { cn } from "./cn";

export function TableCard({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("overflow-hidden rounded-lg border border-line bg-surface", className)} {...props} />;
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b border-line bg-sunken", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line-faint [&>tr:last-child]:border-0", className)} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("transition-colors has-[a[data-row-link]:hover]:bg-sunken", className)} {...props} />;
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("h-9 whitespace-nowrap px-4 text-left align-middle text-xs font-medium text-fg-muted first:pl-4 last:pr-4", className)}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-2.5 align-middle text-fg-secondary", className)} {...props} />;
}
