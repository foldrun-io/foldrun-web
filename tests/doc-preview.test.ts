// What the storage preview turns a stored file into. Every fixture is built
// here from bytes, so the tests say what each format looks like inside.
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { previewOf, readZip, rtfBlocks, emlOf, icsEvents, vcfPeople, tarEntries, meshTriangles, looksLikeText, embeddedJpeg } from "../server/doc-preview.ts";

/** A minimal zip: deflated entries plus the central directory readZip walks. */
function zip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const data = zlib.deflateRawSync(raw);
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function tar(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, body] of Object.entries(files)) {
    const h = Buffer.alloc(512);
    h.write(name, 0); h.write("0000644\0", 100); h.write(body.length.toString(8).padStart(11, "0") + "\0", 124); h.write("0", 156);
    h.write("ustar\0", 257);
    parts.push(h, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

test("zip: entries listed, members readable", () => {
  const z = readZip(zip({ "a.txt": "hello", "dir/b.txt": "world" }));
  assert.deepEqual(z.entries.map((e) => e.name), ["a.txt", "dir/b.txt"]);
  assert.equal(z.read("dir/b.txt")?.toString(), "world");
  const p = previewOf("bundle.zip", zip({ "a.txt": "hello" }));
  assert.equal(p.kind, "archive");
});

test("docx: headings and paragraphs come out in order", () => {
  const doc = `<w:document><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Inspection</w:t></w:r></w:p>
    <w:p><w:r><w:t>The roof is sound &amp; dry.</w:t></w:r></w:p></w:body></w:document>`;
  const p = previewOf("report.docx", zip({ "word/document.xml": doc }));
  assert.equal(p.kind, "document");
  if (p.kind !== "document") return;
  assert.deepEqual(p.blocks.map((b) => [b.style, b.text]), [["h1", "Inspection"], ["p", "The roof is sound & dry."]]);
});

test("xlsx: shared strings and numbers land in their cells", () => {
  const p = previewOf("book.xlsx", zip({
    "xl/workbook.xml": `<workbook><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>Name</t></si><si><t>Ada</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>`,
  }));
  assert.equal(p.kind, "table");
  if (p.kind !== "table") return;
  assert.equal(p.sheets[0].name, "Leads");
  assert.deepEqual(p.sheets[0].rows[1].slice(0, 2), ["Ada", "42"]);
});

test("csv and tsv become tables, quoted commas intact", () => {
  const p = previewOf("leads.csv", Buffer.from('name,note\nAda,"a, b"\n'));
  assert.equal(p.kind, "table");
  if (p.kind === "table") assert.deepEqual(p.sheets[0].rows[1], ["Ada", "a, b"]);
});

test("gzip is opened and previewed by the name inside", () => {
  const p = previewOf("leads.csv.gz", zlib.gzipSync("a,b\n1,2\n"));
  assert.equal(p.kind, "table");
});

test("tar and tgz list their members", () => {
  const t = tar({ "a.txt": "hi", "b/c.md": "# c" });
  assert.deepEqual(tarEntries(t).map((e) => e.name), ["a.txt", "b/c.md"]);
  const p = previewOf("bundle.tgz", zlib.gzipSync(t));
  assert.equal(p.kind, "archive");
});

test("rtf: the font table stays out, paragraphs come through", () => {
  const blocks = rtfBlocks("{\\rtf1\\ansi{\\fonttbl{\\f0 Helvetica;}}\\f0 Hello \\'e9t\\'e9\\par Second line}");
  const text = blocks.map((b) => b.text).join("|");
  assert.ok(!text.includes("Helvetica"), text);
  assert.ok(text.includes("Hello été"), text);
  assert.ok(text.includes("Second line"), text);
});

test("eml: headers decoded, body read, attachments named", () => {
  const m = emlOf([
    "From: Ada <a@x.com>", "Subject: =?UTF-8?B?SGVsbG8gw6l0w6k=?=", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="B"', "", "--B", "Content-Type: text/plain", "", "See attached.", "--B",
    'Content-Type: application/pdf; name="r.pdf"', 'Content-Disposition: attachment; filename="r.pdf"', "", "JVBERi0=", "--B--", "",
  ].join("\r\n"));
  assert.equal(m.headers.find((h) => h.name === "Subject")?.value, "Hello été");
  assert.match(m.body, /See attached/);
  assert.deepEqual(m.attachments, ["r.pdf"]);
});

test("ics events and vcf people", () => {
  const ev = icsEvents("BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Site visit\nDTSTART:20261001T090000\nLOCATION:Bondi\nEND:VEVENT\nEND:VCALENDAR\n");
  assert.equal(ev[0].title, "Site visit");
  assert.equal(ev[0].where, "Bondi");
  const ppl = vcfPeople("BEGIN:VCARD\nFN:Ada Lovelace\nEMAIL:a@x.com\nEND:VCARD\n");
  assert.equal(ppl[0].name, "Ada Lovelace");
});

test("notebook cells keep their type and outputs", () => {
  const p = previewOf("a.ipynb", Buffer.from(JSON.stringify({ cells: [
    { cell_type: "markdown", source: ["# Title"] },
    { cell_type: "code", source: ["1+1"], outputs: [{ output_type: "execute_result", data: { "text/plain": ["2"] } }] },
  ] })));
  assert.equal(p.kind, "notebook");
  if (p.kind !== "notebook") return;
  assert.equal(p.cells[1].type, "code");
  assert.deepEqual(p.cells[1].outputs, ["2"]);
});

test("meshes: ascii STL and OBJ give triangles", () => {
  const stl = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
  assert.equal(meshTriangles(".stl", Buffer.from(stl))?.count, 1);
  const obj = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n";
  assert.equal(meshTriangles(".obj", Buffer.from(obj))?.count, 2, "a quad is two triangles");
});

test("text, markdown, html and svg are never handed back as live markup", () => {
  const md = previewOf("notes.mdx", Buffer.from("---\ntitle: x\n---\n# Hi\n"));
  assert.equal(md.kind, "text");
  if (md.kind === "text") assert.equal(md.format, "markdown");
  assert.equal(previewOf("page.html", Buffer.from("<script>1</script>")).kind, "html");
  assert.equal(previewOf("logo.svg", Buffer.from("<svg/>")).kind, "svg");
  assert.equal(previewOf("notes.txt", Buffer.from("plain words")).kind, "text");
});

test("unknown bytes fall to a hex view; unknown text still reads as text", () => {
  assert.equal(looksLikeText(Buffer.from("just words\n")), true);
  assert.equal(looksLikeText(Buffer.from([0, 1, 2, 3, 255, 254])), false);
  assert.equal(previewOf("blob.bin", Buffer.from([0, 1, 2, 3, 255, 254, 0, 0])).kind, "binary");
  assert.equal(previewOf("Makefile", Buffer.from("all:\n\techo hi\n")).kind, "text");
});

// ---- hostile inputs: the preview runs on the request thread, so a small
// file must never buy seconds of CPU or gigabytes of memory.

/** A GLB: a JSON chunk (padded to 4) and a BIN chunk, the way the parser reads them. */
function glb(json: object, bin: Buffer): Buffer {
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + j.length + 8 + bin.length, 8);
  head.writeUInt32LE(j.length, 12); head.write("JSON", 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0); binHead.write("BIN\0", 4);
  return Buffer.concat([head, j, binHead, bin]);
}

const quick = <T>(fn: () => T, ms = 1000): T => {
  const t = Date.now();
  const out = fn();
  assert.ok(Date.now() - t < ms, `took ${Date.now() - t} ms`);
  return out;
};

test("a GLB reads its triangle, and one whose accessor claims more than its bytes is no mesh", () => {
  const pos = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const good = glb({ meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }], bufferViews: [{ byteOffset: 0 }] }, pos);
  assert.deepEqual(meshTriangles(".glb", good), { triangles: [0, 0, 0, 1, 0, 0, 0, 1, 0], count: 1 });

  // ~219 bytes: a billion one-byte indices over a zero stride, and past the buffer.
  const bomb = glb({ meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }, { bufferView: 1, componentType: 5121, count: 1e9, type: "SCALAR" }], bufferViews: [{}, { byteStride: 0 }] }, pos);
  assert.ok(bomb.length < 400);
  assert.throws(() => meshTriangles(".glb", bomb), /accessor/);
  const stride = glb({ meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }], bufferViews: [{ byteStride: 4 }] }, pos);
  assert.throws(() => meshTriangles(".glb", stride), /stride/);
  assert.equal(quick(() => previewOf("m.glb", bomb)).kind, "binary");
});

test("a PLY face that claims 400 million vertices is read as the indices on its line", () => {
  const ply = Buffer.from("ply\nformat ascii 1.0\nelement vertex 3\nelement face 2\nend_header\n0 0 0\n1 0 0\n0 1 0\n400000000 0\n3 0 1 2\n");
  assert.equal(quick(() => meshTriangles(".ply", ply))?.count, 1);
});

test("a file of nothing but JPEG start markers is one pass, not one per marker", () => {
  const starts = Buffer.alloc(3 * 1_000_000);
  for (let i = 0; i < starts.length; i += 3) { starts[i] = 0xff; starts[i + 1] = 0xd8; starts[i + 2] = 0xff; }
  const jpg = quick(() => embeddedJpeg(Buffer.concat([starts, Buffer.from([0xff, 0xd9])])));
  assert.equal(jpg?.length, starts.length + 2, "the first start still pairs with the end marker");
  assert.equal(quick(() => embeddedJpeg(starts)), null);
});

test("a gzip or zip member that inflates past the cap is no preview, not 60 MB in memory", () => {
  const bomb = zlib.gzipSync(Buffer.alloc(60 * 1024 * 1024));
  assert.ok(bomb.length < 100_000);
  assert.equal(previewOf("big.svgz", bomb).kind, "binary");
  assert.equal(previewOf("big.txt.gz", bomb).kind, "binary");
  assert.equal(previewOf("big.tgz", bomb).kind, "binary");
  // A zip member whose header claims a tiny size and inflates to 60 MB.
  const z = zip({ "word/document.xml": Buffer.alloc(60 * 1024 * 1024) });
  const lying = Buffer.from(z);
  lying.writeUInt32LE(10, z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
  assert.equal(readZip(lying).read("word/document.xml"), null);
});
