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
// Since FOL-402 the front and the notice told with it are console settings
// (network.iran_api_url, network.iran_notice*: foldrun-platform
// network-front.ts), FOLDRUN_IRAN_API_URL their fallback: moving to a new
// front when one is blocked is one change, no deploy.

import { FRONT_HEADER, fromIranHeaders, iranFrontUrl, iranFronts, noticeFor, type Notice } from "@/platform/network-front";

export { FRONT_HEADER, iranFrontUrl, iranFronts, type Notice };

/** Whether this request is from a caller the front is for. */
export function fromIran(req: { headers: Headers }): boolean {
  return fromIranHeaders(req.headers);
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

/** Every front, for a caller in Iran only (doctor's probes, the CLI's route
 *  switch): to anyone else, none — the fronts are not advertised. */
export function frontsFor(req: { headers: Headers } | undefined): string[] {
  return req && fromIran(req) ? iranFronts() : [];
}

/** The operator's notice for this caller (FOL-402), or null. */
export function noticeForRequest(req: { headers: Headers } | undefined): Notice | null {
  return req ? noticeFor(req.headers) : null;
}
