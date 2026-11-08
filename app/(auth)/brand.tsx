// The way in, cloudhost's AuthCard: one centred card with the mark, a title
// and a line, the form, and a quiet line under the card. Server-safe — every
// sign-in page (sign in, sign up, an invite, a reset, the CLI's and an AI
// app's approval) draws it.
import type { ReactNode } from "react";
import { cn } from "@foldrun/ui/react/cn";
import { FoldrunMark } from "@foldrun/ui/react/mark";

// The mark, on the way in: the same FoldrunMark the sidebar draws — a person who
// signs in should see the thing they are signing in to, not a bare heading.
export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <FoldrunMark size={22} on="surface" />
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
