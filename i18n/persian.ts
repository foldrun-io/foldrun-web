// Persian's sentences and nouns, handed to `$t` (i18n/index.ts). Imported
// only where a Persian page is made, so the catalog is in no English page's
// download: server/locale.ts (server components) and
// i18n/persian-provider.tsx (client components, on the server and in the
// browser). tests/locale.test.ts refuses any other importer.

import { CATALOG_FA } from "@/messages/fa";
import TERMS_FA from "@/messages/fa/terms.json" with { type: "json" };
import { registerPersian } from "./index";

registerPersian(CATALOG_FA, TERMS_FA);

export { CATALOG_FA, TERMS_FA };
