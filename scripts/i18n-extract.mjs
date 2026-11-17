#!/usr/bin/env node
// Moves the dashboard's words into its language files (owner, 17 Nov 2026).
//
//   node scripts/i18n-extract.mjs --term workspace [--write]   only text naming that term
//   node scripts/i18n-extract.mjs --files <path>… [--write]    every visible string in those files
//
// Without --write it prints what it would move and what it leaves for a
// person (REVIEW). With --write it puts each sentence in
// messages/en/<area>.json under a key, replaces it in the code with
// $t("<area>.<file>.<key>"), and adds the import. A term's words become
// {@term.form}, so the noun is defined once in messages/en/terms.json.
//
// Conservative on purpose (Codex design debate, 17 Nov 2026): only plain
// static text and template strings, never a value that code compares,
// routes on or stores; markup inside a sentence, entities it does not know
// and ICU syntax in the text are left for a person. A second run finds
// nothing it already moved.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const WEB = path.resolve(import.meta.dirname, "..");
const ts = createRequire(import.meta.url)(path.join(WEB, "node_modules/typescript"));
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const termAt = args.indexOf("--term");
const TERM = termAt >= 0 ? args[termAt + 1] : null;
const filesAt = args.indexOf("--files");
const ONLY = filesAt >= 0 ? args.slice(filesAt + 1).filter((a) => !a.startsWith("--")).map((f) => path.relative(WEB, path.resolve(f))) : null;
if (!TERM && !ONLY) {
  console.error("usage: i18n-extract.mjs --term <name> | --files <path>…  [--write]");
  process.exit(2);
}

// ---- which strings a person reads ------------------------------------------

const VISIBLE_ATTRS = new Set(["title", "label", "placeholder", "aria-label", "alt", "description", "hint", "help", "empty", "emptyText", "confirmLabel", "cancelLabel", "noun", "meta", "subtitle", "heading", "message", "text", "tooltip", "summary", "allLabel", "caption", "legend"]);
const NEVER_ATTRS = new Set(["className", "key", "id", "name", "htmlFor", "href", "src", "value", "type", "role", "as", "variant", "tone", "size", "kind", "mode", "form", "method", "action", "target", "rel", "pattern", "autoComplete", "icon", "scope", "level", "side", "align"]);
const VALUE_CALLS = /^(fetch|api|apiFetch|post|get|put|patch|del|push|replace|router\.(push|replace|prefetch)|redirect|notFound|searchParams\.(get|has|set|delete|append)|params\.get|p\.set|q\.set|URLSearchParams|includes|startsWith|endsWith|test|match|split|localStorage\.(getItem|setItem|removeItem)|sessionStorage\.(getItem|setItem)|require|querySelector|getElementById|addEventListener|dispatchEvent|CustomEvent|Event|console\.(log|debug)|encodeURIComponent|avatarUrl|kindsAt|doneOf|healthKey|s|plural|cn|clsx|twMerge)$/;
// A term inside a path, a permission or a name (workspace/storage,
// workspace:manage, my-workspace) is not the noun: it stays as written.
const TERM_WORD = TERM ? new RegExp(`(?<![/:_=.@-])\\b(${TERM}|${TERM}s|${TERM[0].toUpperCase() + TERM.slice(1)}|${TERM[0].toUpperCase() + TERM.slice(1)}s)\\b(?![/:_=-])`, "g") : null;
const FORM = TERM ? { [TERM]: "one", [`${TERM}s`]: "other", [TERM[0].toUpperCase() + TERM.slice(1)]: "One", [`${TERM[0].toUpperCase() + TERM.slice(1)}s`]: "Other" } : {};

function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return (ts.isIdentifier(e.expression) ? `${e.expression.text}.` : "") + e.name.text;
  return "";
}

/** Is this literal prose a person reads — and if not, why not. */
function judge(node, text) {
  // A code sample or a file tree is not prose: a translator must not touch it.
  if (/\n/.test(text.trim()) && /[/#=]|--|\$ /.test(text)) return "code sample";
  if (/[/?=:[#]\s*[a-z]|[a-z][._-][a-z]+[._-]|^\s*[a-z0-9_-]+(:[a-z_-]+)?\s*$/.test(text) && !/\s[a-z]+\s/.test(text)) return "value-shaped";
  for (let n = node; n; n = n.parent) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return "import/type";
    if (ts.isTypeNode(n) && !ts.isTypeLiteralNode(n)) return "type";
  }
  let owner = node;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) owner = node.parent?.parent;
  let p = owner.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p))) p = p.parent;
  if (p && (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isEnumMember(p)) && p.name === owner) return "property name";
  if (p && ts.isElementAccessExpression(p)) return "element access";
  if (p && ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return "compared";
  if (p && ts.isCaseClause(p)) return "case";
  if (p && ts.isArrayLiteralExpression(p)) return "array item";
  if (p && ts.isCallExpression(p) && p.arguments.includes(owner) && VALUE_CALLS.test(calleeName(p))) return `argument to ${calleeName(p)}`;
  let attrParent = p && ts.isJsxExpression(p) ? p.parent : p;
  if (attrParent && ts.isJsxAttribute(attrParent)) {
    const n = attrParent.name.getText();
    if (NEVER_ATTRS.has(n) || n.startsWith("data-") || (!VISIBLE_ATTRS.has(n) && !/\s/.test(text.trim()))) return `attr ${n}`;
  }
  if (!ts.isJsxText(node) && !/\s/.test(text.trim()) && !/^[A-Z][a-z]+$/.test(text.trim())) return "one word";
  return null;
}

// ---- JSX text as React renders it ------------------------------------------

const ENTITIES = { apos: "'", quot: '"', amp: "&", lt: "<", gt: ">", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rarr: "→", larr: "←", middot: "·", times: "×", copy: "©", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", trade: "™" };
function decodeEntities(s) {
  let unknown = false;
  const out = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    if (e in ENTITIES) return ENTITIES[e];
    unknown = true;
    return m;
  });
  return unknown ? null : out;
}
/** Babel's cleanJSXElementLiteralChild: what React renders for a JSX text node. */
function jsxRendered(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((l, i) => { if (/[^ \t]/.test(l)) lastNonEmpty = i; });
  let str = "";
  lines.forEach((line, i) => {
    let t = line.replace(/\t/g, " ");
    if (i !== 0) t = t.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) t = t.replace(/[ ]+$/, "");
    if (t) {
      if (i !== lastNonEmpty) t += " ";
      str += t;
    }
  });
  return str;
}

// ---- keys and files ---------------------------------------------------------

function areaOf(rel) {
  const parts = rel.replace(/\.(tsx|ts)$/, "").split("/");
  let area, rest;
  if (parts[0] === "components") [area, rest] = ["components", parts.slice(1)];
  else if (parts[1] === "(auth)") [area, rest] = ["auth", parts.slice(2)];
  else if (parts[1] === "dashboard" && parts[2] === "[workspace]") [area, rest] = ["workspace", parts.slice(3)];
  else if (parts[1] === "dashboard" && parts.length > 3) [area, rest] = [parts[2], parts.slice(3)];
  else if (parts[1] === "dashboard") [area, rest] = ["dashboard", parts.slice(2)];
  else [area, rest] = ["app", parts.slice(1)];
  const file = rest.map((s) => s.replace(/[[\]()]/g, "")).join("-") || "index";
  return [area.replace(/[^a-z0-9-]/gi, ""), file];
}
function slug(message) {
  const words = message.replace(/\{@[a-z]+\.([a-z]+)\}/gi, (_m, f) => (/^o/i.test(f) ? TERM ?? "term" : `${TERM ?? "term"}s`)).replace(/\{[^}]*\}/g, " ").match(/[A-Za-z0-9]+/g) ?? ["text"];
  return words.slice(0, 6).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("") || "text";
}
const catalogs = new Map(); // area -> object
function catalog(area) {
  if (!catalogs.has(area)) {
    const f = path.join(WEB, "messages/en", `${area}.json`);
    catalogs.set(area, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {});
  }
  return catalogs.get(area);
}
function keyFor(area, file, message) {
  const c = catalog(area);
  const ns = (c[file] ??= {});
  for (const [k, v] of Object.entries(ns)) if (v === message) return `${area}.${file}.${k}`;
  let k = slug(message), n = 2;
  while (ns[k] !== undefined) k = `${slug(message)}${n++}`;
  ns[k] = message;
  return `${area}.${file}.${k}`;
}

/** Plain text → an ICU message: the term's words as {@term.form}, ICU syntax quoted. */
function toMessage(text) {
  let m = text.replace(/'/g, "'").replace(/[{}<>]/g, (ch) => `'${ch}'`);
  if (TERM_WORD) m = m.replace(TERM_WORD, (w) => `{@${TERM}.${FORM[w]}}`);
  return m;
}

// ---- the run ----------------------------------------------------------------

const tracked = execFileSync("git", ["ls-files", "app", "components"], { cwd: WEB, encoding: "utf8" }).split("\n")
  .filter((f) => /\.(tsx|ts)$/.test(f) && !f.startsWith("app/api/") && !/\.(test|d)\.ts$/.test(f));
const files = ONLY ? tracked.filter((f) => ONLY.includes(f)) : tracked;
const report = { moved: 0, review: [], files: 0 };

for (const rel of files) {
  const abs = path.join(WEB, rel);
  const src = fs.readFileSync(abs, "utf8");
  if (TERM_WORD && !new RegExp(TERM_WORD.source).test(src)) continue;
  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const [area, file] = areaOf(rel);
  const edits = []; // { start, end, text }
  const visit = (node) => {
    // A template with substitutions is one sentence: handle it whole.
    if (ts.isTemplateExpression(node)) {
      const pieces = [node.head, ...node.templateSpans.map((s) => s.literal)];
      const whole = pieces.map((p) => p.text).join(" ");
      if ((!TERM_WORD || new RegExp(TERM_WORD.source).test(whole)) && /[A-Za-z]{2,}/.test(whole)) {
        const why = judge(node.head, whole);
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        if (why) report.review.push(`${rel}:${line}\t${why}\t${whole.slice(0, 100)}`);
        else {
          const used = new Set();
          const values = [];
          let message = toMessage(node.head.text);
          node.templateSpans.forEach((span, i) => {
            const e = span.expression;
            let name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : `v${i}`;
            name = name.replace(/[^A-Za-z0-9_]/g, "") || `v${i}`;
            while (used.has(name)) name += i;
            used.add(name);
            values.push(`${name}: String(${e.getText(sf)})`);
            message += `{${name}}` + toMessage(span.literal.text);
          });
          const key = keyFor(area, file, message);
          const call = `$t("${key}", { ${values.join(", ")} })`;
          const inAttr = node.parent && ts.isJsxExpression(node.parent) ? false : node.parent && ts.isJsxAttribute(node.parent);
          edits.push({ start: node.getStart(sf), end: node.getEnd(), text: inAttr ? `{${call}}` : call });
          report.moved++;
        }
        return; // never descend into a template we judged
      }
    }
    let text = null;
    if (ts.isJsxText(node)) text = jsxRendered(src.slice(node.getStart(sf), node.getEnd()));
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !(node.parent && ts.isTemplateExpression(node.parent))) text = node.text;
    if (text !== null && /[A-Za-z]{2,}/.test(text) && (!TERM_WORD || new RegExp(TERM_WORD.source).test(text))) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const decoded = ts.isJsxText(node) ? decodeEntities(text) : text;
      const why = decoded === null ? "unknown entity" : judge(node, decoded);
      if (why) report.review.push(`${rel}:${line}\t${why}\t${text.trim().slice(0, 100)}`);
      else {
        const lead = /^\s/.test(decoded) ? " " : "";
        const trail = /\s$/.test(decoded) && decoded.trim() ? " " : "";
        const key = keyFor(area, file, toMessage(decoded.trim()));
        let out;
        if (ts.isJsxText(node)) out = `${lead ? '{" "}' : ""}{$t("${key}")}${trail ? '{" "}' : ""}`;
        else if (node.parent && ts.isJsxAttribute(node.parent)) out = `{$t("${key}")}`;
        else out = `$t("${key}")`;
        // A JSX text node's own leading/trailing newlines are layout, not text.
        const start = node.getStart(sf), end = node.getEnd();
        if (ts.isJsxText(node)) {
          const raw = src.slice(start, end);
          const head = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
          out = (head.includes("\n") ? head : "") + out + (tail.includes("\n") ? tail : "");
        }
        edits.push({ start, end, text: out });
        report.moved++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  report.files++;
  if (!WRITE) continue;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (!/import \{ \$t \} from "@\/i18n";/.test(out)) {
    const first = sf.statements.find((s) => ts.isImportDeclaration(s));
    let at = 0;
    if (first) at = first.getStart(sf);
    else {
      const dir = sf.statements.find((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && /^use (client|server)$/.test(s.expression.text));
      at = dir ? dir.getEnd() + 1 : 0;
    }
    out = out.slice(0, at) + `import { $t } from "@/i18n";\n` + out.slice(at);
  }
  fs.writeFileSync(abs, out);
}

if (WRITE) {
  for (const [area, obj] of catalogs) {
    const sorted = Object.fromEntries(Object.keys(obj).sort().map((f) => [f, Object.fromEntries(Object.keys(obj[f]).sort().map((k) => [k, obj[f][k]]))]));
    fs.writeFileSync(path.join(WEB, "messages/en", `${area}.json`), JSON.stringify(sorted, null, 2) + "\n");
  }
  const areas = fs.readdirSync(path.join(WEB, "messages/en")).filter((f) => f.endsWith(".json") && f !== "terms.json").map((f) => f.slice(0, -5)).sort();
  const ident = (a) => a.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
  fs.writeFileSync(path.join(WEB, "messages/en/index.ts"),
    "// Every English language file, by area. Written by scripts/i18n-extract.mjs\n// when it adds an area; edit the JSON files, not this list.\n" +
    areas.map((a) => `import ${ident(a)} from "./${a}.json" with { type: "json" };`).join("\n") +
    `\n\nexport const CATALOG = { ${areas.map((a) => (ident(a) === a ? a : `"${a}": ${ident(a)}`)).join(", ")} };\n`);
}
console.log(`${WRITE ? "moved" : "would move"} ${report.moved} strings in ${report.files} files; ${report.review.length} left for a person`);
if (args.includes("--review")) console.log(report.review.join("\n"));
