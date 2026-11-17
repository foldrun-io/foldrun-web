// Where the dashboard shows a code value as a word: a JSX child or a visible
// attribute whose type is a set of string literals. Such a value needs a
// label (components/value-labels.ts) unless it is file syntax the person
// writes, which the page shows as written. Used by tests/i18n.test.ts.
//
//   node scripts/i18n-values.mjs        list them

import path from "node:path";
import { dashboardFiles } from "./i18n-scan.mjs";
import { createRequire } from "node:module";

const WEB = path.resolve(import.meta.dirname, "..");
const ts = createRequire(import.meta.url)(path.join(WEB, "node_modules/typescript"));

/** Words that are frontmatter syntax: network:, transport:, an eval's
 *  assertion types, an example file name. */
export const SYNTAX = new Set(["open", "trusted", "none", "script", "mcp", "http", "contains", "not-contains", "matches", "file", "run", "judge", "folder-name"]);

/** A flag, a path or URL, an ENV_NAME or a time zone id: code, shown as written. */
const CODE_LIKE = /^\s*--|\/|^[A-Z][A-Z0-9_]*$/;

export function rawValues() {
  const found = [];
  // The census's list: tracked pages and components, and billing's on a
  // hosted checkout (scripts/i18n-scan.mjs dashboardFiles).
  const files = dashboardFiles().filter((f) => /\.tsx$/.test(f));
  const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(WEB, "tsconfig.json"), ts.sys.readFile).config, ts.sys, WEB);
  const program = ts.createProgram({ rootNames: files.map((f) => path.join(WEB, f)), options: { ...cfg.options, noEmit: true } });
  const tc = program.getTypeChecker();
  const VISIBLE = new Set(["title", "label", "placeholder", "aria-label", "alt", "description", "hint", "help", "meta", "summary", "tooltip"]);
  const literalWords = (t) => {
    const parts = t.isUnion() ? t.types : [t];
    const lits = parts.filter((p) => p.isStringLiteral());
    if (!lits.length || parts.some((p) => !(p.isStringLiteral() || p.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.BooleanLiteral)))) return null;
    const words = lits.map((l) => l.value).filter((v) => /^[a-z][a-z-]*( [a-z]+)*$/.test(v));
    return words.length ? words : null;
  };
  // The literal results of a ?: / ?? / || drawn on a page — `busy ? "Creating…" : label`
  // has the type string, so only its shape shows the word written in code.
  const branchWords = (e) => {
    const out = [];
    const walk = (x) => {
      if (ts.isParenthesizedExpression(x)) return walk(x.expression);
      if (ts.isConditionalExpression(x)) return (walk(x.whenTrue), walk(x.whenFalse));
      if (ts.isBinaryExpression(x) && /^(\?\?|\|\|)$/.test(x.operatorToken.getText())) return (walk(x.left), walk(x.right));
      if ((ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) && /\p{L}{2}/u.test(x.text) && !SYNTAX.has(x.text) && !CODE_LIKE.test(x.text)) out.push(x.text);
    };
    if (ts.isConditionalExpression(e) || ts.isBinaryExpression(e) || ts.isParenthesizedExpression(e)) walk(e);
    return out.length ? out : null;
  };
  for (const f of files) {
    const sf = program.getSourceFile(path.join(WEB, f));
    const visit = (n) => {
      let target = null, where = "";
      if (ts.isJsxExpression(n) && n.expression && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) { target = n.expression; where = "child"; }
      if (ts.isJsxAttribute(n) && VISIBLE.has(n.name.getText(sf)) && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) { target = n.initializer.expression; where = n.name.getText(sf); }
      if (target && !/\$t\(|\$rich\(/.test(target.getText(sf))) {
        const words = literalWords(tc.getTypeAtLocation(target)) ?? branchWords(target);
        if (words) found.push({ at: `${f}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`, where, expr: target.getText(sf).slice(0, 80), words });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const v of rawValues()) console.log(`${v.at}\t${v.where}\t${v.expr}\t[${v.words.join(", ")}]${v.words.every((w) => SYNTAX.has(w)) ? "\t(file syntax)" : ""}`);
}
