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
  const base = `/api/workspaces/${encodeURIComponent(workspace)}/storage`;
  const said = async (r: Response, fallback: string) => {
    try { return (await r.json()).error ?? fallback; } catch { return fallback; }
  };
  if (file.size === 0) throw new Error(`${file.name} is empty — the platform keeps no empty files`);
  const sha = await sha256Of(file);
  const ask = await fetch(`${base}/upload-url`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ path: rel, sha }) });
  if (!ask.ok) throw new Error(await said(ask, `the platform refused ${rel} (${ask.status})`));
  const { url } = (await ask.json()) as { url: string | null };
  if (url) {
    const put = await fetch(url, { method: "PUT", body: file });
    if (!put.ok) throw new Error(`the storage service refused ${rel} (${put.status})`);
    const done = await fetch(base, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ path: rel, sha, size: file.size }) });
    if (!done.ok) throw new Error(await said(done, `could not record ${rel}`));
  } else {
    const put = await fetch(`${base}?path=${encodeURIComponent(rel)}`, { method: "PUT", headers, body: file });
    if (!put.ok) throw new Error(await said(put, `upload of ${rel} failed (${put.status})`));
  }
}

/** Where a dropped or chosen file lands: its name, or its path inside a
 *  dropped folder (webkitRelativePath) so a folder keeps its shape. */
export const relFor = (file: File, prefix = "") => {
  const inner = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return `${prefix ? `${prefix.replace(/\/+$/, "")}/` : ""}${inner}`;
};
