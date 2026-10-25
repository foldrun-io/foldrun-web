// The active-links list's rules: which public links are still live, how each
// one reads, who minted it, and what the "show all" toggle keeps — the same
// facts `foldrun storage shares` prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isLiveShare, shareStatus, shareWho, visibleShares, type ShareRow } from "../components/share-list-model.ts";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const row = (p: Partial<ShareRow>): ShareRow => ({
  token: "tok",
  path: "storage/a.pdf",
  createdAt: "2026-10-19T11:00:00Z",
  createdBy: "owner@example.com",
  expiresAt: null,
  revokedAt: null,
  url: "https://example.test/s/tok",
  ...p,
});

test("live = not revoked and not past expiry — the CLI's rule", () => {
  assert.equal(isLiveShare(row({}), NOW), true);
  assert.equal(isLiveShare(row({ expiresAt: new Date(NOW + 3_600_000).toISOString() }), NOW), true);
  assert.equal(isLiveShare(row({ expiresAt: new Date(NOW - 1).toISOString() }), NOW), false, "past expiry is gone");
  assert.equal(isLiveShare(row({ revokedAt: new Date(NOW - 1).toISOString() }), NOW), false, "revoked is gone");
});

test("status reads the four states, relative and without locale", () => {
  assert.deepEqual(shareStatus(row({}), NOW), { live: true, label: "never expires" });
  assert.deepEqual(shareStatus(row({ expiresAt: new Date(NOW + 2 * 86_400_000).toISOString() }), NOW), { live: true, label: "expires in 2d" });
  assert.deepEqual(shareStatus(row({ expiresAt: new Date(NOW - 3 * 3_600_000).toISOString() }), NOW), { live: false, label: "expired 3h ago" });
  assert.deepEqual(shareStatus(row({ revokedAt: new Date(NOW - 5 * 60_000).toISOString() }), NOW), { live: false, label: "revoked 5m ago" });
});

test("who falls back to api-key, as the CLI prints it; links are same-origin", () => {
  assert.equal(shareWho(null), "api-key");
  assert.equal(shareWho("ci-key"), "ci-key");
});

test("the list shows live links newest-first, and only --all brings back the dead ones", () => {
  const rows = [
    row({ token: "old", createdAt: "2026-10-19T09:00:00Z" }),
    row({ token: "new", createdAt: "2026-10-19T11:30:00Z" }),
    row({ token: "revoked", createdAt: "2026-10-19T10:00:00Z", revokedAt: "2026-10-19T10:30:00Z" }),
    row({ token: "expired", createdAt: "2026-10-19T08:00:00Z", expiresAt: new Date(NOW - 1).toISOString() }),
  ];
  assert.deepEqual(visibleShares(rows, NOW, false).map((r) => r.token), ["new", "old"], "live only, newest first");
  assert.deepEqual(visibleShares(rows, NOW, true).map((r) => r.token), ["new", "revoked", "old", "expired"], "all, newest first");
});

// FOL-69 review (Codex, debated): the list copies the server's public URL,
// never the browser's origin; renders the creator through the email-safe
// component; and re-reads the page after a revoke so the file browser's
// "Copy link" stops offering it. Read from the source, as the email rule's
// own check does.
test("copies the server's public URL, renders emails safely, refreshes after a change", () => {
  const list = fs.readFileSync(new URL("../components/share-list.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(list, /window\.location\.origin/, "the link comes from FOLDRUN_PUBLIC_URL, on the server");
  assert.match(list, /<WithEmails text=\{shareWho\(s\.createdBy\)\}/, "the creator goes through <WithEmails>");
  assert.match(list, /status\.live && s\.url &&/, "no Copy without a public URL");
  assert.match(list, /router\.refresh\(\)/, "a revoke re-reads the page");
  assert.match(list, /if \(from !== initial\)/, "a new server list replaces the local one");
  const browser = fs.readFileSync(new URL("../components/file-browser.tsx", import.meta.url), "utf8");
  assert.equal((browser.match(/router\.refresh\(\)/g) ?? []).length >= 4, true, "share and unshare re-read the page too");
  const page = fs.readFileSync(new URL("../app/dashboard/[workspace]/storage/page.tsx", import.meta.url), "utf8");
  assert.match(page, /url: canShare \? shareUrl\(s\.token\) : null/, "shareUrl() only when a public URL exists (it throws otherwise)");
});
