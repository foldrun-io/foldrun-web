// The path aliases tsconfig.json gives the dashboard — `@/lib/*` is core,
// `@/platform/*` the platform, `@/*` this repo — resolved for node --test,
// which reads no tsconfig. Registered once by the test script, so a test
// can import a route helper the way the route does instead of reaching
// across repos by relative path.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./resolve-aliases.mjs", pathToFileURL(import.meta.filename));
