// What the storage browser shows, read on the server: each desk's files and
// which of them have a live public link. One reader for the account page
// and a desk's own page, so the two can never disagree about a file again.

import { listStorage } from "@/lib/storage";
import { listShares, isLive, shareUrl, shareId, readerSeesToken, type ShareReader } from "@/platform/shares";
import { publicUrl } from "@/lib/webhook";
import { can } from "@/platform/permissions";
import { viewerEmail, viewerRole } from "@/server/users";
import type { BrowserDesk, BrowserShare } from "@/components/file-browser-model";

/**
 * Who is reading the page, as the share list judges it (30 Oct 2026): an
 * admin, or a link's own maker, is handed its token and URL; anyone else
 * sees that the file is shared and can revoke it by id, never copy it.
 * Nobody signed in is dev mode, which every page treats as the owner.
 */
export async function dashboardShareReader(): Promise<ShareReader> {
  const role = await viewerRole();
  if (role === null) return { admin: true, name: null };
  return { admin: can(role, "workspace:manage"), name: await viewerEmail() };
}

export async function browserDesks(tenant: string, workspaces: string[], reader: ShareReader): Promise<{ desks: BrowserDesk[]; canShare: boolean }> {
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
        if (!prev || (s.expiresAt ?? "9999") > (prev.expiresAt ?? "9999")) {
          const sees = readerSeesToken(s, reader);
          shared.set(rel, { id: shareId(s.token), token: sees ? s.token : null, url: sees ? shareUrl(s.token) : null, expiresAt: s.expiresAt });
        }
      }
    }
    desks.push({
      workspace,
      files: files.map((r) => ({ workspace, path: r.path, size: r.size, mime: r.mime, updatedAt: r.updatedAt, by: r.by, share: shared.get(r.path) ?? null })),
    });
  }
  return { desks, canShare };
}
