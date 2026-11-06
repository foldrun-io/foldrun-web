// The way in, cloudhost's AuthCard: one centred card with the mark, a title
// and a line, the form, and a quiet line under the card. Server-safe — every
// sign-in page (sign in, sign up, an invite, a reset, the CLI's and an AI
// app's approval) draws it.
import type { ReactNode } from "react";
import { cn } from "@/components/kit/cn";

// The mark, on the way in. Same folder as the sidebar draws — a person who
// signs in should see the thing they are signing in to, not a bare heading.
export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-fg" aria-hidden>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <path d="M3 11h18" />
        <circle cx="20.6" cy="19.4" r="3" fill="var(--color-surface)" stroke="none" />
        <circle cx="20.6" cy="19.4" r="1.9" fill="var(--color-success)" stroke="none" />
      </svg>
      <span className="font-cal text-base tracking-tight text-fg">foldrun</span>
    </div>
  );
}

export function AuthCard({
  title,
  hint,
  children,
  footer,
  wide = false,
  center = false,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  /** Under the card: "New here? Create an account". */
  footer?: ReactNode;
  /** An approval page with more to read (an AI app's request). */
  wide?: boolean;
  /** A message with no form: centred text. */
  center?: boolean;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-paper px-4 py-10">
      <div className={cn("w-full overflow-hidden rounded-xl border border-line bg-surface shadow-sm", wide ? "max-w-md" : "max-w-sm")}>
        <div className={cn("space-y-3 px-6 pb-2 pt-6 sm:px-8 sm:pt-8", center && "text-center")}>
          <Brand className={center ? "justify-center" : undefined} />
          {title && <h1 className="pt-1 text-xl font-semibold tracking-tight text-fg">{title}</h1>}
          {hint && <div className="text-sm text-fg-muted">{hint}</div>}
        </div>
        {children && <div className="px-6 pb-6 pt-4 sm:px-8 sm:pb-8">{children}</div>}
        {!children && <div className="pb-4 sm:pb-6" />}
      </div>
      {footer && <div className="text-center text-sm text-fg-muted">{footer}</div>}
    </main>
  );
}
