// Which API operations the CLI and the dashboard reach.
//
// The rule (CLAUDE.md, "How every foldrun feature ships") is that a feature
// is in the API, the dashboard, the CLI and the docs. The docs half is held
// by tests/consistency.test.ts (every route and method has an api.md row);
// this is the other two. It parses foldrun-cli's commands.mjs and bin, and
// this repo's app (outside app/api), components, lib and hooks, with the
// TypeScript compiler, finds every call whose first argument evaluates to an
// /api/ path — following string variables within their scope, templates and
// `new URL(...)` — reads its method from the call (remoteCall's options,
// fetch's init, …), and matches it to a route file, literal segments beating
// placeholders.
//
// It cannot see a path assembled from a value only known at run time
// (`/api/workspaces/${ws}/${kind}`); tests/surface-coverage.test.ts lists
// those, and every operation deliberately missing from one side, with why.
// First written as a one-off audit (13 Oct 2026), which found `hook ls` with
// no --to and manual credit with no dashboard control.
//
//   node scripts/surface-coverage.mjs     print what each side reaches and misses

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(here, "..");
const require = createRequire(path.join(WEB, "package.json"));
const ts = require("typescript");
const { walkRoutes } = await import(pathToFileURL(path.join(WEB, "scripts/gen-openapi.mjs")).href);

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

function walkFiles(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walkFiles(full, pred, out); }
    else if (pred(full)) out.push(full);
  }
  return out;
}

/** Evaluate an expression to a path pattern; `{}` for unknown pieces. */
function evalPath(node, resolve, depth = 0) {
  if (!node || depth > 6) return null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return evalPath(node.expression, resolve, depth);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { s: node.text, inferred: false };
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text, inferred = false;
    for (const span of node.templateSpans) {
      const prev = s;
      let piece = "{}";
      if (ts.isIdentifier(span.expression)) {
        const r = resolve(span.expression);
        if (r && /^\/api|^\/s\//.test(r.s) && prev === "") { piece = r.s; inferred = inferred || r.inferred; }
        else if (r && prev === "" ) { piece = r.s; inferred = inferred || r.inferred; }
      }
      // A substitution not after "/" is a query or suffix: mark it.
      if (piece === "{}" && !prev.endsWith("/") && prev !== "") piece = "{?}";
      s += piece + span.literal.text;
    }
    return { s, inferred };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = evalPath(node.left, resolve, depth + 1), b = evalPath(node.right, resolve, depth + 1);
    if (a && b) return { s: a.s + b.s, inferred: a.inferred || b.inferred };
    if (a) return { s: a.s + "{?}", inferred: true };
    return null;
  }
  if (ts.isIdentifier(node)) { const r = resolve(node); return r ? { ...r, inferred: true } : null; }
  if (ts.isNewExpression(node) && node.expression.getText() === "URL" && node.arguments?.length) return evalPath(node.arguments[0], resolve, depth + 1);
  if (ts.isConditionalExpression(node)) {
    const a = evalPath(node.whenTrue, resolve, depth + 1), b = evalPath(node.whenFalse, resolve, depth + 1);
    if (a && /\/api\//.test(a.s)) return { s: a.s, inferred: true, alt: b?.s };
    if (b && /\/api\//.test(b.s)) return { s: b.s, inferred: true };
  }
  return null;
}

function scanFile(file) {
  const src = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  // Variable declarations by name, with position (nearest preceding wins).
  const decls = new Map();
  const visitDecl = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const list = decls.get(n.name.text) ?? []; list.push(n); decls.set(n.name.text, list);
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) {
      const list = decls.get(n.left.text) ?? []; list.push({ name: n.left, initializer: n.right, pos: n.pos, getStart: () => n.getStart(), assign: true }); decls.set(n.left.text, list);
    }
    ts.forEachChild(n, visitDecl);
  };
  visitDecl(sf);
  const resolve = (id, seen = new Set()) => {
    if (seen.has(id.text)) return null; seen.add(id.text);
    const list = (decls.get(id.text) ?? []).filter((d) => d.pos < id.pos && inScope(d, id)).sort((a, b) => b.pos - a.pos);
    for (const d of list) {
      const r = evalPath(d.initializer, (x) => resolve(x, seen));
      if (r && /\/api\/|^\/s\//.test(r.s)) return r;
    }
    return null;
  };
  function inScope(d, id) {
    let n = d.assign ? d.name.parent : d.parent;
    while (n && !ts.isBlock(n) && !ts.isSourceFile(n) && !ts.isFunctionLike(n)) n = n.parent;
    if (!n) return true;
    return id.pos >= n.pos && id.end <= n.end;
  }
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const calls = [];
  const methodOfObj = (obj) => {
    if (!obj) return null;
    if (ts.isObjectLiteralExpression(obj)) {
      for (const p of obj.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText() === "method") {
          if (ts.isStringLiteral(p.initializer)) return p.initializer.text.toUpperCase();
          return "?" + p.initializer.getText().slice(0, 40);
        }
        if (ts.isShorthandPropertyAssignment(p) && p.name.text === "method") return "?method";
      }
      return "GET";
    }
    if (ts.isIdentifier(obj)) {
      const list = (decls.get(obj.text) ?? []).filter((d) => d.pos < obj.pos).sort((a, b) => b.pos - a.pos);
      if (list[0] && ts.isObjectLiteralExpression(list[0].initializer)) return methodOfObj(list[0].initializer);
      return "?" + obj.text;
    }
    return "?" + obj.getText().slice(0, 40);
  };
  const visit = (n) => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression.getText(sf).replace(/^await\s+/, "");
      const args = n.arguments ?? [];
      args.forEach((a, idx) => {
        const p = evalPath(a, resolve);
        if (!p || !/^(\/api\/|\/api$|\/s\/)/.test(p.s)) return;
        if (callee === "URL" ) return; // handled by the enclosing call
        if (/(^|\.)(Error|HttpError|log|warn|error|info|line|bold|dim|includes|indexOf|startsWith|test|match|replace)$/.test(callee)) return;
        let method = null;
        const name = callee.split(".").pop();
        if (["remoteCall"].includes(name)) method = args[3] ? methodOfObj(args[3]) : "GET";
        else if (["remoteFetch"].includes(name)) method = args[2] ? methodOfObj(args[2]) : "GET";
        else if (name === "remoteBytes") method = "GET";
        else if (name === "fetch" || name === "EventSource") method = args[idx + 1] ? methodOfObj(args[idx + 1]) : "GET";
        else if (name === "post") method = "POST";
        else {
          const lit = args.find((x) => ts.isStringLiteral(x) && METHODS.includes(x.text.toUpperCase()));
          const obj = args.find((x) => ts.isObjectLiteralExpression(x) && x.properties.some((pp) => pp.name?.getText() === "method"));
          method = lit ? lit.text.toUpperCase() : obj ? methodOfObj(obj) : "?" + name + "()";
        }
        calls.push({ file, line: lineOf(n), callee: name, path: p.s, alt: p.alt, inferred: p.inferred, method });
      });
    }
    // JSX href/src/action and plain links.
    if (ts.isJsxAttribute(n) && n.initializer) {
      const attr = n.name.getText(sf);
      let e = n.initializer;
      if (ts.isJsxExpression(e)) e = e.expression;
      const p = e && evalPath(e, resolve);
      if (p && /^\/api\//.test(p.s)) calls.push({ file, line: lineOf(n), callee: `jsx:${attr}`, path: p.s, inferred: p.inferred, method: attr === "action" ? "POST?" : "GET" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // Every other /api/ literal in the file, for the record (props, consts).
  const literals = [];
  const lit = (n) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)) && /\/api\//.test(n.text)) literals.push({ file, line: lineOf(n), text: n.text });
    ts.forEachChild(n, lit);
  };
  lit(sf);
  return { calls, literals };
}

// Match a called path to a route shape. Literal segments beat placeholders.
function matchRoute(p, routeShapes) {
  const clean = p.replace(/\{\?\}.*$/, "").replace(/\?.*$/, "").replace(/#.*$/, "").replace(/\/+$/, "");
  const segs = clean.split("/");
  const hits = [];
  for (const r of routeShapes) {
    if (r.segs.length !== segs.length) continue;
    let score = 0, ok = true;
    for (let i = 0; i < segs.length; i++) {
      const a = segs[i], b = r.segs[i];
      if (a === b) score += b === "{}" ? 1 : 3;
      else if (b === "{}" && a !== "") score += 2; // literal in a placeholder slot
      else if (a.includes("{}") && b !== "") score += 0.5; // placeholder in a literal slot: weak
      else { ok = false; break; }
    }
    if (ok) hits.push({ r, score });
  }
  hits.sort((a, b) => b.score - a.score);
  if (!hits.length) return { route: null, clean };
  const best = hits.filter((h) => h.score === hits[0].score);
  return { route: best[0].r, ambiguous: best.length > 1 ? best.map((h) => h.r.path) : null, clean };
}


/** Every operation, `METHOD /api/…` with dynamic segments as in the route files. */
export function operations(web = WEB) {
  return walkRoutes(web).flatMap((r) => r.methods.map((m) => `${m} ${r.path}`));
}

/** The operations a set of files reaches: `METHOD /api/…` → ["file:line", …]. */
function reached(files, web) {
  const routeShapes = walkRoutes(web).map((r) => ({ ...r, shape: r.path.replace(/\[[^\]]+\]/g, "{}"), segs: r.path.replace(/\[[^\]]+\]/g, "{}").split("/") }));
  const byOp = new Map();
  const unresolved = [];
  for (const file of files) {
    for (const c of scanFile(file).calls) {
      const m = matchRoute(c.path, routeShapes);
      const method = String(c.method ?? "").replace(/\?$/, "");
      if (!m.route || m.ambiguous || !method || method.startsWith("?")) {
        unresolved.push(`${path.basename(file)}:${c.line} ${c.method} ${c.path}`);
        continue;
      }
      const key = `${method} ${m.route.path}`;
      byOp.set(key, [...(byOp.get(key) ?? []), `${path.basename(file)}:${c.line}`]);
      if (method === "GET") byOp.set(`HEAD ${m.route.path}`, byOp.get(`HEAD ${m.route.path}`) ?? []);
    }
  }
  return { byOp, unresolved };
}

/** What the CLI reaches. Null when there is no ../foldrun-cli beside this checkout. */
export function cliReach(web = WEB, cli = path.join(web, "..", "foldrun-cli")) {
  const files = [path.join(cli, "src/commands.mjs"), path.join(cli, "bin/foldrun.mjs")];
  if (!files.every((f) => fs.existsSync(f))) return null;
  return reached(files, web);
}

/** What the dashboard reaches through /api. */
export function dashboardReach(web = WEB) {
  const files = ["app", "components", "lib", "hooks"].flatMap((d) =>
    walkFiles(path.join(web, d), (f) => /\.(tsx?|mjs)$/.test(f) && !f.includes(`${path.sep}app${path.sep}api${path.sep}`)),
  );
  return reached(files, web);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const ops = operations();
  const cli = cliReach();
  const dash = dashboardReach();
  console.log(`${ops.length} operations`);
  for (const [name, r] of [["CLI", cli], ["dashboard", dash]]) {
    if (!r) {
      console.log(`\n${name}: no checkout beside this one`);
      continue;
    }
    const missing = ops.filter((o) => !r.byOp.has(o));
    console.log(`\n${name} reaches ${ops.length - missing.length}; not reached (${missing.length}):`);
    for (const o of missing) console.log(`  ${o}`);
    if (r.unresolved.length) console.log(`  unresolved calls: ${r.unresolved.join("; ")}`);
  }
}
