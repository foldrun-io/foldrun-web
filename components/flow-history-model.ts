// The flow history drawer's model: a line diff the browser can compute on
// its own (for "Compare with current", which no revision on the server
// holds), and the folding that turns a diff of a 200-line flow into the
// handful of rows a person actually reads.
//
// The server's diff (core history.ts diffLines) has the same op shape; both
// feed foldDiff, so a revision's diff and a comparison render one way.

export type DiffOp = { kind: "same" | "add" | "del"; text: string };

/** One row of the rendered diff: a line with its number on each side, or a
 *  fold standing in for `count` unchanged lines. */
export type DiffRow =
  | { kind: "same" | "add" | "del"; text: string; oldNo: number | null; newNo: number | null }
  | { kind: "gap"; count: number };

const splitLines = (s: string) => (s === "" ? [] : s.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"));

/**
 * Lines of `before` → lines of `after`, as keep/add/delete operations.
 * LCS over the lines between a shared head and tail — flows are small (a few
 * hundred lines at most), and the table is capped so a pasted megabyte
 * degrades to "replace everything" rather than hanging the tab.
 */
export function lineDiff(before: string, after: string): DiffOp[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const ops: DiffOp[] = a.slice(0, head).map((text) => ({ kind: "same", text }));

  if (midA.length * midB.length > 4_000_000) {
    ops.push(...midA.map((text) => ({ kind: "del" as const, text })), ...midB.map((text) => ({ kind: "add" as const, text })));
  } else {
    // lcs[i][j]: the longest common subsequence of midA[i..] and midB[j..].
    const n = midA.length;
    const m = midB.length;
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ kind: "same", text: midA[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        ops.push({ kind: "del", text: midA[i++] });
      } else {
        ops.push({ kind: "add", text: midB[j++] });
      }
    }
    while (i < n) ops.push({ kind: "del", text: midA[i++] });
    while (j < m) ops.push({ kind: "add", text: midB[j++] });
  }
  ops.push(...a.slice(a.length - tail).map((text) => ({ kind: "same" as const, text })));
  return ops;
}

/**
 * Number the lines and fold long unchanged stretches, keeping `context`
 * lines either side of every change. A fold of a single line is not worth
 * its own row, so it is shown instead. No changes at all → no rows.
 */
export function foldDiff(ops: DiffOp[], context = 3): DiffRow[] {
  const numbered: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const op of ops) {
    if (op.kind === "same") numbered.push({ ...op, oldNo: ++oldNo, newNo: ++newNo });
    else if (op.kind === "del") numbered.push({ ...op, oldNo: ++oldNo, newNo: null });
    else numbered.push({ ...op, oldNo: null, newNo: ++newNo });
  }
  if (!numbered.some((r) => r.kind !== "same")) return [];
  const keep = numbered.map(() => false);
  numbered.forEach((r, i) => {
    if (r.kind === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(numbered.length - 1, i + context); k++) keep[k] = true;
  });
  const rows: DiffRow[] = [];
  for (let i = 0; i < numbered.length; ) {
    if (keep[i]) {
      rows.push(numbered[i++]);
      continue;
    }
    let j = i;
    while (j < numbered.length && !keep[j]) j++;
    if (j - i === 1) rows.push(numbered[i]);
    else rows.push({ kind: "gap", count: j - i });
    i = j;
  }
  return rows;
}

/** "+3 −1" — what a revision did, in the list beside its message. */
export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === "add") added++;
    else if (op.kind === "del") removed++;
  }
  return { added, removed };
}

/** The message a restore leaves on its revision. */
export function restoreMessage(rev: { id: string; commit: string | null }): string {
  return `restored ${rev.commit ? rev.commit.slice(0, 7) : rev.id} from history`;
}
