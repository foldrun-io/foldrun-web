// The assistant's docs, as the web reads them. The search itself lives in
// the platform (foldrun-platform/src/assistant/docs.ts) so the worker that
// runs replies has it; this registers the web's source: the live
// foldrun-docs checkout when one is beside this app (a dev machine, the
// tests, CI), else the platform's default, the bundle the image writes
// before `next build` (scripts/assistant-docs.mjs). Imported for its effect
// by the route and by instrumentation.ts, which runs before the worker loop
// starts in a process that is both (FOLDRUN_ROLE=all).

import fs from "node:fs";
import path from "node:path";
import { docsDir, customerDocs } from "@/docs-index";
import { registerDocsSource } from "@/platform/assistant/docs";

export function registerLiveDocs(): boolean {
  const dir = docsDir();
  if (!fs.existsSync(path.join(dir, "customer-docs.mjs"))) return false;
  registerDocsSource(() => customerDocs(dir) as Record<string, string>);
  return true;
}

registerLiveDocs();

export { anchorOf, assistantDocs, docSections, docsOutline, documentedNames, readDoc, searchDocs, terms, docUrl, type DocHit, type DocSection } from "@/platform/assistant/docs";
