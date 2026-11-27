// Which language a page request is in, from its host and the person's
// choice. No imports: the proxy runs this before anything else.
//
// English everywhere, except on a host the install lists as Persian
// (FOLDRUN_FA_HOSTS, comma-separated), where it is Persian unless the person
// chose English there. The choice is honoured on a Persian host only, so an
// English site never changes language. Hosts are compared by name: a port in
// the setting or in the request does not matter.

export const LOCALE_COOKIE = "foldrun_locale";

const name = (host: string) => host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

/** True on a host the install lists as Persian: there, and only there, a
 *  person may choose between Persian and English. */
export function offersPersian(host: string | null | undefined, setting = process.env.FOLDRUN_FA_HOSTS): boolean {
  const persian = (setting ?? "").split(",").map(name).filter(Boolean);
  return !!host && persian.includes(name(host));
}

export function localeForHost(host: string | null | undefined, choice: string | null | undefined, setting = process.env.FOLDRUN_FA_HOSTS): "en" | "fa" {
  if (!offersPersian(host, setting)) return "en";
  return choice === "en" ? "en" : "fa";
}
