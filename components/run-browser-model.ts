// What the run page does with a browser's pictures — pure, so tests reach it.

/** How an archived output shows inline: a recording plays, a picture shows,
 *  anything else stays a link. */
export function mediaKind(path: string): "video" | "image" | null {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "webm" || ext === "mp4") return "video";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  return null;
}

/** Recordings first — they are the reason to open the step — then pictures,
 *  each list in the order the agent wrote them. */
export function mediaFiles<T extends { path: string }>(files: T[]): T[] {
  const kind = (f: T) => mediaKind(f.path);
  return [...files.filter((f) => kind(f) === "video"), ...files.filter((f) => kind(f) === "image")];
}

/** "3s ago", "2 min ago" — how stale the picture on screen is. */
export function frameAge(atIso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(atIso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m} min ago`;
}

/** How often the page asks for a new frame while the step runs. The tool
 *  sends at most three a second, and only when the page changes. */
export const LIVE_POLL_MS = 700;

/** A recording's label from the name web's browse action gives it,
 *  `outputs/video/<yyyymmdd>-<hhmmssmmm>-<host>.webm`: the site and the
 *  moment it started. Older and explicit names keep their own name. */
export function recordingLabel(path: string): { site: string; at: Date | null } {
  const base = path.split("/").pop() ?? path;
  const m = base.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\d{3})-(.+)\.(webm|mp4)$/);
  if (!m) return { site: base.replace(/\.(webm|mp4)$/i, ""), at: null };
  const at = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]));
  return { site: m[8], at };
}

/** How many live frames the page keeps to rewind through: about a minute
 *  at the tool's pace, a few megabytes. */
export const REWIND_FRAMES = 90;
