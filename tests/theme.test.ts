// Light and dark: what a person's choice comes to, the route that keeps it,
// and the rule that keeps new code from painting in one theme only.
//
//   node --import ./tests/register.mjs --test tests/theme.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-theme-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
const { themePreference, effectiveTheme, isTheme, THEMES } = await import("../components/theme-model.ts");
const { NextRequest } = await import("next/server");
const { GET, PATCH } = await import("../app/api/me/preferences/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { createUser, mintSession, SESSION_COOKIE, findUserById } = await import("../server/users.ts");

const root = path.join(import.meta.dirname, "..");

// ---------- resolution ----------

test("no choice, or a choice we do not know, is system", () => {
  assert.equal(themePreference(null), "system");
  assert.equal(themePreference(undefined), "system");
  assert.equal(themePreference({}), "system");
  assert.equal(themePreference({ theme: "sepia" }), "system");
  assert.equal(themePreference({ theme: 1 }), "system");
  assert.equal(themePreference({ theme: "dark" }), "dark");
  assert.equal(themePreference({ theme: "light" }), "light");
  assert.deepEqual([...THEMES], ["system", "light", "dark"]);
  assert.ok(isTheme("system") && !isTheme("Dark") && !isTheme(null));
});

test("system follows the OS; a choice ignores it", () => {
  assert.equal(effectiveTheme("system", true), "dark");
  assert.equal(effectiveTheme("system", false), "light");
  assert.equal(effectiveTheme("light", true), "light");
  assert.equal(effectiveTheme("dark", false), "dark");
});

test("the stylesheet's two dark selectors are the model's two dark cases", () => {
  // data-theme="dark" always; no choice / "system" only on a dark OS; "light" never.
  const css = fs.readFileSync(path.join(root, "app/theme-dark.css"), "utf8");
  assert.match(css, /:root\[data-theme="dark"\] \{/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-theme="light"\]\):not\(\[data-theme="dark"\]\) \{/);
  const globals = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
  assert.match(globals, /@import "\.\/theme-dark\.css";/);
});

test("app/theme-dark.css is what the generator writes", async () => {
  const { render } = await import("../scripts/gen-dark-palette.mjs");
  assert.equal(fs.readFileSync(path.join(root, "app/theme-dark.css"), "utf8"), render(), "run node scripts/gen-dark-palette.mjs");
});

test("the text a page leans on is AA in both themes", async () => {
  const { contrast, darkVars } = await import("../scripts/gen-dark-palette.mjs");
  const dark: Record<string, string> = darkVars();
  const v = (k: string) => dark[`--color-${k}`];
  for (const [fg, bg] of [["gray-900", "white"], ["gray-700", "white"], ["gray-500", "white"], ["gray-500", "gray-50"], ["white", "gray-900"], ["red-700", "red-50"], ["amber-800", "amber-50"], ["emerald-700", "emerald-50"], ["sky-700", "sky-50"], ["white", "red-600"]]) {
    assert.ok(contrast(v(fg), v(bg)) >= 4.5, `dark ${fg} on ${bg}: ${contrast(v(fg), v(bg)).toFixed(2)}`);
  }
});

// ---------- the route ----------

test("the route: a person sets and reads their theme; system is stored as nothing", async () => {
  const user = await createUser("owner@theme.test", "Qz8-vmT2-plx9-Wr4k-thm", "theme1");
  const { value } = await mintSession(user);
  const cookie = `${SESSION_COOKIE}=${value}`;
  const patch = (body: unknown, headers: Record<string, string> = { cookie }) =>
    PATCH(new NextRequest("http://x/api/me/preferences", { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const get = async (headers: Record<string, string> = { cookie }) => (await GET(new NextRequest("http://x/api/me/preferences", { headers }))).json();

  assert.deepEqual(await get(), { theme: "system", runViews: [] });
  assert.equal((await patch({ theme: "sepia" })).status, 400);
  assert.equal((await patch({})).status, 400);
  const set = await patch({ theme: "dark" });
  assert.equal(set.status, 200);
  assert.deepEqual(await set.json(), { theme: "dark", runViews: [] });
  assert.equal((await findUserById(user.id))?.prefs?.theme, "dark");
  assert.deepEqual(await get(), { theme: "dark", runViews: [] });

  // A key acts for the person who minted it.
  const { key } = await createApiKey("theme1", "laptop", "owner@theme.test", undefined, "admin", null);
  const auth = { authorization: `Bearer ${key}` };
  assert.deepEqual(await get(auth), { theme: "dark", runViews: [] });

  // Saved run searches (FOL-72 step 9): kept with the person, checked.
  const views = await patch({ runViews: [{ name: "web errors", query: "?tool=web&tool_error=1&evil=x" }] });
  assert.equal(views.status, 200);
  assert.deepEqual((await views.json()).runViews, [{ name: "web errors", query: "tool=web&tool_error=1" }], "unknown keys dropped");
  assert.equal((await patch({ runViews: [{ name: "x", query: "evil=1" }] })).status, 400, "a view that filters nothing");
  assert.equal((await patch({ runViews: [] })).status, 200);
  assert.equal((await patch({ theme: "light" }, auth)).status, 200);
  assert.equal((await findUserById(user.id))?.prefs?.theme, "light");

  assert.equal((await patch({ theme: "system" })).status, 200);
  assert.equal((await findUserById(user.id))?.prefs ?? null, null, "system is the default, kept as no pref at all");
});

test("the route: a key minted by nobody, or no credential, is refused", async () => {
  const { key } = await createApiKey("theme2", "ci", "ci-bot", undefined, "admin", null);
  const res = await GET(new NextRequest("http://x/api/me/preferences", { headers: { authorization: `Bearer ${key}` } }));
  assert.equal(res.status, 400);
  const none = await GET(new NextRequest("http://x/api/me/preferences"));
  assert.equal(none.status, 401);
});

// ---------- the rule ----------

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}

// The greys that have a name in globals.css. Every grey still follows the
// theme (the palette is re-pointed in dark), but these say what a colour is
// FOR — surface, line, fg-muted — and are the vocabulary new code writes.
const RAW_GREY = /(?<![\w-])(?:[a-z-]+:)*(bg-white|bg-gray-(?:50|100|200|900)|text-gray-(?:400|500|600|700|900)|border-gray-(?:100|200|300)|divide-gray-(?:100|200)|ring-gray-(?:100|200|300))(?![\w-])/g;
// A literal colour cannot follow the theme at all.
const LITERAL = /-\[#[0-9a-fA-F]{3,8}\]|["'`]#[0-9a-fA-F]{3,8}["'`]|\brgba?\(|\bhsla?\(/g;

// Intentional, and why. A file here may keep exactly these literals.
const ALLOWED_LITERALS: Record<string, { literal: string; why: string }[]> = {
  "components/run-browser.tsx": [
    { literal: "-[#ff5f57]", why: "a browser window's traffic lights are these colours in every theme" },
    { literal: "-[#febc2e]", why: "traffic light" },
    { literal: "-[#28c840]", why: "traffic light" },
  ],
  "components/sidebar.tsx": [{ literal: `"#10b981"`, why: "the logo's green dot is the brand, not the theme" }],
  "app/(auth)/brand.tsx": [{ literal: `"#10b981"`, why: "the logo's green dot" }],
  "components/file-browser.tsx": [
    { literal: "rgb(", why: "a 3D model's shading is the model's own light, not the page's" },
    { literal: "rgba(", why: "the model's edge lines" },
  ],
  "components/run-timeline.tsx": [
    { literal: "rgba(", why: "white hatching over a coloured bar reads on the bar, whatever the page" },
    { literal: "rgba(", why: "second hatching" },
  ],
};

// Nothing is skipped: app/dashboard/settings/backups/ was, while it was
// under a concurrent change when this rule landed.
const SKIP: string[] = [];

test("components and pages paint in theme tokens, not light-only colours", () => {
  const files = [...walk(path.join(root, "components"), (f) => /\.tsx?$/.test(f)), ...walk(path.join(root, "app"), (f) => /\.tsx?$/.test(f))]
    .map((f) => path.relative(root, f))
    .filter((f) => !SKIP.some((s) => f.startsWith(s)));
  assert.ok(files.length > 100, `found only ${files.length} files — is the walk right?`);
  const grey: string[] = [];
  const literal: string[] = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    for (const m of src.matchAll(RAW_GREY)) grey.push(`${rel}: ${m[0]}`);
    if (!rel.endsWith(".tsx")) continue; // a .ts route may write an HTML page of its own
    const allowed = [...(ALLOWED_LITERALS[rel] ?? [])];
    for (const m of src.matchAll(LITERAL)) {
      const i = allowed.findIndex((a) => a.literal.startsWith(m[0]) || m[0].startsWith(a.literal.slice(0, m[0].length)));
      if (i >= 0) allowed.splice(i, 1);
      else literal.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(grey, [], "use the tokens in app/globals.css: bg-surface, bg-sunken, bg-muted, bg-ink, text-fg / -secondary / -tertiary / -muted / -subtle, border-line-faint / line / line-strong");
  assert.deepEqual(literal, [], "a literal colour is light-only: use var(--color-…) or a token, or add it to ALLOWED_LITERALS with the reason");
});
