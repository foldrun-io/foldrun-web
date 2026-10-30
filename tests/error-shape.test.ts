// One way to refuse (30 Oct 2026). Routes built the { error } body by hand
// 219 times; the answer was the same, but a refusal that skips errorResponse
// skips what it does (the shape, the logging of a fault). A route refuses
// with `refuse(message, status)`, throws ApiError, or — when the answer
// carries more than the sentence (a code, the current text) — builds it.
//
//   node --import ./tests/register.mjs --test tests/error-shape.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(import.meta.dirname, "..", "app");
const routes: string[] = [];
(function walk(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "route.ts") routes.push(p);
  }
})(root);

test("no route builds a bare { error } body by hand — refuse() or ApiError instead", () => {
  const found: string[] = [];
  for (const f of routes) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        n.expression.expression.getText(sf) === "NextResponse" && n.expression.name.text === "json" && n.arguments.length === 2
      ) {
        const [a, b] = n.arguments;
        const only = (o: ts.Expression, key: string) =>
          ts.isObjectLiteralExpression(o) && o.properties.length === 1 && o.properties[0].name?.getText(sf) === key;
        if (only(a, "error") && only(b, "status")) {
          found.push(`${path.relative(root, f)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  assert.deepEqual(found, [], "use refuse(message, status) from @/server/api");
});
