// What a stored file looks like, for the storage browser's preview, built
// here on the server so every format the browser cannot open by itself
// still shows something true: text as text (markdown, code, JSON pretty),
// a CSV or a spreadsheet as a table, a Word document's paragraphs, a deck's
// slides, an archive's contents, a web page's source (and a script-free
// rendering of it), an SVG as a picture, and anything else as the first
// bytes in hex. Nothing here executes the file.

import zlib from "node:zlib";
import path from "node:path";

export type Preview =
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

const TEXT_LIMIT = 400_000;
const ROW_LIMIT = 500;
const COL_LIMIT = 60;
/** The most any one inflate may produce. A member or a .gz declares its
 *  own size, and a few KB of zeros can declare anything, so the cap is on
 *  the output itself: past it, zlib stops and the file gets no preview. */
const INFLATE_LIMIT = 50 * 1024 * 1024;

// ---------------------------------------------------------------- zip

/** The members of a zip (docx, xlsx, pptx, odt, zip itself), read from its
 *  central directory. Only what the preview needs: names, sizes, and the
 *  bytes of a named member, inflated. */
export function readZip(buf: Buffer): { entries: { name: string; size: number }[]; read: (name: string) => Buffer | null } {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const members = new Map<string, { method: number; csize: number; size: number; local: number }>();
  const entries: { name: string; size: number }[] = [];
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const xlen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nlen).toString("utf8");
    members.set(name, { method, csize, size, local });
    entries.push({ name, size });
    off += 46 + nlen + xlen + clen;
  }
  const read = (name: string): Buffer | null => {
    const m = members.get(name);
    if (!m || m.size > INFLATE_LIMIT) return null;
    const l = m.local;
    if (buf.readUInt32LE(l) !== 0x04034b50) return null;
    const start = l + 30 + buf.readUInt16LE(l + 26) + buf.readUInt16LE(l + 28);
    const data = buf.subarray(start, start + m.csize);
    if (m.method === 0) return Buffer.from(data);
    if (m.method === 8) {
      try { return zlib.inflateRawSync(data, { maxOutputLength: INFLATE_LIMIT }); } catch { return null; }
    }
    return null;
  };
  return { entries, read };
}

// ---------------------------------------------------------------- xml

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function unxml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? _);
}

/** A Word document's paragraphs, with headings and list items told apart. */
export function docxBlocks(xml: string): { style: "h1" | "h2" | "h3" | "p" | "li"; text: string }[] {
  const out: { style: "h1" | "h2" | "h3" | "p" | "li"; text: string }[] = [];
  for (const p of xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []) {
    const text = unxml((p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? [])
      .map((t) => (t === "<w:tab/>" ? "\t" : t === "<w:br/>" ? "\n" : t.replace(/<[^>]+>/g, "")))
      .join(""));
    if (!text.trim()) continue;
    const style = (p.match(/<w:pStyle w:val="([^"]+)"/) ?? [])[1] ?? "";
    const h = style.match(/^(?:Heading|heading|Titre|Title)\s*(\d)?/);
    out.push({ style: h ? (h[1] === "1" || !h[1] ? "h1" : h[1] === "2" ? "h2" : "h3") : /<w:numPr>/.test(p) || /^List/i.test(style) ? "li" : "p", text });
  }
  return out;
}

/** Column letters to an index: A → 0, AA → 26. */
const colIndex = (ref: string) => [...(ref.match(/^[A-Z]+/)?.[0] ?? "A")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** A spreadsheet's sheets as rows of text, with shared strings resolved. */
export function xlsxSheets(zip: ReturnType<typeof readZip>): { name: string; rows: string[][]; truncated: boolean }[] {
  const shared = (zip.read("xl/sharedStrings.xml")?.toString("utf8").match(/<si>[\s\S]*?<\/si>/g) ?? []).map((si) =>
    unxml((si.match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  const book = zip.read("xl/workbook.xml")?.toString("utf8") ?? "";
  const names = [...book.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => unxml(m[1]));
  const sheetFiles = zip.entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return sheetFiles.slice(0, 12).map((file, i) => {
    const xml = zip.read(file)?.toString("utf8") ?? "";
    const rows: string[][] = [];
    let truncated = false;
    for (const row of xml.match(/<row[\s>][\s\S]*?<\/row>/g) ?? []) {
      if (rows.length >= ROW_LIMIT) { truncated = true; break; }
      const cells: string[] = [];
      for (const c of row.match(/<c\s[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const ref = (c.match(/\br="([A-Z]+)\d+"/) ?? [])[1] ?? "";
        const t = (c.match(/\bt="([^"]+)"/) ?? [])[1];
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
        const inline = (c.match(/<is>[\s\S]*?<\/is>/) ?? [])[0];
        let val = "";
        if (t === "s" && v !== undefined) val = shared[Number(v)] ?? "";
        else if (inline) val = unxml(inline.replace(/<[^>]+>/g, ""));
        else if (v !== undefined) val = unxml(v);
        const at = ref ? colIndex(ref) : cells.length;
        if (at >= COL_LIMIT) continue;
        while (cells.length < at) cells.push("");
        cells[at] = val;
      }
      rows.push(cells);
    }
    return { name: names[i] ?? `Sheet ${i + 1}`, rows, truncated };
  });
}

/** A deck's slides: the first line as the title, the rest as its lines. */
export function pptxSlides(zip: ReturnType<typeof readZip>): { title: string; lines: string[] }[] {
  const files = zip.entries.map((e) => e.name).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return files.slice(0, 200).map((f) => {
    const xml = zip.read(f)?.toString("utf8") ?? "";
    const lines = (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [])
      .map((p) => unxml((p.match(/<a:t>[\s\S]*?<\/a:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")))
      .filter((l) => l.trim());
    return { title: lines[0] ?? "(no text)", lines: lines.slice(1) };
  });
}

/** An OpenDocument text's paragraphs. */
export function odtBlocks(xml: string): { style: "h1" | "h2" | "h3" | "p" | "li"; text: string }[] {
  const out: { style: "h1" | "h2" | "h3" | "p" | "li"; text: string }[] = [];
  for (const m of xml.matchAll(/<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>/g)) {
    const text = unxml(m[3].replace(/<text:tab\/>/g, "\t").replace(/<text:line-break\/>/g, "\n").replace(/<[^>]+>/g, ""));
    if (!text.trim()) continue;
    const level = (m[2].match(/outline-level="(\d)"/) ?? [])[1];
    out.push({ style: m[1] === "h" ? (level === "1" ? "h1" : level === "2" ? "h2" : "h3") : "p", text });
  }
  return out;
}

// ---------------------------------------------------------------- text

/** Rows from CSV or TSV, quotes honoured. */
export function parseDelimited(text: string, sep: string): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
      if (ch === "\r") i++;
      row.push(cell); rows.push(row.slice(0, COL_LIMIT)); row = []; cell = "";
      if (rows.length >= ROW_LIMIT) return { rows, truncated: i < text.length - 1 };
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row.slice(0, COL_LIMIT)); }
  return { rows, truncated: false };
}

/** Text a person can read: valid UTF-8, no NUL, mostly printable. */
export function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return false;
  const s = sample.toString("utf8");
  if (s.includes("�") && Buffer.from(s, "utf8").length !== sample.length) return false;
  let odd = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) odd++;
  }
  return odd <= s.length * 0.02;
}

const CODE: Record<string, string> = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".ts": "typescript", ".tsx": "tsx", ".jsx": "jsx",
  ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".swift": "swift",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".cs": "csharp", ".php": "php", ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".sql": "sql", ".css": "css", ".scss": "scss", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".ini": "ini",
  ".xml": "xml", ".env": "dotenv", ".dockerfile": "dockerfile", ".graphql": "graphql", ".r": "r", ".lua": "lua",
};

function hexDump(buf: Buffer): string {
  const lines: string[] = [];
  const b = buf.subarray(0, 1024);
  for (let i = 0; i < b.length; i += 16) {
    const chunk = b.subarray(i, i + 16);
    const hex = [...chunk].map((x) => x.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...chunk].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join("");
    lines.push(`${i.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- pictures inside

/** The largest JPEG embedded in a file — camera raw, Photoshop, TIFF and
 *  HEIC-with-thumbnail all carry one — found by its markers. Each start
 *  pairs with the first end marker after it, which is searched for again
 *  only once a start has passed it: a file of nothing but start markers
 *  is one pass, not one pass per marker. */
export function embeddedJpeg(buf: Buffer): Buffer | null {
  const SOI = Buffer.from([0xff, 0xd8, 0xff]);
  const EOI = Buffer.from([0xff, 0xd9]);
  let best: Buffer | null = null;
  let i = 0;
  let end = -1;
  const limit = Math.min(buf.length, 200 * 1024 * 1024);
  while (i < limit - 4) {
    const start = buf.indexOf(SOI, i);
    if (start < 0) break;
    if (end < start + 3) end = buf.indexOf(EOI, start + 3);
    if (end < 0) break;
    const len = end + 2 - start;
    if (len > 2048 && (!best || len > best.length)) best = buf.subarray(start, end + 2);
    i = start + 3;
  }
  return best;
}

const ZIP_PREVIEWS = ["QuickLook/Preview.jpg", "QuickLook/Thumbnail.jpg", "preview.jpg", "Preview.jpg", "previews/preview.png", "Thumbnails/thumbnail.png", "docProps/thumbnail.jpeg", "docProps/thumbnail.png"];

function imageOf(buf: Buffer, note: string): Preview {
  const png = buf[0] === 0x89 && buf[1] === 0x50;
  return { kind: "image", mime: png ? "image/png" : "image/jpeg", data: buf.toString("base64"), note };
}

// ---------------------------------------------------------------- legacy and plain formats

/** Text recovered from an old binary Office file (.doc, .xls, .ppt): the runs
 *  of UTF-16 and ASCII text long enough to be words, in order. */
export function recoverText(buf: Buffer): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // The container's own names (OLE storage directories), not the document's.
  const OLE = /^(Root Entry|Workbook|Book|WordDocument|[01]Table|Data|CompObj|ObjectPool|SummaryInformation|DocumentSummaryInformation|PowerPoint Document|Current User|Pictures|Ole|Microsoft (Word|Excel|PowerPoint)[\w\s.-]*|MSWordDoc|Word\.Document\.\d+|Excel\.Sheet\.\d+|Biff\d|Normal(\.dotm?)?|Times New Roman|Arial|Calibri|Cambria|Symbol|Wingdings|Courier New)$/i;
  const push = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t.length >= 6 && /[a-zA-Z]{3}/.test(t) && !OLE.test(t) && !/^None\b/.test(t) && !seen.has(t)) { seen.add(t); out.push(t); }
  };
  // UTF-16LE: printable char then 0x00.
  let cur = "";
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const c = buf.readUInt16LE(i);
    if ((c >= 32 && c < 0xd800 && c !== 0xfffd) || c === 9) cur += String.fromCharCode(c);
    else if (c === 13 || c === 10) { push(cur); cur = ""; }
    else { push(cur); cur = ""; }
  }
  push(cur);
  if (out.length < 3) {
    for (const m of buf.toString("latin1").matchAll(/[\x20-\x7e\t]{8,}/g)) push(m[0]);
  }
  return out.slice(0, 3000);
}

/** Every string an old Excel workbook (.xls, BIFF8) holds, from its shared
 *  string table — the cells' text, in the order Excel stored it. */
export function xlsStrings(buf: Buffer): string[] | null {
  for (let at = buf.indexOf(Buffer.from([0xfc, 0x00])); at >= 0; at = buf.indexOf(Buffer.from([0xfc, 0x00]), at + 1)) {
    if (at + 12 > buf.length) break;
    const len = buf.readUInt16LE(at + 2);
    const total = buf.readUInt32LE(at + 4), unique = buf.readUInt32LE(at + 8);
    if (unique === 0 || unique > total || unique > 1_000_000 || len < 8) continue;
    // The record, with any CONTINUE records after it joined on.
    const parts = [buf.subarray(at + 12, at + 4 + len)];
    let next = at + 4 + len;
    while (next + 4 <= buf.length && buf.readUInt16LE(next) === 0x003c) {
      const l = buf.readUInt16LE(next + 2);
      parts.push(buf.subarray(next + 4, next + 4 + l));
      next += 4 + l;
    }
    const data = Buffer.concat(parts);
    const out: string[] = [];
    let o = 0;
    try {
      for (let n = 0; n < unique && o + 3 <= data.length; n++) {
        const cch = data.readUInt16LE(o);
        const flags = data[o + 2];
        o += 3;
        const runs = flags & 0x08 ? data.readUInt16LE(o) : 0;
        if (flags & 0x08) o += 2;
        const ext = flags & 0x04 ? data.readUInt32LE(o) : 0;
        if (flags & 0x04) o += 4;
        const wide = flags & 0x01;
        const bytes = cch * (wide ? 2 : 1);
        out.push(wide ? data.subarray(o, o + bytes).toString("utf16le") : data.subarray(o, o + bytes).toString("latin1"));
        o += bytes + runs * 4 + ext;
      }
    } catch {
      // a string cut by a CONTINUE boundary ends the read; what came before stands
    }
    if (out.length) return out;
  }
  return null;
}

/** An RTF document as paragraphs. A small reader: groups are walked, the
 *  ones that hold settings rather than text (font and colour tables,
 *  stylesheets, document info, anything marked \* or a picture) skipped
 *  whole, control words turned into what they stand for. */
export function rtfBlocks(s: string): { style: "p"; text: string }[] {
  const SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "latentstyles", "themedata", "colorschememapping", "datastore", "expandedcolortbl", "listtext", "pntext"]);
  let out = "";
  const skipAt: number[] = []; // depths being skipped
  let depth = 0;
  let uc = 1;
  let skipChars = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") { depth++; continue; }
    if (ch === "}") { if (skipAt.length && skipAt[skipAt.length - 1] === depth) skipAt.pop(); depth--; continue; }
    const skipping = skipAt.length > 0;
    if (ch === "\\") {
      const next = s[i + 1];
      if (next === "*") { if (!skipping) skipAt.push(depth); i++; continue; }
      if (next === "'") { if (!skipping && skipChars === 0) out += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)); else if (skipChars) skipChars--; i += 3; continue; }
      if (next === "\\" || next === "{" || next === "}") { if (!skipping) out += next; i++; continue; }
      // A backslash ending a line is a paragraph mark (what TextEdit writes).
      if (next === "\n" || next === "\r") { if (!skipping) out += "\n"; i++; continue; }
      const m = s.slice(i + 1, i + 40).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (!m) { i++; continue; }
      i += m[0].length;
      const word = m[1];
      if (SKIP.has(word) && !skipping) { skipAt.push(depth); continue; }
      if (skipping) continue;
      if (word === "par" || word === "line" || word === "sect" || word === "page") out += "\n";
      else if (word === "tab") out += "\t";
      else if (word === "uc") uc = Number(m[2] ?? 1);
      else if (word === "u") { out += String.fromCharCode((Number(m[2]) + 65536) % 65536); skipChars = uc; }
      else if (word === "emdash") out += "—";
      else if (word === "endash") out += "–";
      else if (word === "bullet") out += "•";
      else if (word === "lquote" || word === "rquote") out += "'";
      else if (word === "ldblquote" || word === "rdblquote") out += '"';
      continue;
    }
    if (skipping) continue;
    if (ch === "\r" || ch === "\n") continue;
    if (skipChars > 0) { skipChars--; continue; }
    out += ch;
  }
  return out.split(/\n+/).map((x) => x.trim()).filter(Boolean).map((text) => ({ style: "p" as const, text }));
}

/** OpenDocument spreadsheet rows and presentation slides, from content.xml. */
export function odsSheets(xml: string): { name: string; rows: string[][]; truncated: boolean }[] {
  return [...xml.matchAll(/<table:table\b[^>]*table:name="([^"]*)"[^>]*>([\s\S]*?)<\/table:table>/g)].slice(0, 12).map((m) => {
    const rows: string[][] = [];
    for (const r of m[2].match(/<table:table-row\b[\s\S]*?<\/table:table-row>/g) ?? []) {
      if (rows.length >= ROW_LIMIT) break;
      const cells: string[] = [];
      for (const c of r.match(/<table:table-cell\b[^>]*?(?:\/>|>[\s\S]*?<\/table:table-cell>)/g) ?? []) {
        const rep = Math.min(Number((c.match(/number-columns-repeated="(\d+)"/) ?? [])[1] ?? 1), COL_LIMIT);
        const v = unxml(c.replace(/<text:p>/g, "").replace(/<\/text:p>/g, "\n").replace(/<[^>]+>/g, "")).trim();
        for (let k = 0; k < rep && cells.length < COL_LIMIT; k++) cells.push(v);
      }
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (cells.length) rows.push(cells);
    }
    return { name: unxml(m[1]), rows, truncated: false };
  });
}
export function odpSlides(xml: string): { title: string; lines: string[] }[] {
  return [...xml.matchAll(/<draw:page\b[\s\S]*?<\/draw:page>/g)].map((m) => {
    const lines = [...m[0].matchAll(/<text:(?:p|h|span)\b[^>]*>([\s\S]*?)<\/text:(?:p|h|span)>/g)].map((x) => unxml(x[1].replace(/<[^>]+>/g, ""))).filter((l) => l.trim());
    return { title: lines[0] ?? "(no text)", lines: [...new Set(lines.slice(1))] };
  });
}

/** An email (.eml): its headers, its text body, the names of what it carries. */
export function emlOf(s: string): { headers: { name: string; value: string }[]; body: string; attachments: string[] } {
  const split = s.search(/\r?\n\r?\n/);
  const head = split >= 0 ? s.slice(0, split) : s;
  const rest = split >= 0 ? s.slice(split).trim() : "";
  const headers: { name: string; value: string }[] = [];
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m && ["from", "to", "cc", "date", "subject", "reply-to"].includes(m[1].toLowerCase())) headers.push({ name: m[1], value: decodeWords(m[2]) });
  }
  const attachments = [...s.matchAll(/filename="?([^"\r\n;]+)"?/gi)].map((m) => m[1]);
  // The text/plain part when there are parts; quoted-printable and base64 undone.
  let body = rest;
  const boundary = (head.match(/boundary="?([^"\r\n;]+)"?/i) ?? [])[1];
  if (boundary) {
    const parts = rest.split(`--${boundary}`);
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p)) ?? parts.find((p) => /content-type:\s*text\/html/i.test(p)) ?? "";
    const i = plain.search(/\r?\n\r?\n/);
    const ph = plain.slice(0, i);
    body = plain.slice(i).trim();
    if (/base64/i.test(ph)) body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    else if (/quoted-printable/i.test(ph)) body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    if (/text\/html/i.test(ph)) body = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "");
  }
  return { headers, body: body.slice(0, TEXT_LIMIT), attachments };
}
function decodeWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, _cs: string, enc: string, txt: string) =>
    enc.toUpperCase() === "B" ? Buffer.from(txt, "base64").toString("utf8") : txt.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_2, h: string) => String.fromCharCode(parseInt(h, 16))));
}

const icsUnescape = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
/** Calendar events (.ics). */
export function icsEvents(s: string): { title: string; start: string; end: string; where: string; notes: string }[] {
  const unfolded = s.replace(/\r?\n[ \t]/g, "");
  return [...unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].slice(0, 500).map((m) => {
    const get = (k: string) => icsUnescape((m[1].match(new RegExp(`^${k}(?:;[^:]*)?:(.*)$`, "m")) ?? [])[1]?.trim() ?? "");
    const when = (v: string) => { const d = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/); return d ? `${d[1]}-${d[2]}-${d[3]}${d[4] ? ` ${d[4]}:${d[5]}` : ""}${v.endsWith("Z") ? " UTC" : ""}` : v; };
    return { title: get("SUMMARY"), start: when(get("DTSTART")), end: when(get("DTEND")), where: get("LOCATION"), notes: get("DESCRIPTION").slice(0, 500) };
  });
}
/** Contacts (.vcf). */
export function vcfPeople(s: string): { name: string; lines: string[] }[] {
  const unfolded = s.replace(/\r?\n[ \t]/g, "");
  return [...unfolded.matchAll(/BEGIN:VCARD([\s\S]*?)END:VCARD/g)].slice(0, 1000).map((m) => {
    const lines: string[] = [];
    let name = "";
    for (const l of m[1].split(/\r?\n/)) {
      const x = l.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/);
      if (!x) continue;
      const v = icsUnescape(x[2]).replace(/;+/g, " ").trim();
      if (x[1] === "FN") name = v;
      else if (["EMAIL", "TEL", "ORG", "TITLE", "ADR", "URL", "NOTE"].includes(x[1]) && v) lines.push(`${x[1].toLowerCase()}: ${v}`);
    }
    return { name: name || "(no name)", lines };
  });
}

/** A Jupyter notebook's cells, with their text outputs. */
export function notebookCells(s: string): { type: "markdown" | "code" | "raw"; source: string; outputs: string[] }[] {
  const nb = JSON.parse(s) as { cells?: { cell_type: string; source: string | string[]; outputs?: { text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string }[] }[] };
  const join = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join("") : v ?? "");
  return (nb.cells ?? []).slice(0, 500).map((c) => ({
    type: c.cell_type === "markdown" ? "markdown" : c.cell_type === "code" ? "code" : "raw",
    source: join(c.source),
    outputs: (c.outputs ?? []).map((o) => join(o.text) || join(o.data?.["text/plain"]) || (o.ename ? `${o.ename}: ${o.evalue}` : "")).filter(Boolean).map((t) => t.slice(0, 5000)),
  }));
}

// ---------------------------------------------------------------- archives

/** A tar's members (ustar), possibly gzipped. */
export function tarEntries(buf: Buffer): { name: string; size: number }[] {
  const out: { name: string; size: number }[] = [];
  let off = 0;
  while (off + 512 <= buf.length && out.length < 5000) {
    const name = buf.subarray(off, off + 100).toString("utf8").split("\0")[0];
    if (!name) break;
    const size = parseInt(buf.subarray(off + 124, off + 136).toString("utf8").split("\0")[0].trim() || "0", 8) || 0;
    const prefix = buf.subarray(off + 345, off + 500).toString("utf8").split("\0")[0];
    const type = String.fromCharCode(buf[off + 156]);
    if (type !== "x" && type !== "g") out.push({ name: prefix ? `${prefix}/${name}` : name, size: type === "5" ? 0 : size });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

// ---------------------------------------------------------------- 3D

const MESH_LIMIT = 60_000; // triangles
const GLB_ELEMENTS = 10_000_000; // per accessor

/** Triangles (x,y,z × 3 each) from STL (binary or ASCII), OBJ, ASCII PLY or GLB. */
export function meshTriangles(ext: string, buf: Buffer): { triangles: number[]; count: number } | null {
  const tri: number[] = [];
  let count = 0;
  const add = (a: number[], b: number[], c: number[]) => { count++; if (tri.length < MESH_LIMIT * 9) tri.push(...a, ...b, ...c); };
  if (ext === ".stl") {
    const n = buf.length >= 84 ? buf.readUInt32LE(80) : 0;
    if (buf.length === 84 + n * 50 && n > 0) {
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        const v = (k: number) => [buf.readFloatLE(o + k * 12), buf.readFloatLE(o + k * 12 + 4), buf.readFloatLE(o + k * 12 + 8)];
        add(v(0), v(1), v(2));
      }
    } else {
      const vs = [...buf.toString("latin1").matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
      for (let i = 0; i + 2 < vs.length; i += 3) add(vs[i], vs[i + 1], vs[i + 2]);
    }
  } else if (ext === ".obj") {
    const vs: number[][] = [];
    for (const line of buf.toString("utf8").split(/\r?\n/)) {
      if (line.startsWith("v ")) vs.push(line.trim().split(/\s+/).slice(1, 4).map(Number));
      else if (line.startsWith("f ")) {
        const idx = line.trim().split(/\s+/).slice(1).map((t) => { const k = parseInt(t, 10); return k < 0 ? vs.length + k : k - 1; });
        for (let k = 1; k + 1 < idx.length; k++) if (vs[idx[0]] && vs[idx[k]] && vs[idx[k + 1]]) add(vs[idx[0]], vs[idx[k]], vs[idx[k + 1]]);
      }
    }
  } else if (ext === ".ply") {
    const text = buf.toString("latin1");
    const end = text.indexOf("end_header");
    if (end < 0 || !/format ascii/.test(text.slice(0, end))) return null;
    const nv = Number((text.match(/element vertex (\d+)/) ?? [])[1] ?? 0);
    const lines = text.slice(end + 10).trim().split(/\r?\n/);
    const vs = lines.slice(0, nv).map((l) => l.trim().split(/\s+/).slice(0, 3).map(Number));
    for (const l of lines.slice(nv)) {
      const f = l.trim().split(/\s+/).map(Number);
      // A face's vertex count is the file's word; the indices on its line
      // are what there is. "400000000 0" is one index, not 400M loops.
      const n = Math.min(f[0], f.length - 1);
      for (let k = 2; k < n; k++) if (vs[f[1]] && vs[f[k]] && vs[f[k + 1]]) add(vs[f[1]], vs[f[k]], vs[f[k + 1]]);
    }
  } else if (ext === ".glb") {
    if (buf.toString("latin1", 0, 4) !== "glTF") return null;
    const jlen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.toString("utf8", 20, 20 + jlen)) as { meshes?: { primitives: { attributes: { POSITION?: number }; indices?: number }[] }[]; accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[]; bufferViews: { byteOffset?: number; byteStride?: number }[] };
    const bin = 20 + jlen + 8;
    const read = (ai: number): number[] => {
      const a = gltf.accessors[ai];
      const bv = gltf.bufferViews[a.bufferView];
      const comps = a.type === "VEC3" ? 3 : 1;
      const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
      const stride = bv.byteStride ?? comps * size;
      const base = bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      // The accessor's count and stride are the file's word, and a byte
      // read past the end is undefined rather than an error: every element
      // must sit inside the bytes there are, or this is not a mesh.
      if (!Number.isInteger(a.count) || a.count < 0 || a.count > GLB_ELEMENTS) throw new Error("accessor count");
      if (!Number.isInteger(stride) || stride < comps * size) throw new Error("accessor stride");
      if (a.count > 0 && (base < 0 || base + (a.count - 1) * stride + comps * size > buf.length)) throw new Error("accessor out of bounds");
      const out: number[] = [];
      for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
        const o = base + i * stride + c * size;
        out.push(a.componentType === 5126 ? buf.readFloatLE(o) : a.componentType === 5125 ? buf.readUInt32LE(o) : a.componentType === 5123 ? buf.readUInt16LE(o) : buf[o]);
      }
      return out;
    };
    for (const m of gltf.meshes ?? []) for (const p of m.primitives) {
      if (p.attributes.POSITION === undefined) continue;
      const pos = read(p.attributes.POSITION);
      const v = (i: number) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      const idx = p.indices !== undefined ? read(p.indices) : Array.from({ length: pos.length / 3 }, (_, i) => i);
      for (let i = 0; i + 2 < idx.length; i += 3) add(v(idx[i]), v(idx[i + 1]), v(idx[i + 2]));
    }
  } else return null;
  return count ? { triangles: tri, count } : null;
}

/** The preview for a stored file's bytes. `rel` supplies the extension. */
const RAW = new Set([".cr2", ".cr3", ".crw", ".nef", ".nrw", ".arw", ".sr2", ".srf", ".dng", ".raf", ".orf", ".rw2", ".rwl", ".pef", ".srw", ".x3f", ".3fr", ".kdc", ".dcr", ".dcs", ".mrw", ".erf", ".mef", ".mos", ".iiq", ".psd", ".psb", ".tif", ".tiff", ".heic", ".heif", ".jxl", ".jp2"]);
const LEGACY = new Set([".doc", ".dot", ".xls", ".xlt", ".ppt", ".pps", ".pot", ".wpd", ".wps", ".hwp", ".msg", ".pub", ".vsd", ".mpp", ".wri"]);
const PACKED = new Set([".bz2", ".bz", ".xz", ".txz", ".lz", ".lzma", ".tlz", ".7z", ".rar", ".iso", ".dmg", ".cab", ".lzh", ".lha", ".z", ".taz", ".cpio", ".xar", ".zst"]);

/** Throws past INFLATE_LIMIT; previewOf's catch turns that into the hex view. */
const gunzip = (bytes: Buffer) => zlib.gunzipSync(bytes, { maxOutputLength: INFLATE_LIMIT });

export function previewOf(rel: string, bytes: Buffer, depth = 0): Preview {
  const ext = path.extname(rel).toLowerCase();
  const lower = rel.toLowerCase();
  try {
    if (RAW.has(ext)) {
      const jpg = embeddedJpeg(bytes);
      if (jpg) return imageOf(jpg, ext === ".psd" || ext === ".psb" ? "Photoshop's own preview of the image" : "the preview picture stored inside the file");
      return { kind: "binary", hex: hexDump(bytes), size: bytes.length, note: "This image format carries no preview this platform can read — download it to open it in an image editor." };
    }
    if (ext === ".svgz") return { kind: "svg", svg: gunzip(bytes).subarray(0, 2_000_000).toString("utf8") };
    if ([".pages", ".numbers", ".key", ".sketch", ".xd", ".graffle"].includes(ext)) {
      const z = readZip(bytes);
      for (const name of ZIP_PREVIEWS) { const img = z.read(name); if (img?.length) return imageOf(img, "the preview the app saved inside the file"); }
      return { kind: "archive", entries: z.entries.slice(0, 2000), truncated: z.entries.length > 2000 };
    }
    if (ext === ".ods") return { kind: "table", sheets: odsSheets(readZip(bytes).read("content.xml")?.toString("utf8") ?? "") };
    if (ext === ".odp") return { kind: "slides", slides: odpSlides(readZip(bytes).read("content.xml")?.toString("utf8") ?? "") };
    if (ext === ".rtf") return { kind: "document", blocks: rtfBlocks(bytes.subarray(0, 5_000_000).toString("latin1")).slice(0, 3000), truncated: false };
    if (ext === ".xls" || ext === ".xlt") {
      const strings = xlsStrings(bytes);
      if (strings?.length) return { kind: "document", blocks: strings.slice(0, 3000).map((text) => ({ style: "p" as const, text })), truncated: strings.length > 3000, note: "An older Excel workbook: every piece of text its cells hold, in the order Excel stored it — not its grid. Download it for the real thing." };
    }
    if (LEGACY.has(ext)) {
      return { kind: "document", blocks: recoverText(bytes).map((text) => ({ style: "p" as const, text })), truncated: false, note: "An older binary format: this is the text recovered from it, without its layout. Download it for the real thing." };
    }
    if (ext === ".eml" || ext === ".mht" || ext === ".mhtml") return { kind: "email", ...emlOf(bytes.subarray(0, 10_000_000).toString("utf8")) };
    if (ext === ".ics" || ext === ".ical") return { kind: "calendar", events: icsEvents(bytes.toString("utf8")) };
    if (ext === ".vcf" || ext === ".vcard") return { kind: "contacts", people: vcfPeople(bytes.toString("utf8")) };
    if (ext === ".ipynb") return { kind: "notebook", cells: notebookCells(bytes.toString("utf8")) };
    if (ext === ".url" || ext === ".website") {
      const u = (bytes.toString("utf8").match(/^URL=(.+)$/m) ?? [])[1]?.trim();
      if (u) return { kind: "link", url: u };
    }
    if (ext === ".webloc") {
      const u = (bytes.toString("utf8").match(/<string>([^<]+)<\/string>/) ?? [])[1] ?? (bytes.toString("latin1").match(/https?:\/\/[\x21-\x7e]+/) ?? [])[0];
      if (u) return { kind: "link", url: unxml(u) };
    }
    if (ext === ".tar") return { kind: "archive", entries: tarEntries(bytes), truncated: false };
    if (ext === ".tgz" || lower.endsWith(".tar.gz")) return { kind: "archive", entries: tarEntries(gunzip(bytes)), truncated: false };
    if (ext === ".gz" && depth === 0) return previewOf(rel.slice(0, -3), gunzip(bytes), 1);
    if (PACKED.has(ext)) return { kind: "binary", hex: hexDump(bytes), size: bytes.length, note: `Compressed as ${ext.slice(1).toUpperCase()} — a format this preview does not unpack. Download it to open it.` };
    if ([".stl", ".obj", ".ply", ".glb"].includes(ext)) {
      const mesh = meshTriangles(ext, bytes);
      if (mesh) return { kind: "mesh", triangles: mesh.triangles.map((n) => Math.round(n * 1000) / 1000), count: mesh.count, truncated: mesh.count > MESH_LIMIT };
    }
  } catch {
    // a file that claims a format and is not in it falls through to the
    // readers below, which show what it actually is
  }
  const text = (limit = TEXT_LIMIT) => {
    const s = bytes.subarray(0, limit).toString("utf8");
    return { text: s, truncated: bytes.length > limit };
  };
  try {
    if (ext === ".docx" || ext === ".docm" || ext === ".dotx") {
      const z = readZip(bytes);
      const blocks = docxBlocks(z.read("word/document.xml")?.toString("utf8") ?? "");
      return { kind: "document", blocks: blocks.slice(0, 3000), truncated: blocks.length > 3000 };
    }
    if (ext === ".xlsx" || ext === ".xlsm") return { kind: "table", sheets: xlsxSheets(readZip(bytes)) };
    if (ext === ".pptx") return { kind: "slides", slides: pptxSlides(readZip(bytes)) };
    if (ext === ".odt") return { kind: "document", blocks: odtBlocks(readZip(bytes).read("content.xml")?.toString("utf8") ?? ""), truncated: false };
    if ([".zip", ".jar", ".epub", ".apk", ".ods", ".odp", ".key", ".pages", ".numbers"].includes(ext)) {
      const z = readZip(bytes);
      return { kind: "archive", entries: z.entries.slice(0, 2000), truncated: z.entries.length > 2000 };
    }
  } catch {
    // a file that claims a format and is not in it falls through to the
    // generic readers below, which say what it actually is
  }
  if (ext === ".csv" || ext === ".tsv") {
    const { rows, truncated } = parseDelimited(bytes.subarray(0, 5_000_000).toString("utf8"), ext === ".tsv" ? "\t" : ",");
    return { kind: "table", sheets: [{ name: path.basename(rel), rows, truncated }] };
  }
  if (ext === ".svg") return { kind: "svg", svg: bytes.subarray(0, 2_000_000).toString("utf8") };
  if (ext === ".html" || ext === ".htm") return { kind: "html", html: text(1_000_000).text, truncated: bytes.length > 1_000_000 };
  if (!looksLikeText(bytes)) return { kind: "binary", hex: hexDump(bytes), size: bytes.length };
  if (ext === ".md" || ext === ".mdx" || ext === ".markdown") return { kind: "text", format: "markdown", ...text() };
  if (ext === ".json" || ext === ".jsonl" || ext === ".ndjson" || ext === ".geojson") {
    const t = text();
    if (ext === ".json" || ext === ".geojson") {
      try { return { kind: "text", format: "json", text: JSON.stringify(JSON.parse(bytes.toString("utf8")), null, 2).slice(0, TEXT_LIMIT), truncated: t.truncated }; } catch { /* as written */ }
    }
    return { kind: "text", format: "json", ...t };
  }
  if (CODE[ext] || path.basename(rel).toLowerCase() === "dockerfile") return { kind: "text", format: "code", language: CODE[ext] ?? "dockerfile", ...text() };
  return { kind: "text", format: "plain", ...text() };
}
