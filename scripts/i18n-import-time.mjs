// Two rules that let one install speak a language per request
// (i18n/index.ts), read from the code itself:
//
// 1. importTimeCalls(): no $t()/$rich() outside a function. A file is read
//    once, before any request, so a sentence made there is English for
//    everybody. A table of words is `localized(() => …)`; a title is
//    `generateMetadata`.
// 2. pagesNotAwaiting(): every page, layout and not-found under app/ awaits
//    requestLocale() first, and so does every generateMetadata. A page does
//    not wait for its layout: one that skipped this drew English beside a
//    Persian layout (FOL-429).
//
//   node scripts/i18n-import-time.mjs      prints what breaks either rule

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["app", "components", "server", "i18n"];

function sources(roots = ROOTS) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
  };
  for (const r of roots) walk(path.join(WEB, r));
  return out;
}

const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const isTranslate = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "$t" || n.expression.text === "$rich");

// A function written at the top of a file is kept for later, except one
// handed straight to a call that runs it there and then: `rows.map(() =>
// $t("…"))`, or `(() => $t("…"))()`. These calls keep theirs for later:
const KEEPS = new Set(["localized", "cache", "memo", "forwardRef", "lazy", "dynamic", "createContext"]);
function runsAtImport(fn) {
  let node = fn;
  let parent = node.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent))) { node = parent; parent = parent.parent; }
  if (!parent || !ts.isCallExpression(parent)) return false;
  if (parent.expression === node) return true; // called on the spot
  const callee = parent.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
  return !KEEPS.has(name);
}

/** `file:line` of every $t()/$rich() that runs when its file is imported. */
export function importTimeCalls(files = sources()) {
  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (!/\$(t|rich)\(/.test(text)) continue;
    const sf = parse(file, text);
    const visit = (node) => {
      if (ts.isFunctionLike(node) && !runsAtImport(node)) return;
      if (isTranslate(node)) found.push(`${path.relative(WEB, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

const awaitsLocaleFirst = (body) => {
  const first = body?.statements?.[0];
  return !!first && /^(const \w+ = )?await requestLocale\(\);$/.test(first.getText());
};

/** Pages, layouts and titles that write before they know the language. */
export function pagesNotAwaiting(files = sources(["app"])) {
  const found = [];
  for (const file of files) {
    if (!/^(page|layout|not-found)\.tsx$/.test(path.basename(file))) continue;
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(WEB, file);
    // A client page reads the language from the context the root layout
    // provides, like any client component: nothing to await.
    if (/^\s*"use client"/.test(text)) continue;
    const sf = parse(file, text);
    let page = false;
    for (const st of sf.statements) {
      if (!ts.isFunctionDeclaration(st)) continue;
      const mods = st.modifiers?.map((m) => m.kind) ?? [];
      const exported = mods.includes(ts.SyntaxKind.ExportKeyword);
      const isDefault = exported && mods.includes(ts.SyntaxKind.DefaultKeyword);
      const isMeta = exported && st.name?.text === "generateMetadata";
      if (!isDefault && !isMeta) continue;
      if (isDefault) page = true;
      const what = isDefault ? "the page" : "generateMetadata";
      if (!mods.includes(ts.SyntaxKind.AsyncKeyword) || !awaitsLocaleFirst(st.body)) found.push(`${rel}: ${what} must start with \`await requestLocale();\``);
    }
    if (!page) found.push(`${rel}: no \`export default async function\` found`);
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = importTimeCalls();
  const b = pagesNotAwaiting();
  for (const line of a) console.log(`at import: ${line}`);
  for (const line of b) console.log(line);
  console.log(`${a.length} call(s) at import, ${b.length} page(s) not awaiting the language`);
  process.exit(a.length || b.length ? 1 : 0);
}
