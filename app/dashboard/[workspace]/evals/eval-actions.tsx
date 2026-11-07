"use client";

// The small controls of the Evals pages: a row's Run, an eval's "…" menu
// (open its file, delete it), and the old in-page anchors (#eval-<name>,
// from a run's grades and the inbox) turned into the eval's own view.

import Link from "@/components/kit/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/kit/button";
import { Tooltip } from "@/components/kit/tooltip";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/kit/menu";
import { useConfirm } from "@/components/kit/confirm";
import { useCan } from "@/components/role";
import { anchorId } from "@/components/collapse-model";
import { runEval } from "./run-eval";

/** Run from the list: busy until the verdict is in, then the row refreshes. */
export function EvalRunButton({ workspace, tenant, name }: { workspace: string; tenant: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <Tooltip label={error}>
          <span className="max-w-48 truncate text-xs text-danger">
            {error}
          </span>
        </Tooltip>
      )}
      <Tooltip label={busy ? "Each case starts a real run, so this takes as long as the agent does." : undefined}>
        <span className="inline-flex">
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await runEval(workspace, tenant, name);
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Running…" : "Run"}
          </Button>
        </span>
      </Tooltip>
    </span>
  );
}

/** An eval's "…": its file in the editor, and Delete (writers only). */
export function EvalMenu({
  workspace,
  tenant,
  file,
  confirmText,
  listHref,
}: {
  workspace: string;
  tenant: string;
  file: string;
  confirmText: string;
  listHref: string;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const mayWrite = useCan("workspace:write");
  const [error, setError] = useState<string | null>(null);
  const t = tenant !== "default" ? `&tenant=${tenant}` : "";
  const remove = async () => {
    if (!(await confirm({ title: confirmText, confirmLabel: "Delete" }))) return;
    const res = await fetch(`/api/workspaces/${workspace}/source`, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ path: `evals/${file}` }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `${res.status}`);
      return;
    }
    router.push(listHref);
    router.refresh();
  };
  return (
    <>
      {confirmDialog}
      {error && <span className="text-xs text-danger">{error}</span>}
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" size="icon-sm" aria-label="More">
            <Ellipsis />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem asChild>
            <Link href={`/dashboard/${workspace}/edit?path=${encodeURIComponent(`evals/${file}`)}${t}`}>
              <FileText /> Open in Files
            </Link>
          </MenuItem>
          {mayWrite && (
            <>
              <MenuSeparator />
              <MenuItem tone="danger" onSelect={() => void remove()}>
                <Trash2 /> Delete
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
    </>
  );
}

/** A link written before evals had their own view (`/evals#eval-<name>`,
 *  `#<proposal id>`) opens that eval's view instead of the list's top. */
export function EvalAnchor({ names, proposals, tenant }: { names: string[]; proposals: { id: string; eval: string }[]; tenant: string }) {
  const router = useRouter();
  useEffect(() => {
    let hash = window.location.hash.slice(1);
    try {
      hash = decodeURIComponent(hash);
    } catch {
      /* a hash that is not encoding stays as written */
    }
    if (!hash) return;
    const name = names.find((n) => anchorId("eval", n) === hash) ?? proposals.find((p) => p.id === hash)?.eval;
    if (!name) return;
    const t = tenant !== "default" ? `&tenant=${tenant}` : "";
    const keep = proposals.some((p) => p.id === hash) ? `#${hash}` : "";
    router.replace(`${window.location.pathname}?eval=${encodeURIComponent(name)}${t}${keep}`);
  }, [names, proposals, tenant, router]);
  return null;
}
