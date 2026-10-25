// `typescript` is pinned to 6.x in package.json for this file's sake:
// eslint-config-next's typescript-eslint refuses the TypeScript 7 (native)
// API outright, so with ^7 installed `npm run lint` died before reading a
// file. tsc 6 typechecks the dashboard the same; move the pin when
// typescript-eslint supports 7.1 (typescript-eslint/typescript-eslint#10940).
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The node:test files: plain TypeScript scripts, not app code, and they
    // read fixtures as `any` on purpose.
    "tests/**",
  ]),
  {
    rules: {
      // The Table component takes `cells: ReactNode[]` and keys each cell
      // itself (<td key={i}>), so a cell list is not a sibling list — but
      // the rule cannot tell them apart and fired on every cell in every
      // admin and billing table, and on nothing else. Off, not warn: a
      // rule that only ever cries wolf teaches people to ignore the column.
      "react/jsx-key": "off",
      // The React Compiler's advisories, which arrived with
      // eslint-config-next 16 against code written before them: setState
      // inside an effect, a ref read during render, a component defined
      // inside another. Each one is a real note about a real file and is
      // fixed when that file is next touched; a warning keeps it on the
      // page without failing the build for a pattern React still runs.
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
]);

export default eslintConfig;
