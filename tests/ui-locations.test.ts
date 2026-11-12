// Every "Settings → …" a person reads — in docs.foldrun.io, in an error
// message, in the CLI's output, on a dashboard page — names a place that is
// there. Settings became tabs in the Nov 2026 redesign and a dozen places
// still sent people to "Settings → Model provider" or "Settings → Governance",
// which no longer exist as such (8 Nov 2026).
//
// The first step must be a tab (app/dashboard/settings/tabs.ts) or a section
// of the General tab, which is what Settings opens on; a second step must be
// a section or card title on the Settings pages.
//
//   node --import ./tests/register.mjs --test tests/ui-locations.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const WEB = path.join(import.meta.dirname, "..");
const ROOT = path.join(WEB, "..");

function files(dir: string, keep: RegExp, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, keep, out);
    else if (keep.test(e.name)) out.push(p);
  }
  return out;
}

// The tabs, as the pages draw them: the account's Settings (tabs.ts) and a
// workspace's own Settings ("its Settings → Triggers").
const tabsSrc = fs.readFileSync(path.join(WEB, "app/dashboard/settings/tabs.ts"), "utf8");
const wsSettings = fs.readFileSync(path.join(WEB, "app/dashboard/[workspace]/settings/page.tsx"), "utf8");
const TABS = new Set([
  ...[...tabsSrc.matchAll(/tab\("[a-z]+", "([^"]+)"\)/g), ...tabsSrc.matchAll(/label: "([^"]+)", href: `\$\{ROUTE/g)].map((m) => m[1]),
  ...[...wsSettings.matchAll(/\{ label: "([^"]+)", href: tabHref/g)].map((m) => m[1]),
]);
// What the Settings pages call their sections and cards.
const settingsSrc = files(path.join(WEB, "app/dashboard/settings"), /\.tsx?$/)
  .concat(files(path.join(WEB, "app/dashboard/[workspace]/settings"), /\.tsx?$/))
  .concat(files(path.join(WEB, "components"), /^(pause-card|telemetry-card|settings-.*)\.tsx$/))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");
const TITLES = new Set(
  [...settingsSrc.matchAll(/(?:title|label)=\{?"([^"]+)"|title: "([^"]+)"|<h[23][^>]*>([^<{]+)</g)].map((m) => (m[1] ?? m[2] ?? m[3]).trim()),
);
// Sections of the General tab, the one Settings opens on — the account's,
// and a workspace's own.
const GENERAL = ["About", "Your data", "Feature flags", "Export and import"];

test("the tabs and titles this test reads are there", () => {
  for (const t of ["General", "Team", "Policies", "Models", "API keys", "Secrets", "Schedules", "Security", "Audit log", "Backups", "Triggers"]) assert.ok(TABS.has(t), `tab ${t}`);
  for (const t of [...GENERAL, "Governance", "Webhook triggers", "Connections", "API", "Pause runs"]) assert.ok(TITLES.has(t), `title ${t}`);
});

test("every Settings → … in the docs, the messages and the pages names a place that exists", () => {
  const sources = [
    ...files(path.join(ROOT, "foldrun-docs"), /\.md$/).filter((f) => !f.includes(`${path.sep}proposals${path.sep}`)),
    ...files(path.join(ROOT, "foldrun-core/src"), /\.(ts|mjs)$/),
    ...files(path.join(ROOT, "foldrun-platform/src"), /\.ts$/),
    ...files(path.join(ROOT, "foldrun-cli/src"), /\.mjs$/),
    ...files(path.join(WEB, "server"), /\.ts$/),
    ...files(path.join(WEB, "app"), /\.tsx?$/),
    ...files(path.join(WEB, "components"), /\.tsx?$/),
  ];
  assert.ok(sources.length > 300, `read only ${sources.length} files`);
  // A place named by another product, quoted in our docs, with why.
  const OTHER: Record<string, string> = {
    "foldrun-docs/mcp.md: Settings → Connectors": "claude.ai's own Settings, where a person adds foldrun as a connector",
    "foldrun-docs/environment.md: Settings → Platform model key": "the operator console's Settings (foldrun-admin), not the dashboard's",
    "foldrun-docs/budgets-and-billing.md: Settings → Billing": "Stripe's own Dashboard, where the customer portal is configured",
    "foldrun-cli/src/commands.mjs: Settings → Privacy & Security": "macOS System Settings, where `foldrun talk` asks for the terminal to be allowed the microphone",
  };
  // The longest known name the text after an arrow starts with (a sentence
  // usually goes on after it: "Settings → Secrets → Connections walks …").
  const known = (text: string, names: Iterable<string>) => {
    const t = text.replace(/^\*+/, "");
    return [...names].filter((n) => t.startsWith(n) && !/[A-Za-z0-9']/.test(t[n.length] ?? "")).sort((x, y) => y.length - x.length)[0];
  };
  const bad: string[] = [];
  for (const f of sources) {
    const rel = path.relative(ROOT, f);
    // Markdown wraps prose: "Settings → Feature\nflags" is one name.
    const raw = fs.readFileSync(f, "utf8");
    const text = f.endsWith(".md") ? raw.replace(/([^\n])\n(?=[^\n|#>-])/g, "$1 ") : raw;
    for (const m of text.matchAll(/Settings → ([^\n`|]{1,80})/g)) {
      const [firstText, ...rest] = m[1].split(" → ");
      const first = known(firstText, [...TABS, ...GENERAL]);
      if (!first) {
        const key = Object.keys(OTHER).find((k) => `${rel}: Settings → ${firstText}`.startsWith(k));
        if (!key) bad.push(`${rel}: Settings → ${m[1].slice(0, 40)} — not a Settings tab`);
        continue;
      }
      // A second step only when the first was the whole name before an arrow.
      if (rest.length && firstText.replace(/^\*+|\*+$/g, "").trim() === first) {
        const second = rest[0].replace(/^\*+/, "");
        if (!known(second, TITLES)) bad.push(`${rel}: Settings → ${first} → ${second.slice(0, 40)} — no such section on Settings`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
