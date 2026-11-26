// A free account name to offer when the one asked for is taken. The account
// name stays the unique id (URLs, API, storage); this only proposes another,
// so two people may still be "Acme" by sharing nothing but the word. A twin
// of foldrun-admin's shared/account-names.ts, which the console reads (it
// cannot import this repo): change both together.
// No imports: a test or a client component may read it.

/** The sentence a sign-up or a new customer is refused with. */
export const NAME_TAKEN = "that account name is taken";

const MAX = 40;

/** What an account name allows (core store.ts SAFE_NAME), made of any text. */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX).replace(/-+$/g, "");
}

/** The names worth offering, best first: `acme-2`, one made from the
 *  address (`jane.doe@x.com` → `jane-doe`), `acme-3` … `acme-30`. */
export function candidates(wanted: string, email: string): string[] {
  const base = slug(wanted).slice(0, MAX - 3).replace(/-+$/g, "");
  const fromEmail = slug(email.split("@")[0] ?? "");
  const out = [...(base ? [`${base}-2`] : []), ...(fromEmail ? [fromEmail] : [])];
  if (base) for (let n = 3; n <= 30; n++) out.push(`${base}-${n}`);
  if (fromEmail) for (let n = 2; n <= 5; n++) out.push(`${fromEmail.slice(0, MAX - 3)}-${n}`);
  return [...new Set(out)].filter((c) => c !== slug(wanted));
}

/** The first of them that is free, or null. `free` is asked of one name at a time. */
export async function suggestAccountName(wanted: string, email: string, free: (name: string) => boolean | Promise<boolean>): Promise<string | null> {
  for (const c of candidates(wanted, email)) if (await free(c)) return c;
  return null;
}
