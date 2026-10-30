// The storage browser's rules, apart from React: what kind a file is, how
// old, where it came from, whether it is shared, and what a search keeps.

export interface BrowserShare {
  /** The handle to revoke by; never fetches anything. */
  id: string;
  /** The token and URL, only for an admin or the link's maker (30 Oct 2026);
   *  null for anyone else, who sees the file is shared but cannot copy it. */
  token: string | null;
  url: string | null;
  expiresAt: string | null;
}
export interface BrowserFile {
  workspace: string;
  path: string;
  size: number;
  mime: string;
  updatedAt: string;
  /** `user:<email>`, `run:<runId>:<agent>`, or whatever the store recorded. */
  by: string;
  share: BrowserShare | null;
}
export interface BrowserDesk {
  workspace: string;
  files: BrowserFile[];
}

export type FileKind = "image" | "video" | "audio" | "pdf" | "text" | "data" | "sheet" | "archive" | "page" | "font" | "model" | "mail" | "other";

const EXT: Record<string, FileKind> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", avif: "image", svg: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio",
  pdf: "pdf",
  md: "text", mdx: "text", txt: "text", log: "text",
  json: "data", jsonl: "data", yaml: "data", yml: "data", xml: "data",
  csv: "sheet", tsv: "sheet", xlsx: "sheet", xls: "sheet",
  zip: "archive", gz: "archive", tgz: "archive", tar: "archive",
  html: "page", htm: "page",
};
const MORE: Record<string, FileKind> = {
  ttf: "font", otf: "font", woff: "font", woff2: "font",
  stl: "model", obj: "model", ply: "model", glb: "model", gltf: "model", fbx: "model", "3ds": "model", dae: "model",
  eml: "mail", msg: "mail", mht: "mail", mhtml: "mail", ics: "mail", vcf: "mail",
  ai: "pdf", jfif: "image", apng: "image", cur: "image", psd: "image", psb: "image", dng: "image", cr2: "image", cr3: "image", nef: "image", arw: "image", raf: "image", orf: "image", rw2: "image", jxl: "image", svgz: "image",
  flac: "audio", aac: "audio", opus: "audio", oga: "audio", aif: "audio", aiff: "audio", m4r: "audio", m4b: "audio", wma: "audio",
  mkv: "video", ogv: "video", "3gp": "video", avi: "video", mpg: "video", mpeg: "video", wmv: "video", mts: "video",
  odp: "text", ppt: "text", xls: "sheet", pages: "text", ipynb: "data",
  bz2: "archive", xz: "archive", iso: "archive", dmg: "archive",
  docx: "text", doc: "text", odt: "text", rtf: "text", pptx: "text", key: "text",
  xlsm: "sheet", ods: "sheet", numbers: "sheet",
  ts: "data", tsx: "data", js: "data", mjs: "data", py: "data", sh: "data", sql: "data", css: "data", toml: "data", ini: "data", env: "data",
  bmp: "image", ico: "image", tif: "image", tiff: "image", heic: "image",
  "7z": "archive", rar: "archive", jar: "archive", epub: "archive",
};
export function kindOf(path: string): FileKind {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return path.includes(".") ? EXT[ext] ?? MORE[ext] ?? "other" : "other";
}

/** How the preview panel shows a file: pictures, video, audio and PDF from
 *  the file itself; everything else from the server's preview of it (text,
 *  a table, a document, slides, an archive's listing, a page's source, an
 *  SVG drawn as a picture, or hex) — so every file shows something. */
// What a browser draws or plays by itself (and core's previewType serves
// inline); anything else goes through the server's reading of the file.
const NATIVE: Record<string, "image" | "video" | "audio" | "pdf" | "font"> = {
  png: "image", jpg: "image", jpeg: "image", jfif: "image", webp: "image", gif: "image", avif: "image", bmp: "image", ico: "image", cur: "image", apng: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video", mkv: "video", ogv: "video", "3gp": "video", "3gpp": "video", "3g2": "video", mpg: "video", mpeg: "video", avi: "video",
  mp3: "audio", wav: "audio", m4a: "audio", m4r: "audio", m4b: "audio", aac: "audio", ogg: "audio", oga: "audio", opus: "audio", flac: "audio", aif: "audio", aiff: "audio", weba: "audio",
  pdf: "pdf", ai: "pdf",
  ttf: "font", otf: "font", woff: "font", woff2: "font",
};
export function previewAs(path: string): "image" | "video" | "audio" | "pdf" | "font" | "server" {
  const ext = path.includes(".") ? path.toLowerCase().split(".").pop() ?? "" : "";
  return NATIVE[ext] ?? "server";
}

/** The server's preview (server/doc-preview.ts), as the browser receives it. */
export type ServerPreview =
  | { kind: "text"; format: "markdown" | "json" | "code" | "plain"; language?: string; text: string; truncated: boolean }
  | { kind: "table"; sheets: { name: string; rows: string[][]; truncated: boolean }[] }
  | { kind: "document"; blocks: { style: "h1" | "h2" | "h3" | "p" | "li"; text: string }[]; truncated: boolean; note?: string }
  | { kind: "slides"; slides: { title: string; lines: string[] }[] }
  | { kind: "archive"; entries: { name: string; size: number }[]; truncated: boolean }
  | { kind: "html"; html: string; truncated: boolean }
  | { kind: "svg"; svg: string }
  | { kind: "image"; mime: string; data: string; note: string }
  | { kind: "email"; headers: { name: string; value: string }[]; body: string; attachments: string[] }
  | { kind: "calendar"; events: { title: string; start: string; end: string; where: string; notes: string }[] }
  | { kind: "contacts"; people: { name: string; lines: string[] }[] }
  | { kind: "notebook"; cells: { type: "markdown" | "code" | "raw"; source: string; outputs: string[] }[] }
  | { kind: "link"; url: string }
  | { kind: "mesh"; triangles: number[]; count: number; truncated: boolean }
  | { kind: "binary"; hex: string; size: number; note?: string };

/** "just now", "5m ago", "3h ago", "2d ago", "4w ago", "7mo ago". */
export function fmtAge(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Where a file came from, for a person. */
export function provenance(by: string): { kind: "run"; runId: string; agent: string } | { kind: "user"; who: string } | { kind: "unknown" } {
  const run = by.match(/^run:([^:]+):(.+)$/);
  if (run) return { kind: "run", runId: run[1], agent: run[2] };
  const user = by.match(/^user:(.+)$/);
  if (user) return { kind: "user", who: user[1] };
  return { kind: "unknown" };
}

/** Whether a file is shared, and for how long. */
export function shareState(share: BrowserShare | null, now: number): { state: "private" } | { state: "shared"; label: string; soon: boolean } {
  if (!share) return { state: "private" };
  if (!share.expiresAt) return { state: "shared", label: "shared · no expiry", soon: false };
  const ms = Date.parse(share.expiresAt) - now;
  if (ms <= 0) return { state: "private" };
  // Rounded, not ceiled: a link made a minute after the page loaded is a
  // 7-day link, not an 8-day one.
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  const days = Math.round(ms / 86_400_000);
  return { state: "shared", label: hours >= 36 ? `shared · ${days}d left` : `shared · ${hours}h left`, soon: hours < 24 };
}

export type BrowserFilter = "all" | "shared" | "image" | "video" | "pdf" | "doc";
export const FILTERS: { key: BrowserFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "shared", label: "Shared" },
  { key: "image", label: "Images" },
  { key: "video", label: "Video" },
  { key: "pdf", label: "PDFs" },
  { key: "doc", label: "Documents" },
];

export function matches(f: BrowserFile, q: string, filter: BrowserFilter, now: number): boolean {
  if (q && !`${f.workspace}/${f.path}`.toLowerCase().includes(q.toLowerCase())) return false;
  const k = kindOf(f.path);
  switch (filter) {
    case "all": return true;
    case "shared": return shareState(f.share, now).state === "shared";
    case "image": return k === "image";
    case "video": return k === "video" || k === "audio";
    case "pdf": return k === "pdf";
    case "doc": return k === "text" || k === "data" || k === "sheet" || k === "page";
  }
}

/** The desks with what survives the search, newest file first; empty desks
 *  are kept only when nothing is being searched for. */
export function visibleDesks(desks: BrowserDesk[], q: string, filter: BrowserFilter, now: number): BrowserDesk[] {
  const searching = q.trim() !== "" || filter !== "all";
  return desks
    .map((d) => ({ workspace: d.workspace, files: d.files.filter((f) => matches(f, q.trim(), filter, now)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }))
    .filter((d) => d.files.length > 0 || !searching);
}
