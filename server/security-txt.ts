// RFC 9116 security.txt, the same lines foldrun.io serves from
// public/.well-known/security.txt. Expires rolls forward a year from the
// request (to midnight UTC), so a box nobody redeployed never serves a
// lapsed file.

const SITE = () => process.env.FOLDRUN_SITE_URL || "https://foldrun.io";
export const SECURITY_CONTACT = "hello@foldrun.io";

export function securityTxt(now = new Date(), canonical?: string): string {
  const expires = new Date(now.getTime() + 365 * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    `Contact: mailto:${SECURITY_CONTACT}`,
    `Expires: ${expires.toISOString().replace(".000Z", "Z")}`,
    "Preferred-Languages: en",
    `Policy: ${SITE()}/security/#report`,
    ...(canonical ? [`Canonical: ${canonical}`] : []),
    "",
  ].join("\n");
}
