"use client";

// The sidebar, on a narrow screen: a menu button in the top bar opens it as
// a drawer. Below the medium breakpoint the sidebar used to be hidden and
// nothing stood in for it — zoom a browser in a little and every page lost
// its navigation and floated in the middle of an empty canvas.

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // A navigation closes it — adjusted during render, not in an effect.
  const [seen, setSeen] = useState(pathname);
  if (pathname !== seen) {
    setSeen(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="mr-1 flex h-8 w-8 items-center justify-center rounded-md text-fg-tertiary hover:bg-muted md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" onPointerDown={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/30" />
          <div className="absolute inset-y-0 left-0 w-64 shadow-2xl" onPointerDown={(e) => e.stopPropagation()}>
            <Sidebar variant="drawer" />
          </div>
        </div>
      )}
    </>
  );
}
