import { $t } from "@/i18n";
// Putting a file into a desk's storage from the browser. One path for the
// desk page's drop zone and the storage browser's upload buttons: hash the
// file, ask for a presigned PUT, send the bytes straight to the bucket, then
// tell the platform the file exists — or, where there is no bucket (the fs
// driver answers url: null), send the bytes to the platform itself. The hash
// is the key, so the same document uploaded twice is stored once.

export async function sha256Of(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Upload one file as `rel` under the desk's storage/. Throws with the
 *  platform's own words when it refuses. */
export async function uploadFile(workspace: string, tenant: string, file: File, rel = file.name): Promise<void> {
  const headers = { "x-foldrun-tenant": tenant };
  const base = `/v1/workspaces/${encodeURIComponent(workspace)}/storage`;
  const said = async (r: Response, fallback: string) => {
    try { return (await r.json()).error ?? fallback; } catch { return fallback; }
  };
  if (file.size === 0) throw new Error($t("components.upload.isEmptyThePlatformKeepsNo", { name: String(file.name) }));
  const sha = await sha256Of(file);
  const ask = await fetch(`${base}/upload-url`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ path: rel, sha, size: file.size }) });
  if (!ask.ok) throw new Error(await said(ask, $t("components.upload.thePlatformRefused", { rel: String(rel), status: String(ask.status) })));
  const { url } = (await ask.json()) as { url: string | null };
  if (url) {
    const put = await fetch(url, { method: "PUT", body: file });
    if (!put.ok) throw new Error($t("components.upload.theStorageServiceRefused", { rel: String(rel), status: String(put.status) }));
    const done = await fetch(base, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ path: rel, sha, size: file.size }) });
    if (!done.ok) throw new Error(await said(done, $t("components.upload.couldNotRecord", { rel: String(rel) })));
  } else {
    const put = await fetch(`${base}?path=${encodeURIComponent(rel)}`, { method: "PUT", headers, body: file });
    if (!put.ok) throw new Error(await said(put, $t("components.upload.uploadOfFailed", { rel: String(rel), status: String(put.status) })));
  }
}

/** Where a dropped or chosen file lands: its name, or its path inside a
 *  dropped folder (webkitRelativePath) so a folder keeps its shape. */
export const relFor = (file: File, prefix = "") => {
  const inner = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return `${prefix ? `${prefix.replace(/\/+$/, "")}/` : ""}${inner}`;
};
