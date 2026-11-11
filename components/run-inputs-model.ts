// Picking the files a run is handed (FOL-163): storage paths, filtered by
// what is typed, at most 20 and 100 MiB together — the limits core
// run-inputs.ts holds a run to, said here before the route refuses.

export const PICK_LIMITS = { files: 20, totalBytes: 100 * 1024 * 1024 } as const;

export interface StoredFile {
  path: string;
  size: number;
}

/** The files a filter matches: every word, any order, in the path. */
export function matchFiles(files: StoredFile[], filter: string): StoredFile[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  return files.filter((f) => words.every((w) => f.path.toLowerCase().includes(w)));
}

/** Why the picked set would be refused, or null. */
export function pickProblem(picked: string[], files: StoredFile[]): string | null {
  if (picked.length > PICK_LIMITS.files) return `At most ${PICK_LIMITS.files} files on one run.`;
  const total = picked.reduce((n, p) => n + (files.find((f) => f.path === p)?.size ?? 0), 0);
  if (total > PICK_LIMITS.totalBytes) return `${(total / 1048576).toFixed(1)} MiB picked — at most 100 MiB on one run.`;
  return null;
}

export function fileSize(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : n >= 1024 ? `${Math.round(n / 1024)} KiB` : `${n} B`;
}
