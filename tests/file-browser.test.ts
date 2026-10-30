// The storage browser's rules: what a file is, what previews as itself,
// how old and how big, where it came from, whether it is shared, and what a
// search or a chip keeps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtAge, fmtSize, kindOf, matches, previewAs, provenance, shareState, visibleDesks, type BrowserFile } from "../components/file-browser-model.ts";

const NOW = Date.parse("2026-09-29T05:00:00Z");
const file = (p: Partial<BrowserFile>): BrowserFile => ({ workspace: "blog-desk", path: "a.txt", size: 10, mime: "text/plain", updatedAt: "2026-09-29T04:00:00Z", by: "user:o@x.com", share: null, ...p });

test("kinds by extension; the browser plays media itself and asks the server for the rest", () => {
  assert.equal(kindOf("covers/x.PNG"), "image");
  assert.equal(kindOf("clip.webm"), "video");
  assert.equal(kindOf("r.pdf"), "pdf");
  assert.equal(kindOf("leads.csv"), "sheet");
  assert.equal(kindOf("noext"), "other");
  assert.equal(kindOf("brand.woff2"), "font");
  assert.equal(kindOf("part.stl"), "model");
  assert.equal(kindOf("reply.eml"), "mail");
  assert.equal(previewAs("x.png"), "image");
  assert.equal(previewAs("clip.mp4"), "video");
  assert.equal(previewAs("voice.flac"), "audio");
  assert.equal(previewAs("r.pdf"), "pdf");
  assert.equal(previewAs("brand.ttf"), "font");
  // Anything that could carry script, or that a browser cannot draw, is
  // rendered from the server's parse — never from the stored bytes.
  assert.equal(previewAs("logo.svg"), "server", "an SVG can carry script");
  assert.equal(previewAs("draft.html"), "server", "a stored page never renders on the dashboard origin");
  assert.equal(previewAs("notes.md"), "server");
  assert.equal(previewAs("leads.csv"), "server");
  assert.equal(previewAs("book.xlsx"), "server");
  assert.equal(previewAs("noext"), "server");
});

test("ages and sizes read the way a person says them", () => {
  assert.equal(fmtAge("2026-09-29T04:59:40Z", NOW), "just now");
  assert.equal(fmtAge("2026-09-29T04:55:00Z", NOW), "5m ago");
  assert.equal(fmtAge("2026-09-29T02:00:00Z", NOW), "3h ago");
  assert.equal(fmtAge("2026-09-26T05:00:00Z", NOW), "3d ago");
  assert.equal(fmtAge("2026-08-29T05:00:00Z", NOW), "4w ago");
  assert.equal(fmtSize(512), "512 B");
  assert.equal(fmtSize(2048), "2.0 KB");
  assert.equal(fmtSize(250 * 1024), "250 KB");
  assert.equal(fmtSize(5 * 1024 * 1024), "5.0 MB");
});

test("provenance: a run's file links back to its run, an upload names who", () => {
  assert.deepEqual(provenance("run:run-abc:publisher"), { kind: "run", runId: "run-abc", agent: "publisher" });
  assert.deepEqual(provenance("user:owner@example.com"), { kind: "user", who: "owner@example.com" });
  assert.deepEqual(provenance(""), { kind: "unknown" });
});

test("share state: a fresh 7-day link reads 7d, a last day reads in hours, an expired one is private", () => {
  const day = 86_400_000;
  assert.deepEqual(shareState(null, NOW), { state: "private" });
  assert.equal((shareState({ id: "sh_t", token: "t", url: "u", expiresAt: new Date(NOW + 7 * day - 60_000).toISOString() }, NOW) as { label: string }).label, "shared · 7d left");
  const soon = shareState({ id: "sh_t", token: "t", url: "u", expiresAt: new Date(NOW + 5 * 3_600_000).toISOString() }, NOW) as { label: string; soon: boolean };
  assert.deepEqual([soon.label, soon.soon], ["shared · 5h left", true]);
  assert.equal(shareState({ id: "sh_t", token: "t", url: "u", expiresAt: null }, NOW).state, "shared");
  assert.deepEqual(shareState({ id: "sh_t", token: "t", url: "u", expiresAt: new Date(NOW - 1).toISOString() }, NOW), { state: "private" });
});

test("search and chips keep what matches; empty desks drop out only while searching", () => {
  const desks = [
    { workspace: "blog-desk", files: [file({ path: "covers/a.png" }), file({ path: "reports/weekly.md", updatedAt: "2026-09-29T04:30:00Z" })] },
    { workspace: "lawyer-desk", files: [file({ workspace: "lawyer-desk", path: "leads.csv", share: { id: "sh_t", token: "t", url: "u", expiresAt: null } })] },
    { workspace: "empty-desk", files: [] },
  ];
  assert.equal(visibleDesks(desks, "", "all", NOW).length, 3);
  assert.deepEqual(visibleDesks(desks, "weekly", "all", NOW).map((d) => d.workspace), ["blog-desk"]);
  assert.deepEqual(visibleDesks(desks, "", "shared", NOW).map((d) => d.files.map((f) => f.path)), [["leads.csv"]]);
  assert.deepEqual(visibleDesks(desks, "", "image", NOW)[0].files.map((f) => f.path), ["covers/a.png"]);
  assert.deepEqual(visibleDesks(desks, "", "all", NOW)[0].files.map((f) => f.path), ["reports/weekly.md", "covers/a.png"], "newest first");
  assert.ok(matches(file({ workspace: "lawyer-desk" }), "LAWYER", "all", NOW), "the desk name is searchable, any case");
});
