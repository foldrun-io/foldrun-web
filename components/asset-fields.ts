// The settings form behind an asset's detail drawer: which fields a tool,
// hook, skill or document has, read from the frontmatter schema
// (@/lib/frontmatter-fields — the same list `foldrun check` and the editor's
// completions read), and how one field is written back.
//
// Writing back keeps the file the source of truth: a field is replaced as its
// own block of lines — the key and anything indented under it — and every
// other line (comments, key order, keys the form does not know, the body) is
// left exactly as it was. Nothing re-serialises the whole frontmatter.

import { load, dump, CORE_SCHEMA } from "js-yaml";
import type { ReactNode } from "react";
import { FRONTMATTER, type FieldSpec } from "@/lib/frontmatter-fields";

export type AssetKind = "skills" | "memory" | "knowledge" | "tools" | "hooks" | "scripts";
export type Transport = "http" | "script" | "mcp";

/** One row of an asset list, and everything its drawer needs. */
export interface AssetItem {
  /** Workspace-relative, or library-relative for an account entry. */
  path: string;
  name: string;
  description: string;
  kind: AssetKind;
  /** An account-library entry: read and written through the library API. */
  account?: boolean;
  /** The agent whose own folder holds it; null/absent for workspace scope. */
  owner?: string | null;
  transport?: Transport;
  /** A folder tool's or hook's files, manifest first. */
  files?: string[];
  /** Script tools: the names under `args:`, so the test can supply them. */
  scriptArgs?: string[];
  /** A shared tool that this workspace's own tool of the same name hides:
   *  a test by name would run that one instead. */
  overridden?: boolean;
  /** Hooks: what the Test tab needs. */
  hook?: { on?: string; tool?: string; timeoutSec?: number; sample?: string; error?: string; shadowed?: boolean };
  /** The quiet labels beside the name (transport, OKF type and state). */
  badges?: ReactNode;
  /** The Used by tab, drawn by the server page. */
  usedBy?: ReactNode;
  /** Shown at the top of Overview — e.g. the gallery copy's state. */
  notice?: ReactNode;
}

// ---- reading and writing frontmatter -------------------------------------

const FM = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function splitDoc(raw: string): { front: string | null; head: string; body: string } {
  const m = raw.match(FM);
  if (!m) return { front: null, head: "", body: raw };
  const head = m[0].endsWith("\n") ? m[0] : `${m[0]}\n`;
  return { front: m[1] ?? "", head, body: raw.slice(m[0].length) };
}

export function readFront(raw: string): { data: Record<string, unknown>; error: string | null } {
  const { front } = splitDoc(raw);
  if (front === null || !front.trim()) return { data: {}, error: null };
  try {
    const v = load(front, { schema: CORE_SCHEMA });
    return { data: v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}, error: null };
  } catch (err) {
    return { data: {}, error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

/** One value as YAML, flow style, on as few lines as YAML allows. */
/** What the drawer's `?open=` names: the path, marked `shared:` when the file
 *  lives in the account library — a workspace file and a shared one can have
 *  the same relative path, and must never open (or be saved, or deleted) as
 *  each other. */
export function assetOpenId(item: { path: string; account?: boolean }): string {
  return `${item.account ? "shared:" : ""}${item.path}`;
}

export function toYaml(value: unknown): string {
  return dump(value, { flowLevel: 0, lineWidth: -1 }).replace(/\n$/, "");
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * Set one top-level key. The key's whole block (its line, and every indented
 * or `- ` line after it) is replaced; an empty value removes it; a new key
 * goes just above the closing `---`. A file with no frontmatter gets one.
 */
export function setField(raw: string, key: string, value: unknown): string {
  const { front, body } = splitDoc(raw);
  const lines = front ? front.split("\n") : [];
  // The mapping's own indentation (valid YAML may indent every top-level key):
  // the first line that is neither blank nor a comment sets it.
  const first = lines.find((l) => l.trim() && !/^\s*#/.test(l));
  const base = first ? (first.match(/^[ \t]*/)?.[0] ?? "") : "";
  const yaml = isEmpty(value) ? null : `${key}: ${toYaml(value)}`;
  // A value dumped on several lines (a block string) is indented with it.
  const next = yaml ? yaml.split("\n").map((l) => base + l).join("\n") : null;
  if (front === null) return next ? `---\n${next}\n---\n${raw}` : raw;
  // The key as YAML may spell it: bare, or in single or double quotes, with
  // any spaces before the colon (`"description" : old` is the same key).
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const b = base.replace(/\t/g, "\\t");
  const keyLine = new RegExp(`^${b}(?:${esc}|"${esc}"|'${esc}')[ \\t]*:(?:[ \\t]|$)`);
  const at = lines.findIndex((l) => keyLine.test(l));
  if (at === -1) {
    if (next) lines.push(next);
  } else {
    let end = at + 1;
    // A line continues the key's block when it is indented past the mapping,
    // or is a `- ` item at the mapping's own indentation.
    const continues = (l: string) => (l.startsWith(base) && /^[ \t]/.test(l.slice(base.length))) || (l.startsWith(base) && /^-( |$)/.test(l.slice(base.length)));
    const filler = (l: string) => !l.trim() || /^\s*#/.test(l);
    while (end < lines.length) {
      const l = lines[end];
      if (!filler(l) && continues(l)) end++;
      else if (filler(l)) {
        // A blank line, or a comment, belongs to the block only when the block
        // goes on after it (`methods:\n- GET\n# c\n- POST`).
        let k = end;
        while (k < lines.length && filler(lines[k])) k++;
        if (k < lines.length && continues(lines[k])) end = k;
        else break;
      } else break;
    }
    lines.splice(at, end - at, ...(next ? next.split("\n") : []));
  }
  return `---\n${lines.join("\n")}${lines.length ? "\n" : ""}---\n${body}`;
}

/**
 * Whether the form may write this file's settings one key at a time. setField
 * edits YAML as lines, which is what keeps comments, order and spacing; it
 * understands the block style every foldrun file is written in. For anything
 * else (a flow mapping `{name: x}`, anchors, a layout we have not met) the
 * check is direct: write every key back with its own value and see that the
 * file still reads the same. If it does not, the form shows the settings and
 * sends edits to Source rather than risk a file that no longer parses.
 */
export function editableInPlace(raw: string): boolean {
  const { data, error } = readFront(raw);
  if (error) return false;
  const want = JSON.stringify(data);
  for (const [k, v] of Object.entries(data)) {
    const again = readFront(setField(raw, k, v));
    if (again.error || JSON.stringify(again.data) !== want) return false;
  }
  // And a key that is not there yet can be added.
  const added = readFront(setField(raw, "__foldrun_probe__", "x"));
  return !added.error && added.data.__foldrun_probe__ === "x";
}

/** Replace the prose under the frontmatter, leaving the frontmatter as it is. */
export function setBody(raw: string, body: string): string {
  const { front, head } = splitDoc(raw);
  return front === null ? body : head + body;
}

// ---- which fields a form shows ---------------------------------------------

export type Control = "text" | "textarea" | "select" | "boolean" | "number" | "list" | "map" | "complex";

export interface UiField {
  key: string;
  label: string;
  help: string;
  control: Control;
  options?: { value: string; label: string }[];
  /** Real names to offer beside free text. */
  suggest?: "scripts" | "secrets" | "interpreters" | "mcp";
  placeholder?: string;
  /** Shown even when empty; the rest wait under "More settings". */
  primary?: boolean;
  /** A text box whose field also takes a number: `30` is written as one. */
  numeric?: boolean;
}

const LABEL: Record<string, string> = {
  base: "Base URL",
  url: "Server URL",
  run: "Program",
  args: "Arguments",
  openapi: "OpenAPI document",
  test_mode: "Test runs",
  "allowed-tools": "Allowed tools",
  on: "Runs on",
  tool: "Only for tool",
  timeout: "Timeout (seconds)",
  stale_after: "Stale after",
  when: "Loads on run tags",
};

const OPTION_LABEL: Record<string, string> = {
  http: "HTTP — someone else's API",
  script: "Script — code in your container",
  mcp: "MCP — an MCP server",
  "tool.call": "tool.call — before a tool runs",
  "tool.result": "tool.result — after a tool returns",
  "step.start": "step.start — when a step starts",
  "step.end": "step.end — when a step ends",
  allow: "allow — may run in a test run",
  draft: "draft",
  stable: "stable",
  deprecated: "deprecated",
};

const PLACEHOLDER: Record<string, string> = {
  base: "https://api.example.com/v1",
  url: "https://…/sse",
  command: "npx",
  run: "run.py",
  methods: "GET",
  args: "-y",
  stale_after: "YYYY-MM-DD",
};

const humanise = (k: string) => LABEL[k] ?? (k.charAt(0).toUpperCase() + k.slice(1)).replace(/[_-]/g, " ");

/** Which transports a tool field belongs to, from its help line: "http: …",
 *  "http or mcp: …", or "script: …; mcp: …" for a field both read. */
const SEGMENT = /^(http(?: or mcp)?|script|mcp):\s*/;
function transportsOf(help: string): Transport[] | null {
  const segs = help.split(";").map((x) => x.trim().match(SEGMENT)?.[1]).filter(Boolean) as string[];
  if (!segs.length) return null;
  return segs.flatMap((m) => (m === "http or mcp" ? (["http", "mcp"] as Transport[]) : [m as Transport]));
}
/** The help for this transport: the matching segment, prefix dropped. */
function helpFor(help: string, transport: string): string {
  const segs = help.split(";").map((x) => x.trim());
  const mine = segs.find((x) => x.startsWith(`${transport}:`) || (x.startsWith("http or mcp:") && (transport === "http" || transport === "mcp")));
  return (mine ?? segs[0]).replace(SEGMENT, "");
}

/** Where a schema help line is only the list of values the select shows. */
const HELP: Record<string, string> = {
  transport: "where the work happens",
  on: "the moment in a step it runs at",
};

const PRIMARY: Record<string, string[]> = {
  tools: ["name", "description", "transport"],
  "tools:http": ["base", "methods", "headers"],
  "tools:script": ["run", "interpreter", "args", "secrets"],
  "tools:mcp": ["command", "args", "url", "env"],
  hooks: ["on", "tool", "description", "timeout"],
  skills: ["name", "description", "when"],
  docs: ["title", "description", "type", "status", "tags"],
};

/** Flat maps of names to strings — editable as rows. Anything deeper is Source's. */
const FLAT_MAPS = new Set(["headers", "query", "env", "args"]);

/** memory/ and knowledge/ are OKF documents, not a schema kind of foldrun's own. */
const DOC_FIELDS: FieldSpec[] = [
  { key: "title", type: "string", help: "the name a reader sees" },
  { key: "description", type: "string", help: "one line: what this is and when to read it" },
  { key: "type", type: "string", help: "the concept type, e.g. Price List or Policy" },
  { key: "status", type: "string", values: ["draft", "stable", "deprecated"], help: "stable unless said otherwise" },
  { key: "tags", type: "list", help: "words to find it by" },
  { key: "stale_after", type: "string", help: "the day it should be checked again" },
];

function toUi(f: FieldSpec, kind: AssetKind, transport: string, value: unknown): UiField {
  const types = Array.isArray(f.type) ? f.type : [f.type];
  const help = HELP[f.key] ?? helpFor(f.help, transport);
  // A closed set, or a help line that is nothing but one ("a | b | c").
  const fromHelp = !f.values && /^[\w.]+(?: \| [\w.]+)+$/.test(f.help) ? f.help.split(" | ") : null;
  const values = f.values ?? fromHelp;
  const isMap = !!value && typeof value === "object" && !Array.isArray(value);
  const scalar = (v: unknown) => v === null || typeof v !== "object";
  let control: Control;
  if (values) control = "select";
  else if (types.includes("boolean") && types.length === 1) control = "boolean";
  else if (types[0] === "number" && !types.includes("string")) control = "number";
  else if (
    types.includes("object") &&
    (isMap || !types.includes("list") || (f.key === "args" && transport === "script" && !Array.isArray(value)))
  ) {
    // `args` is a list for an MCP command and a name → meaning map for a
    // script. Only flat maps are rows; anything deeper is Source's to edit.
    const flat = FLAT_MAPS.has(f.key) && (value === undefined || value === null || (isMap && Object.values(value as object).every(scalar)));
    control = flat ? "map" : "complex";
  } else if (types.includes("list")) {
    if (Array.isArray(value) && !value.every(scalar)) control = "complex";
    // `secrets: proxied` is a mode, not a one-item list.
    else if (f.key === "secrets" && typeof value === "string" && /^(proxied|materialised)$/.test(value)) control = "text";
    else control = "list";
  } else control = f.key === "description" ? "textarea" : "text";
  const primaryKey = kind === "memory" || kind === "knowledge" ? "docs" : kind;
  const primary = [...(PRIMARY[primaryKey] ?? []), ...(kind === "tools" ? PRIMARY[`tools:${transport}`] ?? [] : [])];
  return {
    key: f.key,
    label: humanise(f.key),
    help,
    control,
    options: values?.map((v) => ({ value: v, label: OPTION_LABEL[v] ?? v })),
    suggest: f.key === "run" ? "scripts" : f.key === "interpreter" ? "interpreters" : f.key === "command" ? "mcp" : f.key === "secrets" ? "secrets" : undefined,
    placeholder: PLACEHOLDER[f.key],
    primary: primary.includes(f.key),
    numeric: types.includes("number"),
  };
}

/** The form's fields for one file, in schema order, given what it says now. */
export function fieldsFor(kind: AssetKind, data: Record<string, unknown>): UiField[] {
  const transport = String(data.transport ?? data.type ?? "").toLowerCase();
  const specs: readonly FieldSpec[] =
    kind === "tools" ? FRONTMATTER.tool : kind === "hooks" ? FRONTMATTER.hook : kind === "skills" ? FRONTMATTER.skill : kind === "memory" || kind === "knowledge" ? DOC_FIELDS : [];
  return specs
    .filter((f) => !f.legacy)
    // The folder is a hook's name; saying it twice invites the two to differ.
    .filter((f) => !(kind === "hooks" && f.key === "name"))
    // A hook's `tool:` narrows tool events only.
    .filter((f) => !(kind === "hooks" && f.key === "tool" && !String(data.on ?? "").startsWith("tool.")))
    .filter((f) => {
      if (kind !== "tools") return true;
      const only = transportsOf(f.help);
      return !only || only.includes(transport as Transport);
    })
    .map((f) => toUi(f, kind, transport, data[f.key]));
}

/** Keys in the file that no field of the form owns — edited in Source. */
export function otherKeys(kind: AssetKind, data: Record<string, unknown>, fields: UiField[]): string[] {
  const owned = new Set(fields.map((f) => f.key));
  // The transport's older spelling is read, and Source is where it is changed.
  return Object.keys(data).filter((k) => !owned.has(k) && !(kind === "tools" && k === "type" && !data.transport && owned.has("transport")));
}

/** A value as the form's text box shows it. */
export function asText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return toYaml(v);
  return String(v);
}

/** The list a list control edits — a YAML list, or `a, b` on one line. */
export function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function asMap(v: unknown): [string, string][] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, x === null || x === undefined ? "" : String(x)]);
}

/** What a kind is called in a drawer's header. */
export const KIND_LABEL: Record<AssetKind, string> = {
  tools: "Tool",
  hooks: "Hook",
  skills: "Skill",
  memory: "Memory",
  knowledge: "Knowledge",
  scripts: "Code",
};
export const TRANSPORT_LABEL: Record<Transport, string> = { http: "API", script: "script", mcp: "MCP" };
