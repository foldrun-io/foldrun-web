// A small markdown renderer.
//
// Agents write markdown — headings, tables, lists — and showing it as flat
// text throws that structure away exactly where a person is reading. This is a
// *lens*: it never edits, and the file stays the source of truth.
//
// Deliberately no dependency, for two reasons. The subset that matters here is
// small, and building React elements rather than setting innerHTML means
// agent-authored text cannot inject HTML by construction — no sanitiser to
// get wrong, because there is no HTML path at all.

import type { ReactNode } from "react";

/** Inline: `code`, **bold**, *italic*, [text](href). Order matters. */
function inline(text: string, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-gray-800">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(<strong key={key} className="font-semibold text-fg">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const [, label, href] = token.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      // Only http(s) and relative links render as links; anything else — a
      // javascript: URL, say — becomes plain text.
      const safe = /^(https?:\/\/|\.|\/|#)/.test(href);
      out.push(
        safe ? (
          <a key={key} href={href} className="text-blue-700 underline underline-offset-2" rel="noreferrer">
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    } else {
      out.push(<em key={key} className="italic">{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Table({ rows, k }: { rows: string[][]; k: string }) {
  const [head, ...body] = rows;
  return (
    <div key={k} className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-line-strong">
            {head.map((cell, i) => (
              <th key={i} className="px-2 py-1 text-left font-semibold text-fg-secondary">
                {inline(cell, `h${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-b border-line-faint">
              {row.map((cell, c) => (
                <td key={c} className="px-2 py-1 align-top text-fg-secondary">
                  {inline(cell, `c${r}-${c}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cells = (line: string) =>
  line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/**
 * Frontmatter, shown rather than hidden. Preview used to strip it, which made
 * the feature useless on the files that are mostly frontmatter — an agent.md
 * is a contract first and prose second.
 */
export function Frontmatter({ raw }: { raw: string }) {
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return null;
  const rows = block[1]
    .split("\n")
    .filter((l) => /^[a-zA-Z_]+:/.test(l))
    .map((l) => {
      const at = l.indexOf(":");
      return [l.slice(0, at), l.slice(at + 1).trim()] as const;
    });
  if (rows.length === 0) return null;

  return (
    <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-line bg-sunken/60 p-3 text-xs">
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-mono font-medium text-fg-muted">{key}</dt>
          <dd className="min-w-0 truncate font-mono text-gray-800">
            {value || <span className="text-fg-subtle">(see below)</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * `document` turns headings into real <h2>–<h4> with anchor ids.
 *
 * Off by default, and that default is the careful one: this component's usual
 * job is rendering what an AGENT wrote, and letting model output insert
 * document structure into a page — headings a screen reader will announce as
 * landmarks, ids another element might already own — is not something to do
 * silently. A docs page is different: it IS a document, its headings are the
 * only way to navigate 200 lines of reference, and its text is written by us.
 */
export function Markdown({
  text,
  className = "",
  document = false,
}: {
  text: string;
  className?: string;
  document?: boolean;
}) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={blocks.length} className="my-2 overflow-x-auto rounded-lg bg-ink p-3 text-xs leading-relaxed text-gray-100">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // table: a header row followed by a --- separator
    if (line.includes("|") && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1] ?? "")) {
      const rows: string[][] = [cells(line)];
      i += 2;
      while (i < lines.length && lines[i].includes("|")) rows.push(cells(lines[i++]));
      blocks.push(<Table key={blocks.length} rows={rows} k={String(blocks.length)} />);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = level === 1 ? "text-base" : level === 2 ? "text-sm" : "text-xs";
      const body = inline(heading[2], `h${blocks.length}`);
      if (document) {
        // The page's own <h1> is its title and the doc's `#` is stripped before
        // it gets here, so `##` is the top level on the page and must be <h2>:
        // mapping it to <h3> would skip a level, which is exactly what screen
        // reader navigation reads as a missing section.
        const Tag = (["h2", "h2", "h3", "h4", "h5", "h6"] as const)[level - 1];
        const id = heading[2]
          .toLowerCase()
          .replace(/`/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        blocks.push(
          <Tag
            key={blocks.length}
            id={id || undefined}
            className={`mt-5 mb-1 scroll-mt-4 font-semibold text-fg ${
              level <= 2 ? "text-sm" : "text-xs"
            }`}
          >
            {body}
          </Tag>,
        );
      } else {
        blocks.push(
          <p key={blocks.length} className={`mt-3 mb-1 font-semibold text-fg ${size}`}>
            {body}
          </p>,
        );
      }
      i++;
      continue;
    }

    // list, bulleted or numbered
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={blocks.length}
          className={`my-1.5 space-y-0.5 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item, n) => (
            <li key={n}>{inline(item, `l${blocks.length}-${n}`)}</li>
          ))}
        </List>,
      );
      continue;
    }

    if (line.startsWith(">")) {
      blocks.push(
        <blockquote key={blocks.length} className="my-2 border-l-2 border-line-strong pl-3 text-fg-tertiary">
          {inline(line.replace(/^>\s?/, ""), `q${blocks.length}`)}
        </blockquote>,
      );
      i++;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // paragraph — consume until a blank line or the start of another block
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|>|\s*([-*+]|\d+\.)\s)/.test(lines[i]) &&
      !lines[i].trimStart().startsWith("```")
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={blocks.length} className="my-1.5 leading-relaxed">
        {inline(para.join(" "), `p${blocks.length}`)}
      </p>,
    );
  }

  return <div className={className}>{blocks}</div>;
}
