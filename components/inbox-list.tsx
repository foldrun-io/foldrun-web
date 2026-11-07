"use client";

// The inbox's rows (server/inbox.ts), with your marks: opening an item marks
// it read; Set aside hides it from your view only — a gate still waits, an
// issue stays open for everyone else (POST /api/me/inbox).

import Link from "@/components/kit/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocalTime } from "@/components/local-time";
import { WithEmails } from "@/components/email";
import type { InboxItem } from "@/server/inbox";
import { AlertTriangle, ArchiveRestore, CheckCheck, Archive, Mail, MailOpen, MessageCircleQuestion, MoreHorizontal, Play, ShieldCheck, Wand2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/kit/button";
import { Tooltip } from "@/components/kit/tooltip";
import { Chip, type Tone, IconBox, Callout } from "@/components/kit/page";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/kit/menu";
import { cn } from "@/components/kit/cn";

const KIND: Record<InboxItem["kind"], { label: string; tone: Tone; icon: React.ReactNode; open: string }> = {
  approval: { label: "approval", tone: "warn", icon: <ShieldCheck />, open: "Review" },
  question: { label: "question", tone: "info", icon: <MessageCircleQuestion />, open: "Answer" },
  issue: { label: "issue", tone: "bad", icon: <AlertTriangle />, open: "Open" },
  proposal: { label: "proposed fix", tone: "info", icon: <Wand2 />, open: "Review" },
  run: { label: "your run", tone: "default", icon: <Play />, open: "Open" },
};

export function InboxList({ items, tenant, dismissedView }: { items: InboxItem[]; tenant: string; dismissedView: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mark = async (ids: string[], action: "read" | "unread" | "dismiss" | "restore", key: string) => {
    setBusy(key);
    setError(null);
    try {
      // The route takes at most 200 ids a call: Mark all read on a long tab goes in batches.
      for (let i = 0; i < ids.length; i += 200) {
        const res = await fetch("/api/me/inbox", {
          method: "POST",
          headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
          body: JSON.stringify({ ids: ids.slice(i, i + 200), action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const unread = items.filter((i) => !i.read).map((i) => i.id);

  const open = (i: InboxItem) => {
    if (!i.read) void mark([i.id], "read", i.id);
  };

  return (
    <div className="min-w-0 space-y-3">
      {!dismissedView && unread.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[13px] tabular-nums text-fg-muted">{unread.length} unread</span>
          {unread.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => mark(unread, "read", "all")} disabled={busy === "all"}>
              <CheckCheck aria-hidden />
              Mark all read
            </Button>
          )}
        </div>
      )}
      {error && <Callout tone="danger" className="px-4 py-2.5 text-sm" role="alert">{error}</Callout>}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {items.map((i) => {
          const k = KIND[i.kind];
          return (
            <li key={i.id} className={cn("relative flex min-w-0 items-center gap-3 px-3 py-3 transition-colors hover:bg-sunken sm:px-4", !i.read && "bg-accent-soft/30")}>
              <IconBox className="relative" aria-hidden>
                {k.icon}
                {!i.read && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-info" />}
              </IconBox>
              <div className="min-w-0 flex-1">
                <Link
                  href={i.href}
                  onClick={() => open(i)}
                  className={cn(
                    "block truncate text-sm after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-focus",
                    i.read ? "text-fg-secondary" : "font-semibold text-fg",
                  )}
                >
                  <WithEmails text={i.title} />
                  {!i.read && <span className="sr-only"> (unread)</span>}
                </Link>
                {/* An address in a question or a reason goes through WithEmails: a proxy may rewrite one in the HTML. */}
                {i.detail && (
                  <p className="mt-0.5 line-clamp-1 text-[13px] text-fg-muted">
                    <WithEmails text={i.detail} />
                  </p>
                )}
                <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-muted">
                  <Chip tone={k.tone} className="h-5">
                    {k.label}
                  </Chip>
                  <span className="truncate">{i.workspace}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{i.why}</span>
                  <span aria-hidden>·</span>
                  <LocalTime iso={i.at} />
                </p>
              </div>
              <span className="relative z-10 flex shrink-0 items-center gap-1">
                {dismissedView ? (
                  <Tooltip label="Put it back in your inbox">
                    <Button size="sm" onClick={() => mark([i.id], "restore", `${i.id}-d`)} disabled={!!busy}>
                      <ArchiveRestore aria-hidden />
                      Put back
                    </Button>
                  </Tooltip>
                ) : (
                  <Link href={i.href} onClick={() => open(i)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "max-sm:hidden")}>
                    {k.open}
                  </Link>
                )}
                {!dismissedView && (
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label="More actions" disabled={!!busy}>
                        <MoreHorizontal />
                      </Button>
                    </MenuTrigger>
                    <MenuContent className="w-60">
                      <MenuItem onSelect={() => mark([i.id], i.read ? "unread" : "read", `${i.id}-r`)}>
                        {i.read ? <Mail /> : <MailOpen />}
                        {i.read ? "Mark unread" : "Mark read"}
                      </MenuItem>
                      <MenuItem onSelect={() => mark([i.id], "dismiss", `${i.id}-d`)}>
                        <Archive />
                        <span className="flex flex-col">
                          <span>Set aside</span>
                          <span className="text-xs text-fg-muted">Hidden from you; still waiting for whoever decides it</span>
                        </span>
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
