#!/usr/bin/env node
// Writes app/theme-dark.css: the dark half of the dashboard's colours.
//
// The dashboard is spelt in Tailwind's palette (and the semantic tokens in
// globals.css, which point into it). Dark mode re-points the palette rather
// than adding a dark: twin to three thousand classes, so a class written
// today and a class written next year are both right in both themes:
//
//   white, the neutrals   a dark ladder: white is the card, 50–300 the
//                         surfaces and lines above it, 400–950 the text,
//                         brightest at 950 — the light ladder, turned over
//   every hue, 50–300     the hue's 500 mixed into the card (14/22/32/48%):
//                         a tint you can read light text on
//   every hue, 400–500    unchanged — dots, bars, solid fills
//   every hue, 600–950    the light ladder's 400…50 — text bright enough to
//                         read on the dark card (a 600 button with white text
//                         becomes a 400 button with dark text: still AA)
//
// `.palette-fixed` puts the light values back for a subtree that is dark on
// purpose in both themes (the browser viewer's window chrome).
//
//   node scripts/gen-dark-palette.mjs            rewrite app/theme-dark.css
//   node scripts/gen-dark-palette.mjs --check    exit 1 if it is stale
//   node scripts/gen-dark-palette.mjs --contrast print the key pairs' ratios

import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const webRoot = path.join(here, "..");
const OUT = path.join(webRoot, "app/theme-dark.css");

const themeCss = fs.readFileSync(path.join(webRoot, "node_modules/tailwindcss/theme.css"), "utf8");
const palette = {};
for (const m of themeCss.matchAll(/--color-([a-z]+)-(\d+):\s*(oklch\([^)]*\));/g)) {
  (palette[m[1]] ??= {})[m[2]] = m[3];
}
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
// The greys: every family whose 500 is nearly colourless (slate, gray, zinc,
// neutral, stone, and Tailwind's newer taupe, mauve, olive, mist).
const NEUTRALS = Object.keys(palette).filter((f) => Number(palette[f]["500"].match(/oklch\([\d.]+%\s+([\d.]+)/)[1]) < 0.06);
const HUES = Object.keys(palette).filter((f) => !NEUTRALS.includes(f));

// The dark card every tint is mixed into, and the grounds around it.
const CARD_L = 20.5;
const GROUND = { background: 16.5, paper: 17.5, "paper-deep": 15.5 };
// The dark ladder, lightness in %. 400 is the "subtle" text (light mode's
// 400 on white is 2.5:1; this is better than that), 500 the muted text (AA).
const LADDER = { 50: 23.5, 100: 26, 200: 31, 300: 37.5, 400: 60, 500: 70, 600: 77.5, 700: 84, 800: 89.5, 900: 93.5, 950: 96.5 };
const TINT = { 50: 14, 100: 22, 200: 32, 300: 48 };
const MIRROR = { 600: "400", 700: "300", 800: "200", 900: "100", 950: "50" };

const chromaHue = (fam) => {
  const [, , c, h] = palette[fam]["500"].match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.a-z]+)\)/);
  return { c: Math.min(Number(c), 0.02), h: h === "none" ? 0 : Number(h) };
};
const neutral = (fam, l) => {
  const { c, h } = chromaHue(fam);
  return `oklch(${l}% ${(c * 0.6).toFixed(3)} ${h})`;
};
const card = neutral("gray", CARD_L);

/** @returns {Record<string, string>} */
export function darkVars() {
  /** @type {Record<string, string>} */
  const v = {};
  v["--color-white"] = card;
  for (const fam of NEUTRALS) for (const s of SHADES) v[`--color-${fam}-${s}`] = neutral(fam, LADDER[s]);
  for (const fam of HUES) {
    for (const s of SHADES) {
      if (TINT[s]) v[`--color-${fam}-${s}`] = `color-mix(in oklab, ${palette[fam]["500"]} ${TINT[s]}%, ${card})`;
      else if (MIRROR[s]) v[`--color-${fam}-${s}`] = palette[fam][MIRROR[s]];
    }
  }
  v["--background"] = neutral("gray", GROUND.background);
  v["--foreground"] = neutral("gray", LADDER["900"]);
  v["--paper"] = neutral("gray", GROUND.paper);
  v["--paper-deep"] = neutral("gray", GROUND["paper-deep"]);
  return v;
}

function lightVars() {
  const v = { "--color-white": "#fff" };
  for (const fam of Object.keys(palette)) for (const s of SHADES) v[`--color-${fam}-${s}`] = palette[fam][s];
  return v;
}

// The semantic tokens (globals.css) point into the palette, and a custom
// property resolves where it is declared: under .palette-fixed they must be
// declared again, or they keep the dark values they inherited.
function semanticVars() {
  const css = fs.readFileSync(path.join(webRoot, "app/globals.css"), "utf8");
  const theme = css.match(/@theme \{([\s\S]*?)\n\}/)?.[1] ?? "";
  return Object.fromEntries([...theme.matchAll(/(--color-[a-z-]+):\s*(var\(--color-[a-z0-9-]+\));/g)].map((m) => [m[1], m[2]]));
}

const block = (sel, vars, indent = "", scheme = "dark") =>
  `${indent}${sel} {\n${indent}  color-scheme: ${scheme};\n` +
  Object.entries(vars).map(([k, val]) => `${indent}  ${k}: ${val};`).join("\n") + `\n${indent}}\n`;

export function render() {
  const dark = darkVars();
  return [
    "/* Generated by scripts/gen-dark-palette.mjs — edit that, not this. */",
    "",
    "/* The light palette, always declared — an SVG or canvas colour written as",
    "   var(--color-…) in a component resolves whether or not a class uses it —",
    "   and put back under .palette-fixed, for a subtree dark on purpose in both",
    "   themes (the browser viewer's window chrome). */",
    block(":root,\n.palette-fixed", lightVars(), "", "light"),
    block(".palette-fixed", semanticVars(), "", "light"),
    block(':root[data-theme="dark"]', dark),
    "@media (prefers-color-scheme: dark) {",
    block(':root:not([data-theme="light"]):not([data-theme="dark"])', dark, "  ") + "}",
    "",
  ].join("\n");
}

// ---------- contrast, for --contrast ----------

function oklchToRgb(str) {
  const m = str.match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.a-z]+)\)/);
  const L = Number(m[1]) / 100, C = Number(m[2]), H = m[3] === "none" ? 0 : (Number(m[3]) * Math.PI) / 180;
  return oklabToRgb([L, C * Math.cos(H), C * Math.sin(H)]);
}
function oklchToLab(str) {
  const m = str.match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.a-z]+)\)/);
  const L = Number(m[1]) / 100, C = Number(m[2]), H = m[3] === "none" ? 0 : (Number(m[3]) * Math.PI) / 180;
  return [L, C * Math.cos(H), C * Math.sin(H)];
}
function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => Math.min(1, Math.max(0, x)));
}
function resolve(val) {
  if (val === "#fff") return [1, 1, 1];
  const mix = val.match(/color-mix\(in oklab, (oklch\([^)]*\)) (\d+)%, (oklch\([^)]*\))\)/);
  if (mix) {
    const a = oklchToLab(mix[1]), b = oklchToLab(mix[3]), p = Number(mix[2]) / 100;
    return oklabToRgb(a.map((x, i) => x * p + b[i] * (1 - p)));
  }
  return oklchToRgb(val);
}
const lum = (rgb) => {
  const [r, g, b] = rgb; // linear already
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a, b) {
  const [x, y] = [lum(resolve(a)), lum(resolve(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (args.includes("--contrast")) {
    const d = darkVars(), l = lightVars();
    const pairs = [
      ["fg on card", "gray-900", "white"], ["fg-secondary on card", "gray-700", "white"], ["fg-tertiary on card", "gray-600", "white"],
      ["fg-muted on card", "gray-500", "white"], ["fg-subtle on card", "gray-400", "white"], ["fg-muted on sunken", "gray-500", "gray-50"],
      ["on-ink on ink", "white", "gray-900"], ["red-700 on red-50", "red-700", "red-50"], ["amber-800 on amber-50", "amber-800", "amber-50"],
      ["emerald-700 on emerald-50", "emerald-700", "emerald-50"], ["sky-700 on sky-50", "sky-700", "sky-50"], ["green-800 on green-100", "green-800", "green-100"],
      ["red-600 text on card", "red-600", "white"], ["white on red-600", "white", "red-600"], ["white on emerald-600", "white", "emerald-600"],
      ["amber-700 on card", "amber-700", "white"], ["blue-800 on blue-100", "blue-800", "blue-100"], ["orange-800 on orange-100", "orange-800", "orange-100"],
    ];
    const v = (vars, k) => vars[`--color-${k}`];
    for (const [name, fg, bg] of pairs) {
      console.log(`${name.padEnd(28)} light ${contrast(v(l, fg), v(l, bg)).toFixed(2).padStart(6)}   dark ${contrast(v(d, fg), v(d, bg)).toFixed(2).padStart(6)}`);
    }
  } else if (args.includes("--check")) {
    if (fs.readFileSync(OUT, "utf8") !== render()) {
      console.error("app/theme-dark.css is stale — run node scripts/gen-dark-palette.mjs");
      process.exit(1);
    }
  } else {
    fs.writeFileSync(OUT, render());
    console.log(`wrote ${path.relative(webRoot, OUT)}`);
  }
}
