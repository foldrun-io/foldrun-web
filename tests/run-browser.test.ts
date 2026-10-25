// The run page's browser: which archived files play inline, how stale a live
// frame is, and the byte ranges a video element needs to seek.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frameAge, mediaFiles, mediaKind, recordingLabel } from "../components/run-browser-model.ts";
import { byteRange } from "../server/byte-range.ts";

test("a recording plays, a picture shows, anything else stays a link", () => {
  assert.equal(mediaKind("video/page.webm"), "video");
  assert.equal(mediaKind("clip.MP4"), "video");
  assert.equal(mediaKind("page.png"), "image");
  assert.equal(mediaKind("shots/a.jpeg"), "image");
  assert.equal(mediaKind("network.har"), null);
  assert.equal(mediaKind("page.md"), null);
});

test("recordings come before pictures, and nothing else is shown", () => {
  const files = [{ path: "page.png" }, { path: "results.json" }, { path: "video/page.webm" }, { path: "diff.png" }];
  assert.deepEqual(mediaFiles(files).map((f) => f.path), ["video/page.webm", "page.png", "diff.png"]);
});

test("a frame's age reads in seconds, then minutes", () => {
  const now = Date.parse("2026-09-29T10:00:00Z");
  assert.equal(frameAge("2026-09-29T09:59:57Z", now), "3s ago");
  assert.equal(frameAge("2026-09-29T09:57:00Z", now), "3 min ago");
  assert.equal(frameAge("2026-09-29T10:00:05Z", now), "0s ago", "a clock a little ahead is not negative");
});

test("byte ranges: the forms a video element sends, and the ones to refuse", () => {
  assert.equal(byteRange(null, 100), null);
  assert.deepEqual(byteRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(byteRange("bytes=100-", 100), "bad");
  assert.equal(byteRange("bytes=20-10", 100), "bad");
  assert.equal(byteRange("bytes=0-1,5-6", 100), "bad");
  assert.equal(byteRange("items=0-1", 100), "bad");
});

test("a recording is labelled by the site and moment in its name; other names keep theirs", () => {
  const l = recordingLabel("video/20260929-015517814-en.wikipedia.org.webm");
  assert.equal(l.site, "en.wikipedia.org");
  assert.equal(l.at!.toISOString(), "2026-09-29T01:55:17.814Z");
  assert.deepEqual(recordingLabel("video/page.webm"), { site: "page", at: null });
  assert.deepEqual(recordingLabel("outputs/demo.mp4"), { site: "demo", at: null });
});
