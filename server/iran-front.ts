// The API's address for callers in Iran (FOL-398, 27 Nov 2026).
//
// Iran's filter freezes a connection to a little-known foreign name once it
// has carried ~20–30 KB (measured from an Iranian line: api.foldrun.io and
// api.foldrun.dev hang, while *.cloudfront.net passes 400 KB in a second). A
// coding agent's request is always bigger, so koder and Claude Code worked
// there only through a VPN. The same API is served under a CloudFront name
// (infra: staging/terraform/iran-front.tf); this answers that name, in place
// of the install's own, to a caller in Iran — wherever the platform tells a
// program where to call: /v1/version's urls.api (which `foldrun login`
// moves a machine to), modelsUrl and a key's gatewayUrl (ANTHROPIC_BASE_URL).
// Sign-in and those answers are small, so they reach us from Iran directly.
//
// Who is in Iran: Cloudflare's country for the caller (only behind
// Cloudflare with the edge stamp, as cli-login's requestOrigin reads it), or
// the front's own stamp — the CloudFront front sets `x-foldrun-front: ir` on
// every request it carries, whose country Cloudflare sees as CloudFront's, so
// a caller already on the front keeps being told the front. Either may be
// claimed by anyone; it only ever picks between two addresses of the same
// API, so a false claim gains nothing.

/** The header the Iran front stamps on what it carries. */
export const FRONT_HEADER = "x-foldrun-front";

/** The front's address (FOLDRUN_IRAN_API_URL, an https origin), else null:
 *  an install without one answers its own address to everyone. */
export function iranFrontUrl(): string | null {
  const v = process.env.FOLDRUN_IRAN_API_URL?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Whether this request is from a caller the front is for. */
export function fromIran(req: { headers: Headers }): boolean {
  if (req.headers.get(FRONT_HEADER)?.trim().toLowerCase() === "ir") return true;
  if (process.env.FOLDRUN_TRUST_PROXY !== "cloudflare") return false;
  return req.headers.get("cf-ipcountry")?.trim().toUpperCase() === "IR";
}

/** The address to give this caller for `base` (the install's API or
 *  gateway address): the front for a caller in Iran when the install has
 *  one, else `base`. An install with no address of its own (null) keeps
 *  none: the front stands in for an address, never invents one. */
export function addressFor(req: { headers: Headers } | undefined, base: string | null): string | null {
  if (!base || !req) return base;
  const front = iranFrontUrl();
  return front && fromIran(req) ? front : base;
}
