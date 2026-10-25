// One write to PATCH/DELETE /api/workspaces/<ws>/flows/<flow> from the
// list-view board or the step options editor. Their bodies name steps by
// index, so each carries `expect` — the text those indices were read from —
// and the route refuses it (409) when the file has moved on (another tab,
// the canvas, the editor, a deploy) instead of editing whichever step has
// that index now. The canvas does the same through its own `send`.

export const STALE_FLOW = "this flow changed since you opened it — reload";

export type FlowWriteResult =
  | { ok: true; before?: string; text?: string }
  | { ok: false; stale: boolean; error: string };

export async function flowWrite({
  url,
  method,
  tenant,
  body,
  expect,
  fetch: f = fetch,
}: {
  url: string;
  method: "PATCH" | "DELETE";
  tenant?: string;
  body: Record<string, unknown>;
  /** The text the caller's step indices were read from; left out, the write is unconditional. */
  expect?: string;
  fetch?: typeof fetch;
}): Promise<FlowWriteResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tenant) headers["x-foldrun-tenant"] = tenant;
  const res = await f(url, {
    method,
    headers,
    body: JSON.stringify(typeof expect === "string" ? { ...body, expect } : body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: unknown; before?: unknown; text?: unknown };
  if (res.status === 409) return { ok: false, stale: true, error: STALE_FLOW };
  if (!res.ok) return { ok: false, stale: false, error: typeof data.error === "string" ? data.error : `${res.status}` };
  return {
    ok: true,
    before: typeof data.before === "string" ? data.before : undefined,
    text: typeof data.text === "string" ? data.text : undefined,
  };
}
