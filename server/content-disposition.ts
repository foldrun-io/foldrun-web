// A Content-Disposition header for any file name.
//
// Header values are ByteStrings: a name like "報告.pdf" or "résumé 🎉.pdf"
// written straight into `filename="…"` makes the Headers constructor throw,
// and the download became a 500. RFC 6266: an ASCII `filename` for old
// clients, and the real name percent-encoded as UTF-8 in `filename*`.

/** `inline` or `attachment`, with an ASCII fallback name and the exact one. */
export function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/g, "_");
  const exact = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${exact}`;
}
