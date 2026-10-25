#!/usr/bin/env node
// Write assistant-docs.json: the customer docs the dashboard's assistant
// answers from, for a build that will not have foldrun-docs at run time.
//
// The image copies foldrun-docs in for `next build` and deletes it after
// (foldrun-infra/Dockerfile), so the assistant could not read the markdown
// on the platform. This runs just before the build and leaves the same set
// customer-docs.mjs defines — no design records, no operator routes — as one
// JSON file beside package.json, which server/assistant-docs.ts reads when
// the sibling checkout is not there. Never committed (.gitignore): a dev
// machine and the tests read the live docs instead.
//
//   node scripts/assistant-docs.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.env.FOLDRUN_DOCS_DIR ?? path.resolve(here, "../../foldrun-docs");
const target = path.resolve(here, "../assistant-docs.json");

if (!fs.existsSync(path.join(source, "customer-docs.mjs"))) {
  console.error(`no foldrun-docs at ${source} — the assistant needs the docs to answer from`);
  process.exit(1);
}
const { customerDocs } = await import(pathToFileURL(path.join(source, "customer-docs.mjs")).href);
const docs = customerDocs(source);
const pages = Object.keys(docs).length;
if (!pages) {
  console.error(`foldrun-docs at ${source} has no customer pages`);
  process.exit(1);
}
fs.writeFileSync(target, JSON.stringify(docs));
console.log(`wrote assistant-docs.json: ${pages} pages, ${Math.round(fs.statSync(target).size / 1024)} KB`);
