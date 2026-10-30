// The active-links list's rules, apart from React: which public links are
// still live, how each one reads, and who made it — the same facts `foldrun
// storage shares` prints, shown on a desk's Storage page so a link can be
// found and taken down without the CLI.

export interface ShareRow {
  /** The handle the list revokes by — a hash of the token, never the link. */
  id: string;
  /** The token, or a masked stub of it ("abcd…") when this viewer is neither
   *  an admin nor the link's maker (30 Oct 2026). */
  token: string;
  /** Workspace-relative, POSIX-separated, e.g. `storage/report.pdf`. */
  path: string;
  createdAt: string;
  /** Who minted it: an email, an API key's name, or null (shown "api-key"). */
  createdBy: string | null;
  /** ISO timestamp, or null for a link that never expires. */
  expiresAt: string | null;
  /** ISO once taken down, else null. */
  revokedAt: string | null;
  /** The public link, built on the server from FOLDRUN_PUBLIC_URL (never the
   *  browser's own origin, which can be localhost or an internal host). Null
   *  when the install has no public address, or the token is masked: listed,
   *  revocable, not copyable. */
  url: string | null;
}

/** Live = not revoked and not past its expiry — the CLI's own rule. */
export function isLiveShare(s: ShareRow, now: number): boolean {
  if (s.revokedAt) return false;
  if (s.expiresAt && Date.parse(s.expiresAt) <= now) return false;
  return true;
}

/** A bare span, no "ago": "5s", "5m", "3h", "2d", "4w", "7mo". */
function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${Math.max(1, s)}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.round(d / 7)}w`;
  return `${Math.round(d / 30)}mo`;
}

/** How a link reads on the row: live and for how long, or why it is gone —
 *  the same four states the CLI prints (never expires / expires / expired /
 *  revoked), relative so the row needs no locale. */
export function shareStatus(s: ShareRow, now: number): { live: boolean; label: string } {
  if (s.revokedAt) return { live: false, label: `revoked ${span(now - Date.parse(s.revokedAt))} ago` };
  if (s.expiresAt && Date.parse(s.expiresAt) <= now) return { live: false, label: `expired ${span(now - Date.parse(s.expiresAt))} ago` };
  if (s.expiresAt) return { live: true, label: `expires in ${span(Date.parse(s.expiresAt) - now)}` };
  return { live: true, label: "never expires" };
}

/** Who minted it, for a person — "api-key" when nothing was recorded, the
 *  same fallback the CLI prints. */
export function shareWho(createdBy: string | null): string {
  return createdBy ?? "api-key";
}

/** The links to show: live ones by default, everything (expired, revoked)
 *  when `all`, newest first. Mirrors `foldrun storage shares [--all]`. */
export function visibleShares(rows: ShareRow[], now: number, all: boolean): ShareRow[] {
  return rows
    .filter((r) => all || isLiveShare(r, now))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
