"use client";

// A search box whose query lives in the URL (?q=), for a list the server
// filters and pages (History). The kit's SearchField, "/" to focus; typing
// waits a beat before it asks the server, and drops ?page= so the answer
// starts at its first page.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { SearchField } from "./list";
import { withQuery } from "@/components/list-search-model";

export function UrlSearch({ value = "", placeholder, className }: { value?: string; placeholder: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (next: string) => {
    setQ(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      router.replace(`${pathname}${withQuery(params.toString(), next)}`, { scroll: false });
    }, 220);
  };
  return <SearchField value={q} onChange={change} placeholder={placeholder} className={className} />;
}
