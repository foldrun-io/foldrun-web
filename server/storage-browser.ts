// What the storage browser shows, read on the server: each desk's files and
// which of them have a live public link. One reader for the account page
// and a desk's own page, so the two can never disagree about a file again.

import { listStorage } from "@/lib/storage";
import { listShares, isLive, shareUrl } from "@/platform/shares";
import { publicUrl } from "@/lib/webhook";
import type { BrowserDesk, BrowserShare } from "@/components/file-browser-model";

export async function browserDesks(tenant: string, workspaces: string[]): Promise<{ desks: BrowserDesk[]; canShare: boolean }> {
  const canShare = Boolean(publicUrl());
  const desks: BrowserDesk[] = [];
  for (const workspace of workspaces) {
    const files = listStorage(tenant, workspace);
    const shared = new Map<string, BrowserShare>();
    if (canShare && files.length) {
      for (const s of await listShares(tenant, workspace)) {
        if (!isLive(s) || !s.path.startsWith("storage/")) continue;
        const rel = s.path.slice("storage/".length);
        const prev = shared.get(rel);
        // The link that lasts longest is the one to show.
        if (!prev || (s.expiresAt ?? "9999") > (prev.expiresAt ?? "9999")) shared.set(rel, { token: s.token, url: shareUrl(s.token), expiresAt: s.expiresAt });
      }
    }
    desks.push({
      workspace,
      files: files.map((r) => ({ workspace, path: r.path, size: r.size, mime: r.mime, updatedAt: r.updatedAt, by: r.by, share: shared.get(r.path) ?? null })),
    });
  }
  return { desks, canShare };
}
