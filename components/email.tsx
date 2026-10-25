// An email address as page text that no proxy will rewrite.
//
// Proxies in front of the dashboard may "protect" addresses in HTML —
// Cloudflare's Email Obfuscation turns each into "[email protected]" and
// decodes it later with a script. React then hydrates against text the
// server never sent and throws (#418), re-rendering the page in the browser
// (Settings on dev.foldrun.io, 13 Oct 2026). Rather than depend on how a
// proxy is configured, the server never sends an address as one string: the
// "@" is its own element, so nothing that scans HTML for addresses finds
// one, while the browser shows, copies and reads it exactly as written.
//
// Use it wherever an address is shown on a page the server renders. Text in
// a dialog opened later, a title attribute or a form value is never in the
// server's HTML and needs nothing. The logic is email-model.ts.

import { splitAddress, splitSentence } from "./email-model";

export function Email({ value, className }: { value: string | null | undefined; className?: string }) {
  const parts = splitAddress(value);
  if (!parts) return <span className={className}>{value ?? ""}</span>;
  return (
    <span className={className}>
      {parts[0]}
      <span>@</span>
      {parts[1]}
    </span>
  );
}

/** Any addresses inside a sentence ("Created 4 Oct by ana@x.io"), each made
 *  an <Email>, the rest left as text. */
export function WithEmails({ text }: { text: string }) {
  return <>{splitSentence(text).map((p, i) => (i % 2 ? <Email key={i} value={p} /> : p))}</>;
}
