// The API reference, rendered from the same OpenAPI document /api/openapi.json
// serves (server/openapi.ts). No viewer library: a list of operations by
// tag, each with its description and, where the spec has one, its request
// and response schema.

import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { openapiDocument } from "@/server/openapi";

export const dynamic = "force-static";

type Op = {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: { $ref?: string; name?: string; in?: string }[];
  requestBody?: { content: Record<string, { schema: unknown }> };
  responses?: Record<string, { content?: Record<string, { schema: unknown }> }>;
};

const METHOD_TONE: Record<string, string> = {
  get: "bg-blue-50 text-blue-700",
  post: "bg-green-50 text-green-700",
  put: "bg-amber-50 text-amber-700",
  patch: "bg-amber-50 text-amber-700",
  delete: "bg-red-50 text-red-700",
};

const GENERIC_DESC = "JSON — see docs/api.md for this route's fields";

export default function ApiReference() {
  const doc = openapiDocument() as { info: { version: string; description: string }; paths: Record<string, Record<string, Op>> };
  const byTag = new Map<string, { path: string; method: string; op: Op }[]>();
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const tag = op.tags?.[0] ?? "api";
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push({ path: p, method, op });
    }
  }
  const tags = [...byTag.keys()].sort();

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Link href="/dashboard/docs" className="text-sm text-fg-muted hover:text-fg">
        ← Docs
      </Link>
      <PageHeader
        title="API reference"
        subtitle={
          <>
            Version <span className="font-mono">{doc.info.version}</span> · every route, from{" "}
            <a href="/api/openapi.json" className="text-accent hover:underline">
              /api/openapi.json
            </a>{" "}
            · <Link href="/dashboard/docs/api-usage" className="text-accent hover:underline">Using the API</Link>
          </>
        }
      />
      <nav className="mb-6 flex flex-wrap gap-2 text-xs">
        {tags.map((t) => (
          <a key={t} href={`#tag-${t}`} className="rounded border border-line px-2 py-0.5 text-fg-tertiary hover:bg-sunken">
            {t}
          </a>
        ))}
      </nav>
      <div className="space-y-6">
        {tags.map((t) => (
          <Card key={t} id={`tag-${t}`} className="scroll-mt-20 p-5">
            <h2 className="mb-3 text-sm font-semibold text-fg">{t}</h2>
            <ul className="divide-y divide-line-faint">
              {byTag.get(t)!.map(({ path, method, op }) => {
                const body = op.requestBody?.content?.["application/json"]?.schema;
                const ok = op.responses?.["200"]?.content?.["application/json"]?.schema as { description?: string } | undefined;
                const idem = op.parameters?.some((p) => p.$ref?.endsWith("/IdempotencyKey"));
                return (
                  <li key={`${method} ${path}`} id={`${method}-${path}`} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${METHOD_TONE[method] ?? "bg-sunken text-fg-secondary"}`}>{method}</span>
                      <code className="break-all font-mono text-xs text-fg">{path}</code>
                      {op.security && op.security.length === 0 && <span className="text-[10px] uppercase tracking-wide text-fg-subtle">no key</span>}
                      {idem && <span className="text-[10px] uppercase tracking-wide text-fg-subtle">idempotency-key</span>}
                    </div>
                    {op.description && <p className="mt-1 text-xs text-fg-tertiary">{op.description}</p>}
                    {(body || (ok && ok.description !== GENERIC_DESC)) && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-fg-muted">Schema</summary>
                        {body ? (
                          <>
                            <p className="mt-2 text-[10px] uppercase tracking-wide text-fg-subtle">Request body</p>
                            <pre className="mt-1 overflow-x-auto rounded bg-sunken p-2 font-mono text-[11px] text-fg-secondary">{JSON.stringify(body, null, 2)}</pre>
                          </>
                        ) : null}
                        {ok && ok.description !== GENERIC_DESC ? (
                          <>
                            <p className="mt-2 text-[10px] uppercase tracking-wide text-fg-subtle">200 response</p>
                            <pre className="mt-1 overflow-x-auto rounded bg-sunken p-2 font-mono text-[11px] text-fg-secondary">{JSON.stringify(ok, null, 2)}</pre>
                          </>
                        ) : null}
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </main>
  );
}
