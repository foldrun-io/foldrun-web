// What the dashboard still says in code rather than in its language files.
// One reading of "visible text" for the ratchet test (tests/i18n.test.ts) and
// for the baseline it compares against:
//
//   node scripts/i18n-scan.mjs              how much is left, by file
//   node scripts/i18n-scan.mjs --baseline   rewrite tests/i18n-baseline.json
//
// The baseline only ever shrinks: moving text into messages/ removes its
// fingerprint; adding text in code fails the test until it goes through $t().

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

export const WEB = path.resolve(import.meta.dirname, "..");
const ts = createRequire(import.meta.url)(path.join(WEB, "node_modules/typescript"));

const VISIBLE_ATTRS = new Set(["title", "label", "placeholder", "aria-label", "alt", "description", "hint", "help", "empty", "emptyText", "confirmLabel", "cancelLabel", "noun", "meta", "subtitle", "heading", "message", "text", "tooltip", "summary", "allLabel", "caption", "legend"]);
const VISIBLE_KEYS = /^(title|label|placeholder|description|hint|help|empty|message|text|tooltip|summary|meta|subtitle|heading|allLabel|blurb|body|lead|detail|note|why|cta|caption)$/;

/** The files the dashboard draws from: tracked pages and components, not
 *  the API's own messages (a later step: they are the API's contract). */
export function dashboardFiles() {
  return execFileSync("git", ["ls-files", "app", "components"], { cwd: WEB, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(tsx|ts)$/.test(f) && !f.startsWith("app/api/") && !/\.(test|d)\.ts$/.test(f));
}

export function fingerprint(text) {
  return crypto.createHash("sha1").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 10);
}

/** Every hard-coded visible string in one file: { text, line }. */
export function hardcoded(rel) {
  const abs = path.join(WEB, rel);
  const src = fs.readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const visit = (node) => {
    let text = null;
    if (ts.isJsxText(node) && /[A-Za-z]{2,}/.test(node.text)) text = node.text;
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) {
      const t = node.text;
      if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t) || /^[A-Z][a-z]+$/.test(t)) {
        const p = node.parent?.kind === ts.SyntaxKind.JsxExpression ? node.parent.parent : node.parent;
        if (p && ts.isJsxAttribute(p) && VISIBLE_ATTRS.has(p.name.getText())) text = t;
        else if (p && ts.isPropertyAssignment(p) && p.initializer === node && VISIBLE_KEYS.test(p.name.getText())) text = t;
        else if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t) && !ts.isImportDeclaration(node.parent)) text = t;
      }
    }
    if (text !== null) found.push({ text: text.replace(/\s+/g, " ").trim(), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** { file: { fingerprint: count } } for the whole dashboard. */
export function census() {
  const out = {};
  for (const f of dashboardFiles()) {
    const counts = {};
    for (const { text } of hardcoded(f)) {
      const fp = fingerprint(text);
      counts[fp] = (counts[fp] ?? 0) + 1;
    }
    if (Object.keys(counts).length) out[f] = Object.fromEntries(Object.entries(counts).sort());
  }
  return out;
}

export const BASELINE = path.join(WEB, "tests/i18n-baseline.json");

if (import.meta.url === `file://${process.argv[1]}`) {
  const now = census();
  const total = Object.values(now).reduce((n, c) => n + Object.values(c).reduce((a, b) => a + b, 0), 0);
  if (process.argv.includes("--baseline")) {
    // Shrink only: a file or fingerprint not in the old baseline is new text in
    // code, which belongs in messages/ — refuse to grandfather it.
    const old = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
    if (old && !process.argv.includes("--first")) {
      for (const [f, counts] of Object.entries(now)) {
        for (const [fp, n] of Object.entries(counts)) {
          if (n > (old[f]?.[fp] ?? 0)) {
            console.error(`${f}: text not in the baseline — move it to messages/ with $t() instead of adding it here`);
            process.exit(1);
          }
        }
      }
    }
    fs.writeFileSync(BASELINE, JSON.stringify(now, null, 0).replace(/\},"/g, '},\n"') + "\n");
    console.log(`baseline: ${total} strings in ${Object.keys(now).length} files still in code`);
  } else {
    console.log(`${total} visible strings still in code, in ${Object.keys(now).length} files`);
    for (const [f, c] of Object.entries(now).sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0)).slice(0, 15)) {
      console.log(`  ${Object.values(c).reduce((x, y) => x + y, 0)}\t${f}`);
    }
  }
}
