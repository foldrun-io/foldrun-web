// The API reference, rendered from the same OpenAPI document /api/openapi.json
// serves (server/openapi.ts). No viewer library: a list of operations by
// tag, each with its description and, where the spec has one, its request
// and response schema.

import Link from "@foldrun/ui/react/link";
import { Chip, Page, PageHeader, Panel, Tag } from "@foldrun/ui/react/page";
import { openapiDocument } from "@/server/openapi";
import { Disclosure } from "@foldrun/ui/react/disclosure";

// Per request, not prerendered (28 Oct 2026): the enforced CSP's nonce is
// minted per request, and a static page cannot carry one. The markdown ships
// in the image beside the app for this (foldrun-infra Dockerfile).
export const dynamic = "force-dynamic";

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
  get: "bg-info-soft text-info",
  post: "bg-success-soft text-success",
  put: "bg-warning-soft text-warning",
  patch: "bg-warning-soft text-warning",
  delete: "bg-danger-soft text-danger",
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
    <Page className="pb-16">
      <PageHeader
        back={{ href: "/dashboard/docs", label: "Docs" }}
        title="API reference"
        description={
          <>
            Version <span className="font-mono">{doc.info.version}</span> · every route, from{" "}
            <a href="/api/openapi.json" className="text-link hover:underline">
              /api/openapi.json
            </a>{" "}
            · <Link href="/dashboard/docs/api-usage" className="text-link hover:underline">
              Using the API
            </Link>
          </>
        }
      />
      <nav aria-label="Tags" className="mb-8 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <a key={t} href={`#tag-${t}`} className="group rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <Chip className="h-7 px-2.5 font-normal text-fg-secondary transition-colors group-hover:border-line-strong group-hover:text-fg">{t}</Chip>
          </a>
        ))}
      </nav>
      <div className="space-y-8">
        {tags.map((t) => (
          <Panel key={t} id={`tag-${t}`} title={t} flush>
            <ul className="divide-y divide-line">
              {byTag.get(t)!.map(({ path, method, op }) => {
                const body = op.requestBody?.content?.["application/json"]?.schema;
                const ok = op.responses?.["200"]?.content?.["application/json"]?.schema as { description?: string } | undefined;
                const idem = op.parameters?.some((p) => p.$ref?.endsWith("/IdempotencyKey"));
                return (
                  <li key={`${method} ${path}`} id={`${method}-${path}`} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag mono className={`h-5 border-transparent px-1.5 font-semibold uppercase ${METHOD_TONE[method] ?? ""}`}>{method}</Tag>
                      <code className="break-all font-mono text-xs text-fg">{path}</code>
                      {op.security && op.security.length === 0 && <Chip className="h-5">no key</Chip>}
                      {idem && <Chip className="h-5">idempotency-key</Chip>}
                    </div>
                    {op.description && <p className="mt-1 text-sm text-fg-muted">{op.description}</p>}
                    {(body || (ok && ok.description !== GENERIC_DESC)) && (
                      <Disclosure className="mt-2 text-xs" summaryClassName="text-fg-muted" summary="Schema">
                        {body ? (
                          <>
                            <p className="mt-2 text-xs font-medium text-fg-secondary">Request body</p>
                            <pre className="mt-1 overflow-x-auto rounded-md border border-line bg-sunken p-2 font-mono text-xs text-fg-secondary">{JSON.stringify(body, null, 2)}</pre>
                          </>
                        ) : null}
                        {ok && ok.description !== GENERIC_DESC ? (
                          <>
                            <p className="mt-2 text-xs font-medium text-fg-secondary">200 response</p>
                            <pre className="mt-1 overflow-x-auto rounded-md border border-line bg-sunken p-2 font-mono text-xs text-fg-secondary">{JSON.stringify(ok, null, 2)}</pre>
                          </>
                        ) : null}
                      </Disclosure>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
      </div>
    </Page>
  );
}
