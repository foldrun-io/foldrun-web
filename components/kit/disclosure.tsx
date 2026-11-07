"use client";

// Disclosure: a line that opens to show more ("Details", "From a terminal",
// "More settings"), on Radix Collapsible — the kit's stand-in for the
// browser's <details>/<summary> (owner rule: no browser controls in the UI).
//
// The content stays in the page while closed (hidden), as <details> kept it,
// so a form inside still submits and a search still finds it. With an `id`
// the disclosure opens when the page is loaded at #that-id.
import * as React from "react";
import { Collapsible as K } from "radix-ui";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  id,
  marker = true,
  className,
  summaryClassName,
  contentClassName,
}: {
  /** The line that opens it. */
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  id?: string;
  /** A chevron before the summary that turns when open. */
  marker?: boolean;
  className?: string;
  summaryClassName?: string;
  contentClassName?: string;
}) {
  const [own, setOwn] = React.useState(defaultOpen);
  const open = controlled ?? own;
  const set = (v: boolean) => {
    setOwn(v);
    onOpenChange?.(v);
  };
  React.useEffect(() => {
    if (!id) return;
    const check = () => {
      if (window.location.hash === `#${id}`) set(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return (
    <K.Root data-slot="disclosure" id={id} open={open} onOpenChange={set} className={cn("group/disclosure", className)}>
      <K.Trigger
        className={cn(
          "flex w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          summaryClassName,
        )}
      >
        {marker && <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]/disclosure:rotate-90" aria-hidden />}
        {summary}
      </K.Trigger>
      <K.Content forceMount hidden={!open} className={contentClassName}>
        {children}
      </K.Content>
    </K.Root>
  );
}
