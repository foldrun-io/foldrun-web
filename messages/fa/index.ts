// Every Persian language file, by area: the same keys as messages/en, laid
// over English (i18n/index.ts), so a key Persian lacks shows the English
// sentence. Words come from foldrun-infra docs/persian-glossary.md; the
// product's nouns are in terms.json.
import app from "./app.json" with { type: "json" };
import auth from "./auth.json" with { type: "json" };
import billing from "./billing.json" with { type: "json" };
import common from "./common.json" with { type: "json" };
import components from "./components.json" with { type: "json" };
import connect from "./connect.json" with { type: "json" };
import dashboard from "./dashboard.json" with { type: "json" };
import docs from "./docs.json" with { type: "json" };
import graph from "./graph.json" with { type: "json" };
import help from "./help.json" with { type: "json" };
import inbox from "./inbox.json" with { type: "json" };
import issues from "./issues.json" with { type: "json" };
import library from "./library.json" with { type: "json" };
import limits from "./limits.json" with { type: "json" };
import observe from "./observe.json" with { type: "json" };
import profile from "./profile.json" with { type: "json" };
import runs from "./runs.json" with { type: "json" };
import settings from "./settings.json" with { type: "json" };
import storage from "./storage.json" with { type: "json" };
import usage from "./usage.json" with { type: "json" };
import values from "./values.json" with { type: "json" };
import welcome from "./welcome.json" with { type: "json" };
import whatsNew from "./whats-new.json" with { type: "json" };
import workspace from "./workspace.json" with { type: "json" };

export const CATALOG_FA = { app, auth, billing, common, components, connect, dashboard, docs, graph, help, inbox, issues, library, limits, observe, profile, runs, settings, storage, usage, values, welcome, "whats-new": whatsNew, workspace };
