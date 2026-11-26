// How long an emailed sign-in code works, and how every sentence says so.
// The code's expiry (login-codes.ts), its mail and the sign-in page all read
// CODE_MS from here, so a change to the lifetime changes the words with it.
// No imports: a client component may read it.

/** How long an emailed code works. */
export const CODE_MS = 5 * 60_000;

/** A lifetime as people say it: "5 minutes", "1 minute", "90 seconds". */
export function lifetimeText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s % 60 !== 0) return `${s} ${s === 1 ? "second" : "seconds"}`;
  const m = s / 60;
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
}

/** "5 minutes" for the code's own lifetime. */
export const CODE_LIFETIME_TEXT = lifetimeText(CODE_MS);

/** The sign-in code mail's body. */
export const codeMailText = (code: string): string =>
  `Your foldrun sign-in code is ${code}\n\n` +
  `It works for ${CODE_LIFETIME_TEXT}, once, in the browser where you asked for it.\n` +
  `If you did not ask for it, ignore this email: nobody can sign in with it without being in that browser.\n`;
