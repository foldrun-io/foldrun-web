// Every #anchor in the docs lands on a heading — in this dashboard's docs
// viewer, and so on docs.foldrun.io, which makes the same ids
// (components/heading-slug.ts; foldrun-docs src/lib/heading-ids.ts, whose
// own check is scripts/check-links.mjs over the built site). And every rule
// link `foldrun check` prints lands on the checks page.
//
// Before 8 Nov 2026 the two sides made different ids: 49 of the docs' anchor
// links missed here, and every rule link `foldrun check` printed missed there.
//
//   node --import ./tests/register.mjs --test tests/docs-anchors.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { allDocs, docsDir } from "@/docs-index";
import { headingSlugger, headingText } from "../components/heading-slug.ts";
import { SCAN_RULES, CHECK_RULES, ruleDocsUrl } from "../../foldrun-core/src/scan.ts";

/** The ids a doc's headings get, in page order, code fences skipped. */
function anchors(doc: string): Set<string> {
  const slug = headingSlugger();
  const out = new Set<string>();
  let fence = false;
  for (const line of fs.readFileSync(path.join(docsDir(), `${doc}.md`), "utf8").split("\n")) {
    if (line.trimStart().startsWith("```")) fence = !fence;
    else if (!fence) {
      const h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) out.add(slug(h[1]));
    }
  }
  return out;
}

test("a heading's id is GitHub's slug of what a reader sees, a / read as -", () => {
  const slug = headingSlugger();
  assert.equal(slug("config/effort-fitted"), "config-effort-fitted");
  assert.equal(slug("`resources:` — your own numbers"), "resources--your-own-numbers");
  assert.equal(slug("foldrun's models"), "foldruns-models");
  assert.equal(slug("Secret and code: `accept_risk`"), "secret-and-code-accept_risk");
  assert.equal(slug("[MCP](mcp) — AI apps"), "mcp--ai-apps");
  assert.equal(slug("foldrun's models"), "foldruns-models-1", "a second heading of the same name on one page");
  assert.equal(headingText("**Bold** and *it* and `code`"), "Bold and it and code");
});

test("every #anchor link between the docs lands on a heading", () => {
  const docs = new Set(allDocs());
  const cache = new Map<string, Set<string>>();
  const ids = (d: string) => cache.get(d) ?? cache.set(d, anchors(d)).get(d)!;
  const bad: string[] = [];
  let seen = 0;
  for (const doc of docs) {
    const text = fs.readFileSync(path.join(docsDir(), `${doc}.md`), "utf8").replace(/```[\s\S]*?```/g, "");
    for (const m of text.matchAll(/\]\(([^)\s#]*)#([^)\s]+)\)/g)) {
      const target = m[1].replace(/^\.\//, "").replace(/\.md$/, "").replace(/\/$/, "") || doc;
      if (!docs.has(target)) continue;
      seen++;
      if (!ids(target).has(decodeURIComponent(m[2]))) bad.push(`${doc}.md → ${target}#${m[2]}`);
    }
  }
  assert.ok(seen > 100, `read the docs' anchor links (${seen})`);
  assert.deepEqual(bad, []);
});

test("every rule link foldrun check prints lands on the checks page", () => {
  const ids = anchors("checks");
  const bad = [...SCAN_RULES, ...CHECK_RULES].map((r) => ruleDocsUrl(r.id)).filter((u) => !ids.has(u.split("#")[1]!));
  assert.deepEqual(bad, []);
});
