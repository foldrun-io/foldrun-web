"use client";

// "Publish over A2A" on a flow card (1 Nov 2026): whether outside agents with
// an A2A key may call this flow, and what its agent card says. It edits the
// flow's `a2a:` through PATCH /api/workspaces/<ws>/flows/<f> { a2a } — the
// same file everything else edits — and shows where the card is served, with
// a curl to try it. Publishing is an admin's (workspace:manage); the server
// refuses anyone else, and the control says so before they try.
//
// FOL-112: an agent of the flow that holds a secret and can run code is
// named here before the first publish — its answer goes back to the caller,
// who can ask for the secret in it — and the flow is not published (nor
// served new tasks) until an admin ticks "accept" for it, which writes
// `a2a: accept_risk: [<agent>]`.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, labelClass } from "@/components/kit/input";
import { cn } from "@/components/kit/cn";
import { buttonVariants } from "@/components/kit/button";
import { Globe } from "lucide-react";
import { CopyField } from "@/components/copy-field";
import { useCan } from "@/components/role";
import { a2aBodyOf, a2aCurl, a2aFormOf, a2aRiskState, type A2aForm, type A2aRisk } from "@/components/a2a-model";
import { Callout } from "@/components/kit/page";
import { Switch, Checkbox } from "@/components/kit/choice";
import { Tooltip } from "@/components/kit/tooltip";

interface Published {
  publish: boolean;
  name: string | null;
  description: string | null;
  examples: string[];
  publicCard: boolean;
  input?: unknown;
  acceptRisk?: string[];
}

interface Where {
  card: string;
  url: string;
}

export function A2aPublish({ workspace, tenant, flow, initial }: { workspace: string; tenant: string; flow: string; initial: Published | null }) {
  const router = useRouter();
  const mayManage = useCan("workspace:manage");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<A2aForm>(a2aFormOf(initial));
  const [saved, setSaved] = useState<A2aForm>(a2aFormOf(initial));
  const [where, setWhere] = useState<Where | null>(null);
  const [risks, setRisks] = useState<A2aRisk[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headers: Record<string, string> = { "content-type": "application/json", ...(tenant !== "default" ? { "x-foldrun-tenant": tenant } : {}) };

  // Where the card is served — the server's answer, from the install's own
  // address (never this browser's), read when the panel opens.
  async function locate() {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/a2a`, { headers }).catch(() => null);
    const d = res && res.ok ? ((await res.json().catch(() => null)) as { flows?: { flow: string; card: string; url: string }[]; risks?: A2aRisk[] } | null) : null;
    const hit = d?.flows?.find((f) => f.flow === flow);
    setWhere(hit ? { card: hit.card, url: hit.url } : null);
    setRisks(Array.isArray(d?.risks) ? d.risks : []);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flow)}`, { method: "PATCH", headers, body: JSON.stringify({ a2a: a2aBodyOf(form) }) });
      const d = (await res.json().catch(() => ({}))) as { error?: string; flow?: { a2a?: Published | null } };
      if (!res.ok) throw new Error(d.error ?? `${res.status}`);
      const next = a2aFormOf(d.flow?.a2a ?? null);
      setForm(next);
      setSaved(next);
      await locate();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof A2aForm>(k: K, v: A2aForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const risk = a2aRiskState(flow, risks, form);
  const accept = (agent: string, on: boolean) => set("acceptRisk", on ? [...new Set([...form.acceptRisk, agent])].sort() : form.acceptRisk.filter((a) => a !== agent));

  if (!open) {
    return (
      <Tooltip label={initial?.publish ? "Published over A2A — outside agents with an A2A key naming this flow may call it" : "Let outside agents call this flow over A2A"}>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            void locate();
          }}
          className={buttonVariants({ variant: "secondary" })}
        >
          <Globe aria-hidden />
          {initial?.publish ? "Change publishing" : "Publish over A2A…"}
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="w-full rounded-lg border border-line bg-sunken p-4">
      <p className="text-xs text-fg-muted">
        A published flow can be called by an outside agent over A2A 1.0 — only with an A2A key that names it (Settings → API keys). A person still approves every gate.
        {!mayManage && <span className="ml-1 font-medium text-fg-secondary">Publishing needs the admin role.</span>}
      </p>
      <fieldset disabled={!mayManage || busy} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-fg-secondary sm:col-span-2">
          <Switch checked={form.publish} onCheckedChange={(checked: boolean) => set("publish", checked)} />
          Published — outside agents with an A2A key may call it
        </label>
        <label>
          <span className={labelClass}>Card name</span>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={flow} maxLength={100} className="w-full" />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-fg-secondary">
          <Switch checked={form.publicCard} onCheckedChange={(checked: boolean) => set("publicCard", checked)} />
          Public card — readable without a key (calling it never is)
        </label>
        <label className="sm:col-span-2">
          <span className={labelClass}>Description</span>
          <Textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="What this agent does, for the agents that call it. Written for strangers: no internal names, no secrets."
            className="w-full"
          />
        </label>
        <label className="sm:col-span-2">
          <span className={labelClass}>Example requests — one per line</span>
          <Textarea value={form.examples} onChange={(e) => set("examples", e.target.value)} rows={2} className="w-full font-mono text-xs" />
        </label>
      </fieldset>
      {risk.items.length > 0 && (
        <Callout tone="warning" className="mt-3 p-3 text-xs text-fg-secondary" role="alert">
          <p className="font-medium text-warning">The answer goes back to the caller</p>
          <p className="mt-1">
            {risk.items.length === 1 ? "This agent holds" : "These agents hold"} a secret and can run code (Bash), so a caller can ask for the secret in the answer. Take Bash or the secret away
            from {risk.items.length === 1 ? "it" : "them"} (or bind the secret to its sites), or accept the risk — until then the flow is not published and takes no new tasks.
          </p>
          <ul className="mt-2 space-y-1">
            {risk.items.map((r) => (
              <li key={r.agent}>
                <label className="flex items-center gap-2">
                  <Checkbox checked={r.accepted} disabled={!mayManage || busy} onCheckedChange={(checked: boolean) => accept(r.agent, checked)} />
                  <span>
                    Accept for <span className="font-mono">{r.agent}</span> — holds <span className="font-mono">{r.secrets.slice(0, 3).join(", ")}{r.secrets.length > 3 ? ", …" : ""}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-fg-subtle">Written as a2a: accept_risk in the flow and in the audit log.</p>
        </Callout>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Tooltip label={!mayManage ? "Publishing a flow needs the admin role (workspace:manage)" : risk.blocks ? "Accept the risk for each agent above, or take Bash or the secret away from it" : undefined}>
          <span className="inline-flex">
            <button
              type="button"
              onClick={save}
              disabled={!mayManage || busy || !dirty || risk.blocks}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </span>
        </Tooltip>
        <button type="button" onClick={() => { setForm(saved); setError(null); setOpen(false); }} className={buttonVariants({ variant: "ghost", size: "md" })}>
          Close
        </button>
        {error && <span role="alert" className="text-xs text-danger">{error}</span>}
        <span className="ml-auto text-xs text-fg-subtle">a2a: in the flow</span>
      </div>
      {where && saved.publish && (
        <div className="mt-3 space-y-2 border-t border-line-faint pt-3">
          <div>
            <span className={labelClass}>Agent card</span>
            <CopyField value={where.card} className="mt-1" />
          </div>
          <div>
            <span className={labelClass}>Try it — with an A2A key in $FOLDRUN_A2A_KEY</span>
            <CopyBlock text={a2aCurl(where.url, { text: saved.examples.split("\n")[0]?.trim() || "Hello" })} />
          </div>
        </div>
      )}
      {!saved.publish && <p className="mt-3 text-xs text-fg-subtle">Not published: the card and the endpoint answer 404 to every key.</p>}
    </div>
  );
}

/** A multi-line command with a Copy button (CopyField is one line). */
function CopyBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-1">
      <pre className="overflow-x-auto rounded-md border border-line bg-surface p-2 font-mono text-[11px] leading-relaxed text-fg-secondary">{text}</pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            // the block is selectable; the button was a convenience
          }
        }}
        className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-1")}
      >
        {done ? "Copied" : "Copy curl"}
      </button>
    </div>
  );
}
