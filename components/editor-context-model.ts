// What the editor's header and side panel say about a file, read from its
// path and its frontmatter. Pure; tests/editor-context.test.ts pins it.

export type FileKind = "agent" | "flow" | "tool" | "skill" | "knowledge" | "memory" | "eval" | "state" | "script" | "config" | "other";

/** Which kind of thing a workspace path is, by where it sits. */
export function kindOf(path: string): FileKind {
  if (/^agents\/[^/]+\/agent\.md$/.test(path)) return "agent";
  if (/^flows\//.test(path)) return "flow";
  if (/(^|\/)tools\//.test(path)) return "tool";
  if (/(^|\/)skills\//.test(path)) return "skill";
  if (/(^|\/)knowledge\//.test(path)) return "knowledge";
  if (/(^|\/)memory\//.test(path)) return "memory";
  if (/^evals\//.test(path)) return "eval";
  if (/^state\//.test(path)) return "state";
  if (/(^|\/)scripts\//.test(path) || /\.(py|sh|[mc]?js|ts|rb)$/.test(path)) return "script";
  if (path === "AGENTS.md" || path === "project.md") return "config";
  return "other";
}

/** The reference page for a kind, under /dashboard/docs. */
export const DOC_FOR: Partial<Record<FileKind, string>> = {
  agent: "agents",
  flow: "flows",
  tool: "tools",
  eval: "evals",
  skill: "agents",
  knowledge: "how-it-works",
  memory: "how-it-works",
  config: "agents",
};

export interface Chip {
  label: string;
  title?: string;
}

const host = (url: unknown) => {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 40);
  }
};
const count = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** `limits:` as one line — `per step: web.search 40, calls 300` — or null. */
function limitsTitle(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const parts = Object.entries(v as Record<string, unknown>).map(([k, n]) => `${k} ${typeof n === "object" && n ? JSON.stringify(n) : String(n)}`);
  return parts.length ? `per step: ${parts.join(", ")}` : null;
}

/**
 * The frontmatter, as chips a reader can take in without parsing YAML:
 * `http · POST · api.resend.com` for a tool, `sonnet · 3 tools` for an agent.
 */
/** `resources:` as a chip: "1 cpu · 3Gi · 12Gi disk", or null when it sets none. */
export function resourcesLabel(r: unknown): string | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const o = r as Record<string, unknown>;
  const parts = [
    o.cpu !== undefined ? `${String(o.cpu)} cpu` : null,
    o.memory !== undefined ? String(o.memory) : null,
    o.disk !== undefined ? `${String(o.disk)} disk` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function chipsFor(kind: FileKind, fm: Record<string, unknown>): Chip[] {
  const chips: Chip[] = [];
  const s = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : null);
  switch (kind) {
    case "tool": {
      const transport = s("transport") ?? s("type");
      if (transport) chips.push({ label: transport, title: "transport" });
      if (Array.isArray(fm.methods)) chips.push({ label: fm.methods.join(" "), title: "methods" });
      const h = host(fm.base);
      if (h) chips.push({ label: h, title: String(fm.base) });
      if (s("run")) chips.push({ label: `run ${s("run")}`, title: "the program this tool runs" });
      if (fm.args) chips.push({ label: plural(count(fm.args), "arg"), title: "arguments" });
      if (fm.timeout) chips.push({ label: `${fm.timeout}s`, title: "timeout" });
      break;
    }
    case "agent": {
      if (s("model")) chips.push({ label: s("model")!, title: "model" });
      if (s("effort")) chips.push({ label: `effort ${s("effort")}`, title: "effort" });
      if (fm.tools) chips.push({ label: plural(count(fm.tools), "tool"), title: Array.isArray(fm.tools) ? fm.tools.join(", ") : undefined });
      if (fm.agents) chips.push({ label: `asks ${count(fm.agents)}`, title: "agents it may consult" });
      if (s("size")) chips.push({ label: s("size")!, title: "sandbox size" });
      if (resourcesLabel(fm.resources)) chips.push({ label: resourcesLabel(fm.resources)!, title: "resources: over the size class's figures" });
      if (fm.budget) chips.push({ label: `budget $${fm.budget}`, title: "the most this agent may spend in one run" });
      if (limitsTitle(fm.limits)) chips.push({ label: plural(count(fm.limits), "limit"), title: limitsTitle(fm.limits)! });
      break;
    }
    case "flow": {
      if (s("trigger")) chips.push({ label: s("trigger")!, title: "trigger" });
      if (s("schedule")) chips.push({ label: s("schedule")!, title: "cron" });
      if (s("timezone")) chips.push({ label: s("timezone")!, title: "timezone" });
      if (s("model")) chips.push({ label: s("model")!, title: "model for every step" });
      if (fm.budget) chips.push({ label: `budget $${fm.budget}`, title: "per-run cap" });
      break;
    }
    case "eval": {
      if (s("agent")) chips.push({ label: `agent ${s("agent")}`, title: "what it tests" });
      if (s("flow")) chips.push({ label: `flow ${s("flow")}`, title: "what it tests" });
      if (s("trigger")) chips.push({ label: s("trigger")!, title: "when it runs" });
      if (s("model")) chips.push({ label: s("model")!, title: "model" });
      break;
    }
    case "knowledge":
    case "memory": {
      if (s("type")) chips.push({ label: s("type")!, title: "OKF type" });
      if (s("status")) chips.push({ label: s("status")!, title: "status" });
      if (s("expires")) chips.push({ label: `expires ${s("expires")}`, title: "expiry" });
      break;
    }
    case "skill": {
      if (Array.isArray(fm.when) && fm.when.length) chips.push({ label: `when ${fm.when.join(", ")}`, title: "tags that load it" });
      break;
    }
    case "config": {
      if (s("provider") || fm.provider) chips.push({ label: "own provider", title: "provider block" });
      if (fm.budget) chips.push({ label: `budget $${fm.budget}`, title: /\/|per|daily|weekly/i.test(String(fm.budget)) ? "cap over time" : "monthly cap" });
      if (fm.notify) chips.push({ label: "notify", title: "notification set" });
      if (limitsTitle(fm.limits)) chips.push({ label: plural(count(fm.limits), "limit"), title: `${limitsTitle(fm.limits)} — defaults an agent's own limits override` });
      break;
    }
    default:
      break;
  }
  return chips;
}

/** Every `${NAME}` a tool or agent file reads from the vault. */
export function secretRefs(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) out.add(m[1]);
  return [...out].sort();
}

/** The breadcrumb for a path: each folder a link to the tree at that folder. */
export function crumbs(path: string): { label: string; prefix: string }[] {
  const parts = path.split("/");
  return parts.map((label, i) => ({ label, prefix: parts.slice(0, i + 1).join("/") }));
}
