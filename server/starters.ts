// What a newly created document starts as — one place, because two routes
// (account library, workspace assets) ask the same question and had drifted
// into asking it differently.
//
// A tool is the only kind whose answer is more than one file, and the only
// kind with a shape to choose: an API or MCP definition is a lone .md, while
// a script tool is a folder holding its definition and the code it runs.

import { KINDS, SCRIPT_LANGUAGES, toolStarter, type Kind, type ScriptLanguage } from "@/lib/kinds";
import { GALLERY, galleryTemplate } from "@/platform/gallery";

/** The blank shapes offered alongside the gallery entries. */
const TRANSPORTS = new Set(["http", "script", "mcp"]);

export function startingFiles(
  kind: Kind,
  name: string,
  /** A transport ("script"), a gallery entry ("web"), or nothing. */
  from?: string,
  /** Which language a script tool is written in. Ignored by every other
   *  shape, and defaulted rather than required so an older client that does
   *  not send it still creates a working tool. */
  language?: string,
): { file: string; content: string }[] {
  if (kind === "tools" && from && TRANSPORTS.has(from)) {
    const lang = SCRIPT_LANGUAGES.find((l) => l.value === language)?.value;
    return toolStarter(name, from as "http" | "script" | "mcp", lang as ScriptLanguage | undefined);
  }
  if (from && (kind === "tools" || kind === "scripts")) {
    const seed = galleryTemplate(kind, from, name);
    // An unknown seed falls back to the blank one: the name is what they
    // actually asked for. A folder tool seeds more than one file.
    if (seed) return seed.map((f) => ({ file: `${kind}/${f.file}`, content: f.content }));
  }
  if (kind === "tools") return toolStarter(name, "http");
  // A hook is a folder: hook.md alone is not a hook (core readHookDef
  // refuses one with no run.mjs), so New writes both.
  if (kind === "hooks") {
    return [
      { file: KINDS.hooks.file(name), content: KINDS.hooks.template(name) },
      { file: `hooks/${name}/run.mjs`, content: hookRunStarter(name) },
    ];
  }
  return [{ file: KINDS[kind].file(name), content: KINDS[kind].template(name) }];
}

/**
 * The "start from" cards on New — blank shapes first, then the gallery's
 * working definitions. One definition for every page with a New button:
 * this used to live as a near-copy in two pages, which is how the account
 * dialog and the workspace dialog drifted apart.
 */
export function startFrom(kind: string) {
  const seeds = GALLERY.filter((t) => t.kind === kind).map((t) => ({
    value: t.name,
    label: t.title,
    hint: t.description,
    section: "Start from a template",
    // Two clicks to a working tool: picking a template names it after
    // itself, and the name field stays editable.
    suggestName: t.name,
  }));
  const shapes =
    kind === "tools"
      ? [
          { value: "http", label: "API tool", hint: "Call a REST API — base URL, allowed methods, headers. Credentials resolve server-side, never in the file.", section: "Start from scratch" },
          {
            value: "script",
            label: "Script tool",
            hint: "Run code you write. The folder holds the definition and the program; it runs in the sandbox.",
            section: "Start from scratch",
            // The only follow-up question in the product: a script tool has
            // to be written in something, and this used to be JavaScript
            // silently — a fact you learned by opening the file it made.
            then: {
              key: "language",
              label: "Language",
              choices: SCRIPT_LANGUAGES.map((l) => ({ value: l.value, label: l.label, hint: l.hint })),
            },
          },
          { value: "mcp", label: "MCP server", hint: "Connect an MCP server and let agents call the tools it exposes.", section: "Start from scratch" },
        ]
      : seeds.length
        ? [{ value: "", label: "Blank file", hint: "Start empty and write your own.", section: "Start from scratch" }]
        : [];
  if (!seeds.length && !shapes.length) return undefined;
  return { key: "template", choices: [...shapes, ...seeds] };
}

/** A new hook's run.mjs: allows everything, the contract in its comments —
 *  the same file `foldrun hook add` writes for a tool.call hook. */
export function hookRunStarter(name: string): string {
  return `// ${name} — a foldrun hook (on: tool.call). Self-contained: Node's built-ins only,
// no relative imports — it runs from a copy taken when the step starts.
//
// In:  one JSON object on stdin — the event:
//        { event, hook, run_id, step, agent, workspace,
//          tool: { name, input }        (tool.call, tool.result; + result on tool.result)
//          prompt                       (step.start)
//          reply                        (step.end) }
// Out: one JSON object on stdout, the last line printed:
//        tool.call    { decision: "allow" | "deny", reason, input, note }
//                     input replaces the tool's whole input; a deny needs a reason
//        step.start   { context, note }   context is added to the step's prompt
//        step.end     { reply, note }     reply replaces the step's reply
//        tool.result  { note }            a line on the run's trail
// Exit 0 with an answer. Exit 2 denies, with stderr as the reason.
// Anything else is a failure: a gate (tool.call, step.start) that fails
// refuses; a watcher (tool.result, step.end) that fails is recorded.
// No secrets and no model key reach this process.

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const event = JSON.parse(raw || "{}");

// Decide here. This one allows everything.
void event;
console.log(JSON.stringify({ decision: "allow" }));
`;
}
