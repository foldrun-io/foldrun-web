// Layout says start and end, not left and right, so one stylesheet serves a
// left-to-right page and a right-to-left one (Persian on a `.ir` host). In
// English the two are the same pixels.
//
//   node scripts/logical-classes.mjs           lists every physical class left
//   node scripts/logical-classes.mjs --write   rewrites them
//
// tests/logical-classes.test.ts runs the list and expects it empty. A class
// that must stay physical (a canvas placed by pixel, a code column) is kept
// by writing it in a file or on a line listed in PHYSICAL below, with why.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALUE = String.raw`(?:\[[^\]\s]+\]|\d+(?:\.\d+)?(?:\/\d+)?|px|auto|full)`;
const VARIANTS = String.raw`(?:(?:[a-z0-9-]+|\[[^\]\s]+\]|[a-z-]+-\[[^\]\s]+\])(?:\/[a-z]+)?:)*`;
const EDGE = String.raw`(?<=^|[\s"'\`])`;
const END = String.raw`(?=$|[\s"'\`])`;
/** A word the code compares or switches on is a value, not a class: `x === "text-left"`. */
const COMPARED = /(?:[=!]==?|\bcase)\s*["'`]$/;

/** [pattern, replacement of the utility's name]. `!` and `-` prefixes and variants are kept. */
const RULES = [
  [String.raw`(ml)-${VALUE}`, "ms"], [String.raw`(mr)-${VALUE}`, "me"],
  [String.raw`(pl)-${VALUE}`, "ps"], [String.raw`(pr)-${VALUE}`, "pe"],
  [String.raw`(scroll-ml)-${VALUE}`, "scroll-ms"], [String.raw`(scroll-mr)-${VALUE}`, "scroll-me"],
  [String.raw`(scroll-pl)-${VALUE}`, "scroll-ps"], [String.raw`(scroll-pr)-${VALUE}`, "scroll-pe"],
  // Not `left-1/2`: with `-translate-x-1/2` it centres, the same way in both directions.
  [String.raw`(left)-(?!1\/2)${VALUE}`, "start"], [String.raw`(right)-(?!1\/2)${VALUE}`, "end"],
  [String.raw`(text-left)`, "text-start"], [String.raw`(text-right)`, "text-end"],
  [String.raw`(float-left)`, "float-start"], [String.raw`(float-right)`, "float-end"],
  [String.raw`(clear-left)`, "clear-start"], [String.raw`(clear-right)`, "clear-end"],
  [String.raw`(border-l)(?:-${VALUE}|-[a-z]+(?:-[a-z0-9]+)*(?:\/\d+)?)?`, "border-s"], [String.raw`(border-r)(?:-${VALUE}|-[a-z]+(?:-[a-z0-9]+)*(?:\/\d+)?)?`, "border-e"],
  [String.raw`(rounded-l)(?:-[a-z0-9]+|-\[[^\]\s]+\])?`, "rounded-s"], [String.raw`(rounded-r)(?:-[a-z0-9]+|-\[[^\]\s]+\])?`, "rounded-e"],
  [String.raw`(rounded-tl)(?:-[a-z0-9]+|-\[[^\]\s]+\])?`, "rounded-ss"], [String.raw`(rounded-tr)(?:-[a-z0-9]+|-\[[^\]\s]+\])?`, "rounded-se"],
  [String.raw`(rounded-bl)(?:-[a-z0-9]+|-\[[^\]\s]+\])?`, "rounded-es"], [String.raw`(rounded-br)(?:-[a-z0-9]+|-\[[^\]\s]+\])?`, "rounded-ee"],
].map(([p, to]) => [new RegExp(`${EDGE}(${VARIANTS}!?-?)${p}!?${END}`, "g"), to]);

/** Lines that keep a physical class on purpose: `// physical: <why>` at the end of the line or on the line above. */
const KEPT = /\/[/*]\s*physical:/;

export function files(roots = ["app", "components"]) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      // A route handler draws nothing: its strings are values an API caller sends.
      else if (/\.(ts|tsx|css)$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== "route.ts") out.push(p);
    }
  };
  for (const r of roots) walk(path.join(WEB, r));
  return out;
}

/** Every physical class in a text: [{ line, found, becomes }], and the text rewritten. */
export function scan(text) {
  const lines = text.split("\n");
  const found = [];
  const out = lines.map((line, i) => {
    if (KEPT.test(line) || (i > 0 && KEPT.test(lines[i - 1]))) return line;
    let next = line;
    for (const [re, to] of RULES) {
      next = next.replace(re, (whole, prefix, name, at, all) => {
        if (COMPARED.test(all.slice(0, at))) return whole;
        const becomes = prefix + to + whole.slice(prefix.length + name.length);
        found.push({ line: i + 1, found: whole, becomes });
        return becomes;
      });
    }
    return next;
  });
  return { found, text: out.join("\n") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes("--write");
  let n = 0;
  for (const f of files()) {
    const src = fs.readFileSync(f, "utf8");
    const r = scan(src);
    if (!r.found.length) continue;
    n += r.found.length;
    if (write) fs.writeFileSync(f, r.text);
    else for (const x of r.found) console.log(`${path.relative(WEB, f)}:${x.line}  ${x.found} → ${x.becomes}`);
  }
  console.log(`${n} physical class(es) ${write ? "rewritten" : "found"}`);
  process.exit(!write && n ? 1 : 0);
}
