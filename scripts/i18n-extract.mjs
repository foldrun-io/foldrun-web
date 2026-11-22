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
import { createRequire } from "node:module";
import { looksLikeClasses, looksLikeCode } from "./i18n-shared.mjs";
import { dashboardFiles } from "./i18n-scan.mjs";
import { BILLING_FILES, STUBS } from "../tests/billing-files.ts";

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
// Every term in terms.json is written as {@term.form} in a message, whichever
// mode moved it, so a noun stays defined once.
const TERMS = JSON.parse(fs.readFileSync(path.join(WEB, "messages/en/terms.json"), "utf8"));
const cap = (w) => w[0].toUpperCase() + w.slice(1);
const SUBS = Object.keys(TERMS).map((t) => ({
  re: new RegExp(`(?<![/:_=.@-])\\b(${t}|${t}s|${cap(t)}|${cap(t)}s)\\b(?![/:_=-])`, "g"),
  form: { [t]: "one", [`${t}s`]: "other", [cap(t)]: "One", [`${cap(t)}s`]: "Other" },
  term: t,
}));

function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return (ts.isIdentifier(e.expression) ? `${e.expression.text}.` : "") + e.name.text;
  return "";
}

/** Is this literal prose a person reads — and if not, why not. */
function judge(node, text) {
  if (node.parent && ts.isExpressionStatement(node.parent) && node.parent.expression === node) return "directive";
  if (looksLikeClasses(text)) return "class names";
  // A code sample or a file tree is not prose: a translator must not touch it.
  if (looksLikeCode(text)) return "code sample";
  if (/[/?=:[#]\s*[a-z]|[a-z][._-][a-z]+[._-]|^\s*[a-z0-9_-]+(:[a-z_-]+)?\s*$/.test(text) && !/\s[a-z]+\s/.test(text)) return "value-shaped";
  for (let n = node; n; n = n.parent) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return "import/type";
    if (ts.isTypeNode(n) && !ts.isTypeLiteralNode(n)) return "type";
  }
  let owner = node;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) owner = node.parent;
  let p = owner.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p))) p = p.parent;
  if (p && (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isEnumMember(p)) && p.name === owner) return "property name";
  if (p && ts.isElementAccessExpression(p)) return "element access";
  if (p && ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return "compared";
  if (p && ts.isCaseClause(p)) return "case";
  if (p && ts.isArrayLiteralExpression(p)) {
    // Prose in a list (a table's description column, example questions) is
    // text; a list code checks against (.includes) or a code column is not.
    let q = p.parent;
    while (q && (ts.isParenthesizedExpression(q) || ts.isAsExpression(q))) q = q.parent;
    const checked = q && ts.isPropertyAccessExpression(q) && /^(includes|indexOf|some|every|find)$/.test(q.name.text);
    const codeColumn = p.elements[0] === owner && p.elements.length > 1 && /^[a-z_!?.0-9-]+:|^\d+[.!?]|^[\[{`$@/.-]/.test(text.trim());
    if (checked || codeColumn || !/\S+\s+\S+\s+\S+/.test(text.trim())) return "array item";
  }
  if (p && ts.isCallExpression(p) && p.arguments.includes(owner) && VALUE_CALLS.test(calleeName(p))) return `argument to ${calleeName(p)}`;
  // One word handed to a function or stored under a data key is a key the
  // code looks up (count("Contains"), { type: "User" }), unless the function
  // only shows it.
  const oneWord = !/\s/.test(text.trim());
  if (oneWord && p && ts.isCallExpression(p) && p.arguments.includes(owner) && !/^(set[A-Z]\w*|toast|refuse|tab|fail|notify|say|flash)$/.test(calleeName(p).split(".").pop())) return "one-word argument";
  if (oneWord && p && ts.isPropertyAssignment(p) && /^(type|kind|key|id|status|state|action|role|mode|tone|variant|value|event|method|scope|level|tier|plan|provider|engine|transport|trigger|format|unit|icon)$/.test(p.name.getText())) return "one-word data key";
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

// Billing's words go to billing's own catalog, messages/en/billing.json,
// which is foldrun-admin's (laid over the public, empty one) — never into a
// public area. One namespace per file: the path under the billing section,
// else under app/ or components/ (wallet-page, support-enter-page,
// balance-pill).
const isBillingFile = (rel) => BILLING_FILES.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p)) || rel in STUBS;

function areaOf(rel) {
  const parts = rel.replace(/\.(tsx|ts)$/, "").split("/");
  let area, rest;
  if (isBillingFile(rel)) [area, rest] = ["billing", rel.startsWith("app/dashboard/billing/") ? parts.slice(3) : parts.slice(parts[0] === "app" && parts[1] === "dashboard" ? 2 : 1)];
  else if (parts[0] === "components") [area, rest] = ["components", parts.slice(1)];
  else if (parts[1] === "(auth)") [area, rest] = ["auth", parts.slice(2)];
  else if (parts[1] === "dashboard" && parts[2] === "[workspace]") [area, rest] = ["workspace", parts.slice(3)];
  else if (parts[1] === "dashboard" && parts.length > 3) [area, rest] = [parts[2], parts.slice(3)];
  else if (parts[1] === "dashboard") [area, rest] = ["dashboard", parts.slice(2)];
  else [area, rest] = ["app", parts.slice(1)];
  // No dots: use-intl reads a dot as a level of the catalog.
  const file = rest.map((s) => s.replace(/[[\]().]/g, "")).join("-") || "index";
  return [area.replace(/[^a-z0-9-]/gi, ""), file];
}
function slug(message) {
  const words = message.replace(/\{@[a-z]+\.([a-z]+)\}/gi, (_m, f) => (/^o/i.test(f) ? TERM ?? "term" : `${TERM ?? "term"}s`)).replace(/<\/?[A-Za-z0-9_]+>/g, " ").replace(/'[^']*'/g, " ").replace(/\{[^{}]*\}/g, " ").replace(/\{[^{}]*\}/g, " ").replace(/\{[^{}]*\}/g, " ").match(/[A-Za-z0-9]+/g) ?? ["text"];
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

/** A key's message as written in its language file (terms unexpanded). */
function rawMessage(key) {
  const [area, file, k] = key.split(".");
  return catalog(area)?.[file]?.[k];
}

/** Plain text → an ICU message: the term's words as {@term.form}, ICU syntax quoted. */
function toMessage(text) {
  let m = text.replace(/'/g, "'").replace(/[{}<>]/g, (ch) => `'${ch}'`);
  for (const { re, form, term } of SUBS) m = m.replace(re, (w) => `{@${term}.${form[w]}}`);
  return m;
}

// ---- the run ----------------------------------------------------------------

// The census's list (scripts/i18n-scan.mjs dashboardFiles): tracked pages
// and components, and on a hosted checkout billing's, which git ignores —
// so the prune below never drops a billing key a billing page still names.
// Route handlers (app/api, app/.well-known, any route.ts) answer machines,
// not people: their text is a protocol, never translated. A server module
// is only read for the keys it names; it is moved by hand, never here.
const tracked = dashboardFiles();
const files = (ONLY ? tracked.filter((f) => ONLY.includes(f)) : tracked).filter((f) => !f.startsWith("server/"));
const report = { moved: 0, review: [], files: 0 };

// The type checker says whether {expr} inside a sentence is text (a string or
// a number, safe as an ICU value) or something React draws (left in place).
const tsconfig = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(WEB, "tsconfig.json"), ts.sys.readFile).config, ts.sys, WEB);
const program = ts.createProgram({ rootNames: files.map((f) => path.join(WEB, f)), options: { ...tsconfig.options, noEmit: true } });
const checker = program.getTypeChecker();
const TEXT = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike, NOTHING = ts.TypeFlags.Null | ts.TypeFlags.Undefined;
// Text, or text that may be missing (React draws null as nothing; the value
// is passed as `?? ""`, which draws the same).
const textType = (t) => (t.isUnion() ? t.types.every((m) => m.flags & (TEXT | NOTHING)) && t.types.some((m) => m.flags & TEXT) : (t.flags & TEXT) !== 0);
const nullable = (e) => { const t = checker.getTypeAtLocation(e); return t.isUnion() && t.types.some((m) => m.flags & NOTHING); };
/** Words or markup of its own inside an expression: those are moved on
 *  their own, so the expression is not a plain value. */
function hasWords(n) {
  let found = false;
  const v = (x) => {
    if (found) return;
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && /^\$(t|rich)$/.test(x.expression.text)) return;
    if ((ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isTemplateExpression(x)) && /[A-Za-z]{2,}/.test(x.getText())) found = true;
    else if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x) || ts.isArrowFunction(x) || ts.isFunctionExpression(x)) found = true;
    else ts.forEachChild(x, v);
  };
  v(n);
  return found;
}
function isTextValue(e) {
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "$t") return true;
  if (hasWords(e)) return false;
  return textType(checker.getTypeAtLocation(e));
}

// Markup a sentence may carry inside it as a tag. Block elements end a sentence.
const BLOCK = new Set(["div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "section", "header", "footer", "nav", "main", "aside", "article", "table", "thead", "tbody", "tr", "td", "th", "form", "fieldset", "legend", "label", "button", "select", "option", "textarea", "input", "pre", "blockquote", "figure", "figcaption", "details", "summary", "svg", "img", "hr", "iframe", "video"]);
const INLINE_COMPONENTS = new Set(["Link", "Email", "WithEmails", "Code", "Kbd", "Mono", "Badge", "Term", "LocalTime", "Money", "Usd", "Tooltip", "ExternalLink", "DocsLink"]);
// Text inside these is code: never a sentence of its own.
const CODE_TAGS = new Set(["code", "kbd", "pre", "samp", "Code", "Kbd", "Mono"]);
// CSS and scripts: nothing inside is touched, not even a template literal.
const RAW_TAGS = new Set(["style", "script"]);

for (const rel of files) {
  const abs = path.join(WEB, rel);
  const src = fs.readFileSync(abs, "utf8");
  if (TERM_WORD && !new RegExp(TERM_WORD.source).test(src)) continue;
  const sf = program.getSourceFile(abs) ?? ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const [area, file] = areaOf(rel);
  const edits = []; // { start, end, text }
  let usesRich = false;
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const consumed = new Set();
  // Icons stand beside a sentence, not in it.
  const icons = new Set(sf.statements.filter((s) => ts.isImportDeclaration(s) && /lucide|icon/i.test(s.moduleSpecifier.text))
    .flatMap((s) => s.importClause?.namedBindings?.elements?.map((e) => e.name.text) ?? []));

  /** One child of a JSX element, as a piece of a sentence or a barrier. */
  function piece(child, depth = 0) {
    if (ts.isJsxText(child)) {
      const rendered = jsxRendered(src.slice(child.pos, child.getEnd()));
      const decoded = decodeEntities(rendered);
      return decoded === null ? { kind: "barrier", why: "unknown entity" } : { kind: "text", text: decoded, node: child };
    }
    if (ts.isJsxExpression(child)) {
      const e = child.expression;
      if (!e) return { kind: "barrier" };
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { kind: "text", text: e.text, node: child };
      // A sentence moved earlier ($t("key") with no values) joins this one.
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "$t" && e.arguments.length === 1 && ts.isStringLiteral(e.arguments[0])) {
        const m = rawMessage(e.arguments[0].text);
        if (m !== undefined) return { kind: "msg", message: m, plain: m.replace(/\{@[a-z]+\.[a-z]+\}/gi, "x"), node: child };
      }
      // n === 1 ? "" : "s" — English plural suffix, becomes ICU plural.
      if (ts.isConditionalExpression(e) && ts.isBinaryExpression(e.condition) && ts.isNumericLiteral(e.condition.right) && e.condition.right.text === "1"
        && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(e.condition.operatorToken.kind)
        && ts.isStringLiteral(e.whenTrue) && ts.isStringLiteral(e.whenFalse) && isTextValue(e.condition.left)) {
        const eq = e.condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
        return { kind: "plural", expr: e.condition.left, one: eq ? e.whenTrue.text : e.whenFalse.text, other: eq ? e.whenFalse.text : e.whenTrue.text };
      }
      if (isTextValue(e)) return { kind: "value", expr: e };
      return { kind: "barrier" };
    }
    if (ts.isJsxElement(child) && depth === 0) {
      const tag = child.openingElement.tagName.getText(sf);
      if (BLOCK.has(tag) || (/^[A-Z]/.test(tag) && !INLINE_COMPONENTS.has(tag))) return { kind: "barrier" };
      const inner = child.children.map((c) => piece(c, 1));
      if (inner.some((p) => p.kind === "barrier" || p.kind === "tag" || p.kind === "embed")) return { kind: "barrier" };
      if (inner.length === 1 && inner[0].kind === "msg") return { kind: "barrier" }; // already one message
      return { kind: "tag", node: child, tag, inner };
    }
    if (ts.isJsxSelfClosingElement(child) && depth === 0) {
      const tag = child.tagName.getText(sf);
      if (/^[A-Z]/.test(tag) || tag === "br") return { kind: "embed", node: child, tag };
    }
    return { kind: "barrier" };
  }

  /** The sentences among an element's children: runs between barriers. */
  function sentences(el) {
    const kids = el.children;
    const pieces = kids.map((k) => piece(k));
    const runs = [];
    let run = [];
    pieces.forEach((p, i) => {
      if (p.kind === "barrier") { if (run.length) runs.push(run); run = []; if (p.why) report.review.push(`${rel}:${lineOf(kids[i])}\t${p.why}`); }
      else run.push({ ...p, child: kids[i] });
    });
    if (run.length) runs.push(run);
    for (let r of runs) {
      // Icons and blank text at the edges stay where they are.
      const edge = (p) => (p.kind === "embed" && icons.has(p.tag)) || (p.kind === "text" && !p.text.trim() && ts.isJsxText(p.child));
      while (r.length && edge(r[0])) r = r.slice(1);
      while (r.length && edge(r[r.length - 1])) r = r.slice(0, -1);
      const own = r.filter((p) => p.kind === "text" || p.kind === "msg").map((p) => p.plain ?? p.text).join("");
      if (!/[A-Za-z]{2,}/.test(own)) continue; // no words of its own: its tags are visited alone
      r.forEach((p) => consumed.add(p.child));
      sentence(r);
    }
  }

  function sentence(run) {
    const names = new Map(); // expression or opening tag text -> name
    const taken = new Set();
    const values = [];
    let rich = false;
    const nameFor = (key, base) => {
      if (names.has(key)) return names.get(key);
      let clean = base.replace(/[^A-Za-z0-9_]/g, "") || "v";
      if (/^[0-9]/.test(clean)) clean = `v${clean}`;
      let n = clean, i = 2;
      while (taken.has(n)) n = `${clean}${i++}`;
      taken.add(n); names.set(key, n);
      return n;
    };
    const exprName = (e) => {
      while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
      if (ts.isIdentifier(e)) return e.text;
      if (ts.isPropertyAccessExpression(e)) return e.name.text;
      if (ts.isElementAccessExpression(e)) return exprName(e.argumentExpression);
      if (ts.isBinaryExpression(e) || ts.isConditionalExpression(e)) return exprName(ts.isBinaryExpression(e) ? e.left : e.whenTrue);
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "$t") return "part";
      if (ts.isCallExpression(e)) { const a = e.arguments[0]; return a && ts.isIdentifier(a) ? a.text : calleeName(e).split(".").pop(); }
      return "value";
    };
    // Numbers keep the page's own rendering (ICU would group 2026 as
    // "2,026"): passed as String(n), except a count a plural chooses by.
    const counted = new Set();
    const valueRef = (e, count = false) => {
      const k = e.getText(sf);
      const fresh = !names.has(k);
      const n = nameFor(k, exprName(e));
      if (count) counted.add(n);
      if (fresh) values.push({ n, k, e });
      return n;
    };
    const isNumber = (e) => { const t = checker.getTypeAtLocation(e); return !textType(t) ? false : !(t.isUnion() ? t.types : [t]).some((m) => m.flags & ts.TypeFlags.StringLike); };
    const valueCode = (v) => {
      if (typeof v === "string") return v;
      const base = nullable(v.e) ? `${v.k} ?? ""` : v.k;
      return `${v.n}: ${isNumber(v.e) && !counted.has(v.n) ? `String(${base})` : base}`;
    };
    const msgOf = (ps) => ps.map((p) => {
      if (p.kind === "text") return toMessage(p.text);
      if (p.kind === "msg") return p.message;
      if (p.kind === "value") return `{${valueRef(p.expr)}}`;
      if (p.kind === "plural") return `{${valueRef(p.expr, true)}, plural, one {${toMessage(p.one)}} other {${toMessage(p.other)}}}`;
      if (p.kind === "tag") {
        rich = true;
        const open = p.node.openingElement.getText(sf), close = p.node.closingElement.getText(sf);
        const k = open;
        const fresh = !names.has(k);
        const n = nameFor(k, p.tag.toLowerCase());
        const inner = msgOf(p.inner);
        if (fresh) values.push(`${n}: (chunks) => ${open}{chunks}${close}`);
        return `<${n}>${inner}</${n}>`;
      }
      if (p.kind === "embed") {
        rich = true;
        const k = p.node.getText(sf);
        const fresh = !names.has(k);
        const n = nameFor(k, p.tag === "br" ? "br" : p.tag[0].toLowerCase() + p.tag.slice(1));
        if (fresh) values.push(`${n}: $el(${k})`);
        return `<${n}></${n}>`;
      }
      return "";
    }).join("");
    const whole = msgOf(run);
    const message = whole.trim();
    const first = run[0].child, last = run[run.length - 1].child;
    const plain = run.map((p) => (p.kind === "text" ? p.text : p.kind === "msg" ? p.plain : " ")).join("");
    if (TERM_WORD && !new RegExp(TERM_WORD.source).test(plain)) return;
    // A lone piece of text is judged like any string; a sentence with values
    // or markup in it is prose by construction.
    if (run.length === 1 && run[0].kind === "text") {
      const why = judge(ts.isJsxText(first) ? first : first.expression, run[0].text);
      // Plain words between tags are always drawn, never compared.
      const plainWords = ts.isJsxText(first) && /^[A-Za-z][A-Za-z ,—–'’.()-]*$/.test(run[0].text.trim());
      if (why && why !== "one word" && !(why === "value-shaped" && plainWords)) { report.review.push(`${rel}:${lineOf(first)}\t${why}\t${message.slice(0, 100)}`); return; }
    }
    const key = keyFor(area, file, message);
    if (rich) usesRich = true;
    const vals = values.map(valueCode);
    const call = rich ? `$rich("${key}", { ${vals.join(", ")} })` : vals.length ? `$t("${key}", { ${vals.join(", ")} })` : `$t("${key}")`;
    const start = ts.isJsxText(first) ? first.pos : first.getStart(sf), end = last.getEnd();
    const raw = src.slice(start, end);
    const head = ts.isJsxText(first) ? raw.match(/^\s*/)[0] : "";
    const tail = ts.isJsxText(last) ? raw.match(/\s*$/)[0] : "";
    const out = (head.includes("\n") ? head : "") + (/^\s/.test(whole) ? '{" "}' : "") + `{${call}}` + (/\s$/.test(whole) ? '{" "}' : "") + (tail.includes("\n") ? tail : "");
    if (out === src.slice(start, end)) return; // already this message
    edits.push({ start, end, text: out });
    report.moved++;
  }

  const visit = (node) => {
    if (consumed.has(node)) return;
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(sf) : "";
      if (ts.isJsxElement(node)) visit(node.openingElement);
      if (RAW_TAGS.has(tag)) return;
      if (!CODE_TAGS.has(tag)) sentences(node);
      for (const c of node.children) if (!consumed.has(c) && !(CODE_TAGS.has(tag) && ts.isJsxText(c))) visit(c);
      return;
    }
    // A template with substitutions is one sentence: handle it whole.
    if (ts.isTemplateExpression(node)) {
      const pieces = [node.head, ...node.templateSpans.map((s) => s.literal)];
      const whole = pieces.map((p) => p.text).join(" ");
      if ((!TERM_WORD || new RegExp(TERM_WORD.source).test(whole)) && /[A-Za-z]{2,}/.test(whole)) {
        const why = judge(node.head, whole);
        if (why) report.review.push(`${rel}:${lineOf(node)}\t${why}\t${whole.slice(0, 100)}`);
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
          const inAttr = node.parent && ts.isJsxAttribute(node.parent);
          edits.push({ start: node.getStart(sf), end: node.getEnd(), text: inAttr ? `{${call}}` : call });
          report.moved++;
        }
        return; // never descend into a template we judged
      }
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !(node.parent && ts.isTemplateExpression(node.parent))) {
      const text = node.text;
      if (/[A-Za-z]{2,}/.test(text) && (!TERM_WORD || new RegExp(TERM_WORD.source).test(text))) {
        const why = judge(node, text);
        if (why) report.review.push(`${rel}:${lineOf(node)}\t${why}\t${text.trim().slice(0, 100)}`);
        else {
          // Spaces at the ends are part of what the page draws (" · warnings…").
          const key = keyFor(area, file, toMessage(text));
          edits.push({ start: node.getStart(sf), end: node.getEnd(), text: node.parent && ts.isJsxAttribute(node.parent) ? `{$t("${key}")}` : `$t("${key}")` });
          report.moved++;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  report.files++;
  if (!WRITE) continue;
  // The import, as one more edit in the original's coordinates.
  const want = usesRich ? `$rich, $t${edits.some((e) => e.text.includes("$el(")) ? ", $el" : ""}` : "$t";
  const existing = sf.statements.find((s) => ts.isImportDeclaration(s) && s.moduleSpecifier.text === "@/i18n");
  if (existing) {
    const have = existing.importClause?.namedBindings?.elements?.map((e) => e.name.text) ?? [];
    const all = [...new Set([...have, ...want.split(", ")])].sort();
    edits.push({ start: existing.getStart(sf), end: existing.getEnd(), text: `import { ${all.join(", ")} } from "@/i18n";` });
  } else {
    const firstImport = sf.statements.find((s) => ts.isImportDeclaration(s));
    const directive = sf.statements.find((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && /^use (client|server)$/.test(s.expression.text));
    if (firstImport) edits.push({ start: firstImport.getStart(sf), end: firstImport.getStart(sf), text: `import { ${want} } from "@/i18n";\n` });
    else if (directive) edits.push({ start: directive.getEnd(), end: directive.getEnd(), text: `\nimport { ${want} } from "@/i18n";` });
    else edits.push({ start: 0, end: 0, text: `import { ${want} } from "@/i18n";\n` });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i].end > edits[i - 1].start) throw new Error(`${rel}: overlapping edits at ${edits[i].start}`);
  }
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  fs.writeFileSync(abs, out);
}

if (WRITE) {
  // A sentence that joined a longer one leaves its old key behind: drop every
  // key no file names (tests/i18n.test.ts refuses dead keys).
  const used = new Set();
  for (const f of tracked) for (const m of fs.readFileSync(path.join(WEB, f), "utf8").matchAll(/\$(?:t|rich)\(\s*"([^"]+)"/g)) used.add(m[1]);
  for (const a of fs.readdirSync(path.join(WEB, "messages/en")).filter((f) => f.endsWith(".json") && f !== "terms.json")) catalog(a.slice(0, -5));
  for (const [area, obj] of catalogs) for (const [file, ns] of Object.entries(obj)) {
    if (typeof ns === "string") { if (!used.has(`${area}.${file}`)) delete obj[file]; continue; }
    for (const k of Object.keys(ns)) if (!used.has(`${area}.${file}.${k}`)) delete ns[k];
    if (!Object.keys(ns).length) delete obj[file];
  }
  for (const [area, obj] of catalogs) {
    const sorted = Object.fromEntries(Object.keys(obj).sort().map((f) => [f, typeof obj[f] === "string" ? obj[f] : Object.fromEntries(Object.keys(obj[f]).sort().map((k) => [k, obj[f][k]]))]));
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
