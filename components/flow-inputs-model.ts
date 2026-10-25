// "Run with…" — a flow's saved input sets, as markdown in the workspace.
//
// An input set is a named task. Two places hold them, both under evals/ and
// both read by core's eval parser, so `foldrun check` validates them like
// any eval (the flow they name must exist):
//
//   evals/<flow>-inputs.md   `inputs: true` — what "Save current as input
//                            set" writes. One `## name` per set, a `task:`
//                            each, no assertions; never run as an eval.
//   any eval with flow: <f>  every case already carries a `task:` — an input
//                            somebody wrote down to test the flow with.
//
// `foldrun invoke <flow> --inputs <name>` reads the same two places.

export interface EvalLike {
  name: string;
  file: string;
  flow: string | null;
  inputs?: boolean;
  cases: { name: string; task: string }[];
}

export interface InputSet {
  name: string;
  task: string;
  /** The file under evals/ it came from. */
  file: string;
  /** From the flow's own inputs file, or borrowed from an eval case. */
  source: "inputs" | "eval";
}

export const inputsFile = (flow: string) => `evals/${flow}-inputs.md`;

/** Every set for one flow: its inputs file first, then eval cases. A name
 *  the inputs file has hides an eval case of the same name, as the CLI's
 *  `--inputs` lookup does. */
export function inputSetsFor(evals: EvalLike[], flow: string): InputSet[] {
  const own = evals.filter((e) => e.flow === flow && e.inputs === true);
  const borrowed = evals.filter((e) => e.flow === flow && e.inputs !== true);
  const out: InputSet[] = [];
  const seen = new Set<string>();
  for (const [list, source] of [
    [own, "inputs"],
    [borrowed, "eval"],
  ] as const) {
    for (const e of list) {
      for (const c of e.cases) {
        if (!c.task.trim() || seen.has(c.name)) continue;
        seen.add(c.name);
        out.push({ name: c.name, task: c.task, file: e.file, source });
      }
    }
  }
  return out;
}

/** A set's name is a `## ` heading: one line, nothing a heading cannot say. */
export function cleanSetName(name: string): string {
  return name.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "").replace(/^case:\s*/i, "").trim().slice(0, 80);
}

/**
 * A task laid out the way core's eval parser reads it back: one line after
 * `task:`, or a `|` block, indented. A line starting `- ` would end the block
 * (the parser takes it for a list item), so it is written `* ` — the same
 * bullet to a reader and to a model. Same rule as core's promote-to-eval.
 */
export function layoutTask(task: string): string {
  const t = task.replace(/\r\n/g, "\n").trim();
  if (!t.includes("\n") && !/^["'|>]|["']$/.test(t)) return `task: ${t}`;
  return `task: |\n${t
    .split("\n")
    .map((l) => (l.trim() ? `  ${l.replace(/^(\s*)-\s/, "$1* ")}` : ""))
    .join("\n")}`;
}

function newFile(flow: string): string {
  return [
    "---",
    `name: ${flow}-inputs`,
    `flow: ${flow}`,
    "inputs: true",
    "trigger: manual",
    "---",
    "",
    `Saved inputs for the ${flow} flow — "Run with…" on its card, or`,
    `\`foldrun invoke ${flow} --inputs <name>\`. Not an eval: nothing here is asserted.`,
    "",
  ].join("\n");
}

/**
 * The inputs file with one set added, or replaced when its name is taken.
 * Everything else in the file — other sets, prose, frontmatter — is kept
 * byte for byte.
 */
export function upsertInputSet(existing: string | null, flow: string, name: string, task: string): string {
  const heading = cleanSetName(name);
  if (!heading) throw new Error("an input set needs a name");
  if (!task.trim()) throw new Error("an input set needs a task");
  const section = `## ${heading}\n${layoutTask(task)}\n`;
  const base = existing ?? newFile(flow);
  const lines = base.split("\n");
  const start = lines.findIndex((l) => {
    const m = /^##\s+(?:case:\s*)?(.+?)\s*$/.exec(l);
    return m !== null && m[1] === heading;
  });
  if (start === -1) return `${base.replace(/\n*$/, "\n")}\n${section}`;
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  const before = lines.slice(0, start).join("\n");
  const after = lines.slice(end).join("\n");
  return `${before}${before ? "\n" : ""}${section}${after ? `\n${after}` : ""}`;
}
