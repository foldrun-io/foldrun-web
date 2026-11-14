// Sign-up links (14 Nov 2026): a link the platform mails to ONE address that
// opens a new account there, even while registration is closed.
//
// Trusted server code mints it — today a partner storefront's signed call
// (foldrun.ir: a customer who wants to pay in Toman and has no account yet).
// The person gets it only in their inbox, so opening it is the proof that
// the address is theirs: the account starts verified. Nothing is stored: the
// token is signed under the install key (auth-tokens.ts) and names the
// address, who asked for it and where to go after. It works once in effect —
// an address has one login, so a second use is refused as taken.
//
// The door it comes in by is `link` (core signup.ts), which earns no trial.

import { mintToken, readToken, SIGNUP_LINK_TTL_MS } from "@/server/auth-tokens";

export interface SignupLink {
  /** The one address the account may be opened for, lower-cased. */
  email: string;
  /** Who asked for it, for the audit line: `partner:ir`. */
  from: string;
  /** Where the person goes once the account exists: an absolute https URL
   *  the minting code chose, or null for the dashboard. */
  next: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FROM = /^[a-z]+(:[a-z0-9-]+)?$/;

/** An absolute https URL with no credentials, or null. */
function cleanNext(next: string | null | undefined): string | null {
  if (!next) return null;
  try {
    const u = new URL(next);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** The link to mail: `<origin>/signup?link=…`, good for seven days. */
export function signupLinkUrl(origin: string, link: { email: string; from: string; next?: string | null }): string {
  const email = link.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("that is not an email address");
  if (!FROM.test(link.from)) throw new Error("from: a short name such as partner:ir");
  const next = cleanNext(link.next);
  if (link.next && !next) throw new Error("next: an absolute https URL");
  const token = mintToken("signup-link", { e: email, f: link.from, ...(next ? { n: next } : {}) }, SIGNUP_LINK_TTL_MS);
  return `${origin.replace(/\/+$/, "")}/signup?link=${encodeURIComponent(token)}`;
}

/** What a still-good, correctly signed link says; null for anything else. */
export function readSignupLink(token: string | null | undefined): SignupLink | null {
  if (typeof token !== "string" || !token || token.length > 2048) return null;
  const c = readToken("signup-link", token);
  if (!c || typeof c.e !== "string" || !EMAIL.test(c.e) || typeof c.f !== "string" || !FROM.test(c.f)) return null;
  return { email: c.e, from: c.f, next: cleanNext(c.n) };
}
