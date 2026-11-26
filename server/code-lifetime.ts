// How long an emailed sign-in code works, and how every sentence says so.
// The code's expiry (login-codes.ts), its mail and the sign-in page all read
// CODE_MS from here, so a change to the lifetime changes the words with it.
// Only lifetimes.ts, which has no imports either: a client component may read it.
import { lifetimeText } from "./lifetimes.ts";
export { lifetimeText };

/** How long an emailed code works. */
export const CODE_MS = 5 * 60_000;

/** "5 minutes" for the code's own lifetime. */
export const CODE_LIFETIME_TEXT = lifetimeText(CODE_MS);

/** The sign-in code mail's body. */
export const codeMailText = (code: string): string =>
  `Your foldrun sign-in code is ${code}\n\n` +
  `It works for ${CODE_LIFETIME_TEXT}, once, in the browser where you asked for it.\n` +
  `If you did not ask for it, ignore this email: nobody can sign in with it without being in that browser.\n`;
