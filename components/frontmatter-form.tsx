"use client";

// A form over a file's frontmatter.
//
// Some files are prose and want a preview; a tool file is *config* and wants
// fields. `type:` decides which fields matter, and getting them wrong is the
// commonest mistake — a missing `base:` makes an http tool load as nothing.
//
// The safety property that makes this acceptable: **the form patches only the
// keys it owns, line by line.** Comments, key order, unknown keys and the
// entire body survive untouched. A form that reserialised the file would make
// the editor the source of truth instead of the file, and every diff would be
// noise.

import { useEffect, useMemo, useState } from "react";
import { inputClass, selectClass } from "@/components/ui";

export interface Field {
  key: string;
  label: string;
  hint?: string;
  /** Only shown when the file's `type:` is one of these. */
  when?: string[];
  kind?: "text" | "select" | "list";
  options?: { value: string; label: string }[];
  /** Fill the choices from what this workspace actually has. A path typed by
   *  hand is the commonest way to create a tool that silently never loads. */
  optionsFrom?: "scripts" | "secrets" | "interpreters" | "mcp";
  placeholder?: string;
}

/** Servers people reach for first, so an MCP tool isn't a blank command box. */
const KNOWN_MCP = [
  { value: "npx", label: "npx — run a published server" },
  { value: "uvx", label: "uvx — run a Python server" },
  { value: "docker", label: "docker — run a containerised server" },
];

const INTERPRETERS = [
  { value: "python3", label: "python3" },
  { value: "node", label: "node" },
  { value: "bash", label: "bash" },
  { value: "ruby", label: "ruby" },
];

/** Read one top-level scalar key out of a frontmatter block. */
function readKey(raw: string, key: string): string {
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return "";
  const line = block[1].split("\n").find((l) => new RegExp(`^${key}:`).test(l));
  return line ? line.slice(key.length + 1).trim() : "";
}

/**
 * Set one key without disturbing anything else. Replaces the value in place
 * when the key exists, appends just above the closing `---` when it doesn't,
 * and removes the line when the value is cleared.
 */
export function patchKey(raw: string, key: string, value: string): string {
  const block = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!block) return raw;
  const [, open, body, close] = block;
  const lines = body.split("\n");
  const at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));

  if (!value.trim()) {
    if (at === -1) return raw;
    lines.splice(at, 1);
  } else if (at === -1) {
    lines.push(`${key}: ${value}`);
  } else {
    lines[at] = `${key}: ${value}`;
  }
  return raw.replace(open + body + close, open + lines.join("\n") + close);
}

export function FrontmatterForm({
  content,
  fields,
  onChange,
  workspace,
  tenant,
}: {
  content: string;
  fields: Field[];
  onChange: (next: string) => void;
  /** Used to offer real scripts and secrets rather than free text. */
  workspace?: string;
  tenant?: string;
}) {
  const [vocab, setVocab] = useState<{ scripts: string[]; secrets: string[] }>({
    scripts: [],
    secrets: [],
  });

  useEffect(() => {
    if (!workspace) return;
    fetch(`/api/workspaces/${workspace}/vocabulary`, {
      headers: { "x-foldrun-tenant": tenant ?? "default" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => v && setVocab({ scripts: v.scripts ?? [], secrets: v.secrets ?? [] }))
      .catch(() => {});
  }, [workspace, tenant]);

  const choicesFor = (field: Field) => {
    if (field.options) return field.options;
    switch (field.optionsFrom) {
      case "scripts":
        return vocab.scripts.map((s) => ({ value: s, label: s }));
      case "secrets":
        return vocab.secrets.map((s) => ({ value: `\${${s}}`, label: s }));
      case "interpreters":
        return INTERPRETERS;
      case "mcp":
        return KNOWN_MCP;
      default:
        return undefined;
    }
  };
  // Which fields matter is decided by how the tool connects, not by what the
  // document is — `type: Tool` is the same on all three.
  const type = readKey(content, "transport") || readKey(content, "type");
  const shown = useMemo(
    () => fields.filter((f) => !f.when || f.when.includes(type)),
    [fields, type],
  );

  // Anything in the frontmatter the form doesn't own — shown so it's obvious
  // the file has more in it than these boxes, and that saving won't eat it.
  const untouched = useMemo(() => {
    const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!block) return [];
    const owned = new Set(fields.map((f) => f.key));
    return block[1]
      .split("\n")
      .filter((l) => /^[a-zA-Z_]+:/.test(l))
      .map((l) => l.slice(0, l.indexOf(":")))
      .filter((k) => !owned.has(k));
  }, [content, fields]);

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      {shown.map((field) => {
        const value = readKey(content, field.key);
        const set = (next: string) => onChange(patchKey(content, field.key, next));

        return (
          <label key={field.key} className="block">
            <span className="mb-1 flex items-baseline gap-2">
              <span className="font-mono text-xs font-medium text-fg-secondary">{field.key}</span>
              {field.hint && <span className="text-xs text-fg-subtle">{field.hint}</span>}
            </span>

            {choicesFor(field) ? (
              <select
                value={value}
                onChange={(e) => set(e.target.value)}
                className={selectClass("w-full")}
              >
                <option value="">—</option>
                {choicesFor(field)?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={field.placeholder}
                spellCheck={false}
                className={inputClass("font-mono")}
              />
            )}
          </label>
        );
      })}

      {untouched.length > 0 && (
        <p className="border-t border-line-faint pt-2 text-xs text-fg-subtle">
          Also in this file, edited as text:{" "}
          <span className="font-mono">{untouched.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

/** The fields a tool file has, and which `type:` each belongs to. */
export const TOOL_FIELDS: Field[] = [
  { key: "name", label: "name", hint: "how agents refer to it" },
  { key: "description", label: "description", hint: "what it does, and when to call it" },
  {
    key: "transport",
    label: "transport",
    hint: "where the work happens",
    kind: "select",
    options: [
      { value: "http", label: "http — someone else's API" },
      { value: "script", label: "script — code in your container" },
      { value: "mcp", label: "mcp — an MCP server" },
    ],
  },
  { key: "base", label: "base", hint: "required", when: ["http"], placeholder: "https://api.example.com/v1" },
  { key: "methods", label: "methods", hint: "defaults to [GET]", when: ["http"], placeholder: "[GET, POST]" },
  {
    key: "run",
    label: "run",
    hint: "required — pick a script that exists",
    when: ["script"],
    optionsFrom: "scripts",
  },
  {
    key: "interpreter",
    label: "interpreter",
    hint: "inferred from the extension",
    when: ["script"],
    optionsFrom: "interpreters",
  },
  {
    key: "command",
    label: "command",
    hint: "required for a local server",
    when: ["mcp"],
    optionsFrom: "mcp",
  },
  { key: "args", label: "args", when: ["mcp"], placeholder: '["-y", "@scope/server"]' },
  { key: "url", label: "url", hint: "instead of command, for a remote server", when: ["mcp"], placeholder: "https://…/sse" },
];
