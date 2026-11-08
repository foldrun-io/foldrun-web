// One implementation per pattern (owner rule, 7 Nov 2026: "everything
// component based, reusable components so we stay consistent and we don't
// double code"). The dashboard is drawn from @foldrun/ui/react — one Panel,
// one search box, one pager, one tab bar, one segmented switch, one set of
// marks (Status, Chip, Tag, Count), one Button, one set of form controls,
// one EmptyState, one Stat, one Callout. This file fails when a copy creeps
// back in.
//
// And no browser controls (owner rule, 7 Nov 2026: "no browser default
// fallback and no use of browser components for the ui ux"): no native
// <select>, checkbox, radio, <details>, <datalist>, file/date/range input,
// title= tooltip or alert/confirm/prompt outside the kit. The kit draws each
// on Radix (Select, Checkbox, Switch, RadioGroup, Disclosure, Combobox,
// FileButton, TimeField, Slider, Tooltip, useConfirm, usePrompt).
//
//   node --import ./tests/register.mjs --test tests/kit-only.test.ts
//
// The kit is @foldrun/ui's src/react (foldrun-ui), shared with the operator
// console (8 Nov 2026: one component set across every app). When a page needs
// something it does not have, add it there once, release, then use it
// everywhere. Nothing under app/ or components/ defines a kit part again.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const WEB = path.join(import.meta.dirname, "..");

/** Every .tsx/.ts under app/ and components/, overlay copies included —
 *  the hosted build compiles those too. */
function sources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(full);
      } else if (/\.tsx?$/.test(e.name)) {
        out.push({ rel: path.relative(WEB, full), src: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(path.join(WEB, "app"));
  walk(path.join(WEB, "components"));
  return out;
}
const ALL = sources();
// The kit is a package now: every file here is outside it.
const OUTSIDE_KIT = ALL;

const where = (src: string, at: number) => src.slice(0, at).split("\n").length;

// ---------- the replaced modules stay gone ----------

/** What each removed module became. */
const GONE: Record<string, string> = {
  "components/ui": "the kit: Button/buttonVariants, Input/Select/Textarea/Label, Chip/Tag, Card, Page/PageHeader, IconButton (kit/tooltip)",
  "components/pager": "kit/pager (Pager) and kit/list (usePaged)",
  "components/list-search": "kit/list SearchField (url mode) or ResourceList",
  "components/kit/inspect-search": "kit/list SearchField with `url`",
  "components/kit/inspect-extra": "kit/segmented (Segmented) and kit/chart (ChartLegend)",
  "components/kit/badge": "kit/page Chip",
  "components/confirm": "kit/confirm (useConfirm, ConfirmDialog)",
  "components/data": "kit/table (DataTable), kit/chart (Sparkbars, Meter), kit/segmented",
  "components/banner": "kit/page Callout (a notice in a page) or Banner (the bar under the top bar)",
};

test("nothing imports a module the kit replaced", () => {
  const offenders: string[] = [];
  for (const { rel, src } of ALL) {
    for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      const resolved = spec.startsWith("@/")
        ? spec.slice(2)
        : spec.startsWith(".")
          ? path.relative(WEB, path.resolve(path.dirname(path.join(WEB, rel)), spec))
          : null;
      if (resolved && GONE[resolved.replace(/\.tsx?$/, "")]) offenders.push(`${rel}:${where(src, m.index!)} imports ${spec} — use ${GONE[resolved.replace(/\.tsx?$/, "")]}`);
    }
  }
  assert.deepEqual(offenders, []);
  for (const mod of Object.keys(GONE)) {
    assert.ok(!fs.existsSync(path.join(WEB, `${mod}.tsx`)) && !fs.existsSync(path.join(WEB, `${mod}.ts`)), `${mod} is back — it was folded into the kit`);
  }
});

// ---------- no local copy of a kit component ----------

const KIT_NAMES = ["Callout", "Note", "Disclosure", "Combobox", "Checkbox", "Switch", "RadioGroup", "Slider", "FileButton", "TimeField", "FormDialog", "Panel", "PanelLink", "SearchField", "Pager", "PagerControls", "EmptyState", "EmptyScreen", "PageHeader", "PageTabs", "HorizontalTabs", "Segmented", "ViewToggle", "Field", "Stat", "StatCard", "Badge", "Pill", "Chip", "Tag", "Count", "IconBox", "IconButton", "Toast", "ConfirmDialog", "FilterChips", "DataTable"];

test("no file outside the kit defines its own copy of a kit component", () => {
  const re = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function\\s+(${KIT_NAMES.join("|")})\\b|const\\s+(${KIT_NAMES.join("|")})\\s*=\\s*\\(\\s*[{)])`, "g");
  const offenders: string[] = [];
  for (const { rel, src } of OUTSIDE_KIT) {
    for (const m of src.matchAll(re)) offenders.push(`${rel}:${where(src, m.index! + 1)} defines ${m[1] ?? m[2]}`);
  }
  assert.deepEqual(offenders, [], "use the kit's component (components/kit/), or extend it there");
});

// ---------- no hand-rolled copy of a kit pattern ----------

/** A pattern the kit draws, and the files allowed to draw it themselves —
 *  each with the reason. Keep this list short; a new entry is a question. */
const RULES: { name: string; re: RegExp; use: string; allow: Record<string, string> }[] = [
  {
    name: "a tab bar or switch (role=tablist on an element)",
    re: /<(?:div|nav|ul|span)\b[^>]*\brole="tablist"/g,
    use: "PageTabs (kit/page-tabs) for sections, Segmented role=\"tablist\" (kit/segmented) for a view switch",
    allow: {},
  },
  {
    name: "a dark primary button (bg-ink / bg-gray-900 with padding)",
    re: /\bbg-(?:ink|gray-900)\b[^"`'\n]*\bpx-[\d.]+|\bpx-[\d.]+[^"`'\n]*\bbg-(?:ink|gray-900)\b(?![-/])/g,
    use: "Button / buttonVariants({ variant: \"primary\" }) (kit/button), Count tone=\"strong\", Toast (kit/toast)",
    allow: {},
  },
  {
    name: "a pill badge (a rounded-full span with badge padding and small text)",
    re: /<span\b[^>]*className=[{"`][^>]*\brounded-full\b(?=[^>]*\bpx-(?:1|1\.5|2|2\.5)\b)(?=[^>]*\btext-(?:xs|\[1[01]px\]))[^>]*>/g,
    use: "Chip (a state), Tag (a kind), Count (a number) from kit/page, or Status (kit/status) for a run",
    allow: {
      "components/run-browser.tsx": "the LIVE / frame-age marks drawn over a browser screenshot: dark chrome on an image, not a page badge",
    },
  },
  {
    name: "a square tag (a rounded span with tag padding and small text)",
    re: /<span\b[^>]*className=[{"`][^>]*\brounded(?:-sm|-md)?\b(?=[^>]*\b(?:bg-muted|bg-sunken|border-line)\b)(?=[^>]*\bpx-(?:1|1\.5|2)\b)(?=[^>]*\btext-(?:xs|\[1[01]px\]))[^>]*>/g,
    use: "Tag (kit/page)",
    allow: {},
  },
  {
    name: "a search box (an input next to a magnifier icon)",
    re: /<Search\b[^>]*className="pointer-events-none absolute/g,
    use: "SearchField (kit/list) — controlled, or `url` to keep ?q=",
    allow: {},
  },
  {
    name: "a styled native <select>",
    re: /<select\b(?:=>|[^>])*?\bclassName=/g,
    use: "Select (kit/input)",
    allow: {},
  },
  {
    name: "a text box (a raw <input>/<textarea> in the input's box)",
    re: /<(?:input|textarea)\b(?:=>|[^>])*?\bclassName=\{?[`"]?[^}>]*?(?:\binputBase\b|rounded-md border border-line)/g,
    use: "Input / Textarea (kit/input); inputBase is for a custom control (a code editor) that cannot be one",
    allow: {},
  },
  {
    name: "a notice box (a bordered box in a tone's soft colour)",
    re: /<(?:p|div|section|span)\b(?:=>|[^>])*?className=[{"`][^>]*\brounded(?:-md|-lg)?\b[^>]*\bborder-(?:warning|danger|info|success)-line\b[^>]*\bbg-(?:warning|danger|info|success)-soft\b/g,
    use: "Callout (kit/page), or Banner for the bar under the top bar",
    allow: {},
  },
  // ---- no browser controls ----
  {
    name: "a native <select>",
    re: /<select\b/g,
    use: "Select (kit/select) — Radix, keyboard and typeahead",
    allow: {},
  },
  {
    name: "a native checkbox or radio",
    re: /<input\b(?:=>|[^>])*?\btype=["'](?:checkbox|radio)["']/g,
    use: "Checkbox / Switch / RadioGroup (kit/choice), or Segmented",
    allow: {},
  },
  {
    name: "a native <details>/<summary>",
    re: /<(?:details|summary)\b/g,
    use: "Disclosure (kit/disclosure)",
    allow: {},
  },
  {
    name: "a native <datalist> or input list=",
    re: /<datalist\b|<(?:input|Input)\b(?:=>|[^>])*?\slist=/g,
    use: "Combobox (kit/combobox)",
    allow: {},
  },
  {
    name: "a native file, date, time, range or colour input",
    re: /<input\b(?:=>|[^>])*?\btype=["'](?:file|date|datetime-local|time|month|week|range|color)["']|<Input\b(?:=>|[^>])*?\btype=["'](?:file|date|datetime-local|time|month|week|range|color)["']/g,
    use: "FileButton / useFilePicker (kit/file-button), TimeField (kit/time-field), Slider (kit/slider)",
    allow: {},
  },
  {
    name: "a modal of its own (a portal, or role=dialog / aria-modal on an element)",
    re: /\bcreatePortal\(|<(?:div|form|section|aside)\b(?:=>|[^>])*?\b(?:role="dialog"|aria-modal=)/g,
    use: "Dialog / Sheet (kit/dialog), Popover (kit/popover), useConfirm, usePrompt",
    allow: {
      "components/assistant.tsx": "the assistant is a docked, non-modal side panel that stays open while the page is used — two states of one panel, not a modal",
      "components/inline-editor.tsx": "portals its toolbar into a slot in the page header (not a dialog)",
    },
  },
  {
    name: "the browser's alert(), confirm() or prompt()",
    re: /\bwindow\.(?:alert|confirm|prompt)\(|(?<![\w.$])alert\(/g,
    use: "useConfirm() (kit/confirm), usePrompt() / useCopyFallback() (kit/prompt), Toast (kit/toast)",
    allow: {},
  },
  {
    name: "a browser title= tooltip",
    // On a DOM element (an <iframe>'s title names the frame and stays) or on
    // a kit control that passes it to the DOM.
    re: /<(?!iframe\b)(?:[a-z][a-z0-9]*|Button|Link|Input|Textarea|Combobox|MenuItem|ControlButton|TH|TD|TR)\b(?:=>|\{[^{}]*\}|[^>{])*?\stitle=/g,
    use: "Tooltip / IconButton (kit/tooltip), or hint= on Chip, Tag, IconBox",
    allow: {},
  },
];

for (const rule of RULES) {
  test(`nothing hand-rolls ${rule.name}`, () => {
    const offenders: string[] = [];
    const used = new Set<string>();
    for (const { rel, src } of OUTSIDE_KIT) {
      for (const m of src.matchAll(rule.re)) {
        if (rule.allow[rel]) {
          used.add(rel);
          continue;
        }
        offenders.push(`${rel}:${where(src, m.index!)}: ${m[0].slice(0, 110)}`);
      }
    }
    assert.deepEqual(offenders, [], `use ${rule.use}`);
    for (const rel of Object.keys(rule.allow)) assert.ok(used.has(rel), `${rel} is allow-listed for "${rule.name}" but no longer needs it — drop the entry`);
  });
}

// ---------- one Link: prefetch on intent ----------

test("every link is the kit Link, which prefetches on intent, not on sight", () => {
  // next/link prefetches each route as its link scrolls into view: 7–26
  // server renders per page load on dev (7 Nov 2026). kit/link waits for a
  // hover, focus or touch.
  const bad = ALL.filter((f) => /from\s+["']next\/link["']/.test(f.src)).map((f) => f.rel);
  assert.deepEqual(bad, [], 'import Link from "@foldrun/ui/react/link"');
});

// ---------- one mark ----------

test("the foldrun mark is drawn once, in kit/mark (one colour, 7 Nov 2026)", () => {
  // Its folder path is the signature: any other file drawing it is a copy.
  const bad = ALL.filter((f) => f.src.includes("M3 7a2 2 0 0 1 2-2h4l2 2h8")).map((f) => f.rel);
  assert.deepEqual(bad, [], "use FoldrunMark from @foldrun/ui/react/mark");
});

// ---------- the kit itself ----------

test("the dashboard's own server-safe parts stay server-safe", () => {
  // A server page composes these directly. The kit's own server-safe files
  // are checked where they live (foldrun-ui tests/kit.test.ts).
  for (const f of ["components/status.tsx"]) {
    const src = fs.readFileSync(path.join(WEB, f), "utf8");
    assert.doesNotMatch(src, /^["']use client["']/m, `${f} must stay server-safe`);
    assert.doesNotMatch(src, /\buse(State|Effect|Ref|Router|Pathname|SearchParams|SyncExternalStore)\(/, `${f} calls a hook — move that part to a client file`);
  }
});

test("one Panel, one search box, one pager, one tab bar, one segmented switch", () => {
  // Each pattern is defined exactly once, in the kit (@foldrun/ui) — so here, never.
  const once: Record<string, string> = {
    Panel: "page.tsx",
    EmptyState: "page.tsx",
    Stat: "page.tsx",
    Field: "page.tsx",
    Chip: "page.tsx",
    Tag: "page.tsx",
    SearchField: "list.tsx",
    Pager: "pager.tsx",
    PageTabs: "page-tabs.tsx",
    Segmented: "segmented.tsx",
    Button: "button.tsx",
    Select: "select.tsx",
    Input: "input.tsx",
    Toast: "toast.tsx",
    useConfirm: "confirm.tsx",
    usePrompt: "prompt.tsx",
    DataTable: "table.tsx",
    Callout: "page.tsx",
    Checkbox: "choice.tsx",
    Switch: "choice.tsx",
    RadioGroup: "choice.tsx",
    Disclosure: "disclosure.tsx",
    Combobox: "combobox.tsx",
    FileButton: "file-button.tsx",
    Slider: "slider.tsx",
    TimeField: "time-field.tsx",
    Tooltip: "tooltip.tsx",
    IconButton: "tooltip.tsx",
  };
  for (const [name, file] of Object.entries(once)) {
    const defs = ALL.filter((f) => new RegExp(`(?:^|\\n)\\s*export\\s+function\\s+${name}\\b`).test(f.src)).map((f) => f.rel);
    assert.deepEqual([...new Set(defs)], [], `${name} is defined once, in @foldrun/ui/react/${file.replace(/\.tsx?$/, "")} — import it, never redefine it`);
  }
});

// ---------- no injection doors (OWASP A03) ----------

test("no raw HTML, script URLs or code from text — @foldrun/ui's check-security over the app", async () => {
  // The same scanner the console, the sites and the kit itself run: refuses
  // dangerouslySetInnerHTML, innerHTML=, eval, javascript: URLs and
  // target=_blank without rel, unless a foldrun-allow-html: line says why.
  const { spawnSync } = await import("node:child_process");
  const scanner = path.join(WEB, "node_modules/@foldrun/ui/scripts/check-security.mjs");
  const r = spawnSync(process.execPath, [scanner, "app", "components", "server", "proxy.ts", "instrumentation.ts"], { cwd: WEB, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
