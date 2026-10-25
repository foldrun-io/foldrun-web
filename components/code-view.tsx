// A read-only block of text with line numbers — a record, a preview, a
// file that is shown rather than edited. JSON and JSONL are pretty-printed
// first: the revision store writes one line per record, which is right for
// a machine and a wall for a person.

export function prettyText(path: string, text: string): string {
  if (/\.json$/i.test(path)) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  if (/\.jsonl$/i.test(path)) {
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.stringify(JSON.parse(l), null, 2);
        } catch {
          return l;
        }
      })
      .join("\n\n");
  }
  return text;
}

export function CodeView({ path, text, maxLines = 4000 }: { path: string; text: string; maxLines?: number }) {
  const pretty = prettyText(path, text);
  const lines = pretty.split("\n");
  const shown = lines.slice(0, maxLines);
  return (
    <div className="overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full border-collapse font-mono text-xs leading-relaxed">
        <tbody>
          {shown.map((l, i) => (
            <tr key={i}>
              <td className="select-none border-r border-line-faint bg-sunken px-3 text-right text-gray-300">{i + 1}</td>
              <td className="whitespace-pre px-3 text-gray-800">{l || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lines.length > maxLines && (
        <p className="border-t border-line-faint px-3 py-2 text-xs text-fg-subtle">
          {lines.length - maxLines} more lines not shown.
        </p>
      )}
    </div>
  );
}
