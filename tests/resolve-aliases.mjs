// The resolve hook register.mjs installs. Mirrors tsconfig.json `paths`,
// and adds the `.ts` the bundler adds to an extensionless import.

import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const ALIASES = [
  ["@/lib/", path.join(root, "..", "foldrun-core", "src") + "/"],
  ["@/platform/", path.join(root, "..", "foldrun-platform", "src") + "/"],
  ["@/docs-index", path.join(root, "..", "foldrun-docs", "index.ts")],
  ["@/", root + "/"],
];

const hasExtension = (s) => /\.[cm]?[jt]sx?$|\.json$/.test(s);

async function withExtension(specifier, context, next) {
  if (hasExtension(specifier)) return next(specifier, context);
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" && err?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw err;
    try {
      return await next(`${specifier}.ts`, context);
    } catch (again) {
      // A folder import: the bundler reads its index.
      if (again?.code !== "ERR_MODULE_NOT_FOUND") throw again;
      return next(`${specifier}/index.ts`, context);
    }
  }
}

export async function resolve(specifier, context, next) {
  // next's package has no exports map; the bundler adds the extension.
  if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);
  for (const [prefix, target] of ALIASES) {
    if (specifier === prefix || specifier.startsWith(prefix)) {
      const file = pathToFileURL(target + specifier.slice(prefix.length)).href;
      return withExtension(file, context, next);
    }
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) return withExtension(specifier, context, next);
  return next(specifier, context);
}
