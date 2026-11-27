// Layout says start and end, never left and right (scripts/logical-classes.mjs),
// so the same page is right in English and in Persian.
//
//   node --import ./tests/register.mjs --test tests/logical-classes.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { files, scan } from "../scripts/logical-classes.mjs";

test("no left/right class in the dashboard: start/end instead", () => {
  const left = files().flatMap((f) => scan(fs.readFileSync(f, "utf8")).found.map((x) => `${path.basename(f)}:${x.line} ${x.found} → ${x.becomes}`));
  assert.deepEqual(left, [], "run `node scripts/logical-classes.mjs --write`");
});

test("the rewrite knows a class from a word", () => {
  const { text, found } = scan('<div className="ml-2 -mr-1 md:pl-4 hover:pr-0.5 left-0 -right-0.5 text-left sm:text-right border-l border-r-2 border-l-line rounded-l-none rounded-tr-lg !ml-auto left-[3px]">');
  assert.equal(text, '<div className="ms-2 -me-1 md:ps-4 hover:pe-0.5 start-0 -end-0.5 text-start sm:text-end border-s border-e-2 border-s-line rounded-s-none rounded-se-lg !ms-auto start-[3px]">');
  assert.equal(found.length, 15);
  for (const same of ['"right-click the left-hand side"', "border-line", "html-left", "a left-to-right page", "translate-x-1/2", "left-1/2 -translate-x-1/2", "inset-x-0 mx-2 px-3", "rounded-lg border-line-strong"]) {
    assert.equal(scan(same).text, same);
  }
  assert.equal(scan('className="left-0" // physical: a canvas placed by pixel').found.length, 0);
  // Tailwind 4 writes "important" at the end.
  assert.equal(scan('"ml-auto! md:text-right!"').text, '"ms-auto! md:text-end!"');
  // A word the code compares is a value an API caller may send, not a class.
  for (const value of ['if (align === "text-left") return;', "case 'text-right':", 'x !== "ml-2"']) {
    assert.equal(scan(value).text, value);
  }
  assert.equal(files().some((f) => path.basename(f) === "route.ts"), false, "route handlers are never rewritten");
});
