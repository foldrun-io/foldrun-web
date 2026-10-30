"use client";

// The team: who is in this account, what each may do, and which workspaces
// each may open. An invite goes by email through the account's Resend key
// and is shown as a link too; either way it is bound to the address it was
// made for, works once, and is good for seven days. The invites still out
// are listed with a Revoke each. A member's role and scope are edited in
// place; the owner is never scoped and is the only one who can hand the
// account on.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { Avatar } from "@/components/avatar";
import { Email } from "@/components/email";
import { buttonClass, inputClass, selectClass } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useRole } from "@/components/role";
import { ASSIGNABLE, can, type Role } from "@/platform/permissions";
import { describeScope } from "@/platform/scope";

interface Member {
  id: string;
  email: string;
  createdAt: string;
  owner: boolean;
  role: Role;
  workspaces: string[] | null;
  avatar?: string | null;
}

/** A pending invite, as GET /api/team/invites answers — never its link. */
interface PendingInvite {
  id: string;
  email: string | null;
  role: Role;
  workspaces: string[] | null;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  status: string;
}

const DESCRIBE: Record<Role, string> = {
  viewer: "reads everything, changes nothing",
  editor: "edits, deploys, runs and approves",
  admin: "plus workspaces, secrets, keys and the team",
  owner: "plus billing and the admins",
};

/** All workspaces, or a chosen few: the same picker for an invite and for a member. */
function ScopePicker({ all, value, onChange, disabled = false }: { all: string[]; value: string[] | null; onChange: (v: string[] | null) => void; disabled?: boolean }) {
  const some = value !== null;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={!some} disabled={disabled} onChange={() => onChange(null)} className="h-3.5 w-3.5" />
          All workspaces
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={some} disabled={disabled || all.length === 0} onChange={() => onChange([])} className="h-3.5 w-3.5" />
          Only some
        </label>
      </div>
      {some && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-line bg-sunken px-3 py-2 text-sm">
          {all.map((w) => (
            <label key={w} className="flex items-center gap-1.5 font-mono text-xs">
              <input
                type="checkbox"
                disabled={disabled}
                checked={value!.includes(w)}
                onChange={(e) => onChange(e.target.checked ? [...value!, w] : value!.filter((x) => x !== w))}
                className="h-3.5 w-3.5 rounded"
              />
              {w}
            </label>
          ))}
          {all.length === 0 && <span className="text-xs text-fg-subtle">No workspaces yet.</span>}
        </div>
      )}
    </div>
  );
}

export function TeamManager({ members, invites = [], self, workspaces }: { members: Member[]; invites?: PendingInvite[]; self: string | null; workspaces: string[] }) {
  const mine = useRole();
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [inviteScope, setInviteScope] = useState<string[] | null>(null);
  const [result, setResult] = useState<{ url: string; sent: boolean | null; sendError: string | null; email: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState<string[] | null>(null);

  const manages = can(mine, "team:manage");
  const managesAdmins = can(mine, "admins:manage");
  const offer = ASSIGNABLE.filter((r) => r !== "admin" || managesAdmins);

  async function call(path: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setError(null);
    const res = await fetch(path, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      setError((data.error as string) ?? `${res.status}`);
      return null;
    }
    return data;
  }

  async function invite(send: boolean) {
    setBusy(true);
    setResult(null);
    const data = await call("/api/team", "POST", { role: inviteRole, workspaces: inviteScope, email: email.trim() || null, send });
    if (data?.path) {
      setResult({ url: `${window.location.origin}${data.path as string}`, sent: (data.sent as boolean | null) ?? null, sendError: (data.sendError as string | null) ?? null, email: (data.email as string | null) ?? null });
      // The new one joins the pending list; one it replaced leaves it.
      router.refresh();
    }
    setBusy(false);
  }
  async function revokeInvite(inv: PendingInvite) {
    const who = inv.email ?? "anyone with the link";
    if (!(await confirm({ title: `Revoke the invite for ${who}?`, body: "The link stops working at once. You can send a new one later.", confirmLabel: "Revoke" }))) return;
    if (await call(`/api/team/invites/${encodeURIComponent(inv.id)}`, "DELETE")) router.refresh();
  }
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link", url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  async function setRole(m: Member, role: Role) {
    if (role === m.role) return;
    if (await call(`/api/team/members/${m.id}`, "PATCH", { role })) router.refresh();
  }
  async function saveScope(m: Member) {
    if (await call(`/api/team/members/${m.id}`, "PATCH", { workspaces: draftScope })) {
      setEditing(null);
      router.refresh();
    }
  }
  async function remove(m: Member) {
    if (!(await confirm({ title: `Remove ${m.email}?`, body: "Their sign-in stops working immediately.", confirmLabel: "Remove" }))) return;
    if (await call(`/api/team/members/${m.id}`, "DELETE")) router.refresh();
  }
  async function transfer(m: Member) {
    // Handing over the account asks for the owner again (30 Oct 2026): the
    // password, and a code from the app when two-step sign-in is on. Read
    // from the dialog's own fields as they are typed — the dialog is gone
    // by the time it answers.
    const proof = { password: "", code: "" };
    const body = (
      <div className="space-y-2">
        <p>They take over billing and the admins. You stay on as an admin. This cannot be undone from your side.</p>
        <input type="password" autoComplete="current-password" placeholder="your password" aria-label="Your password" onChange={(e) => { proof.password = e.target.value; }} className={inputClass("w-full")} />
        <input inputMode="numeric" autoComplete="one-time-code" placeholder="code from your app, if two-step sign-in is on" aria-label="Two-step code" onChange={(e) => { proof.code = e.target.value; }} className={inputClass("w-full")} />
      </div>
    );
    if (!(await confirm({ title: `Make ${m.email} the owner?`, body, confirmLabel: "Transfer ownership" }))) return;
    if (await call("/api/team/transfer", "POST", { to: m.id, password: proof.password, ...(proof.code.trim() ? { code: proof.code.trim() } : {}) })) router.refresh();
  }

  const mayTouch = (m: Member) => manages && !m.owner && m.email !== self && (m.role !== "admin" || managesAdmins);

  return (
    <div className="space-y-3">
      {confirmDialog}
      {manages && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void invite(Boolean(email.trim()));
          }}
          className="rounded-xl border border-line bg-surface"
        >
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[16rem] flex-1">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" className={inputClass("mt-1 w-full")} />
              </label>
              <label>
                <span className="block text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Role</span>
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className={selectClass("mt-1")} title={DESCRIBE[inviteRole]}>
                  {offer.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Access</span>
              <ScopePicker all={workspaces} value={inviteScope} onChange={setInviteScope} />
            </div>
            <p className="text-xs text-fg-muted">
              <strong>{inviteRole}</strong> {DESCRIBE[inviteRole]}. An invite works once, for seven days; with an address it can only be accepted by that address.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line-faint bg-sunken/60 px-4 py-3">
            <button type="submit" disabled={busy || !email.trim()} className={buttonClass("primary")} title={email.trim() ? undefined : "Enter an address to send to"}>
              {busy ? "Working…" : "Send invite"}
            </button>
            <button type="button" disabled={busy} onClick={() => void invite(false)} className={buttonClass("secondary")}>
              {email.trim() ? "Just make the link" : "Make a link anyone can use"}
            </button>
            {error && <span className="text-xs text-danger">{error}</span>}
          </div>
        </form>
      )}

      {result && (
        <div className="rounded-lg border border-line bg-sunken p-3 text-sm">
          {result.sent === true && <p className="text-success">Sent to <Email value={result.email} />. The same link, in case they need it:</p>}
          {result.sent === false && <p className="text-warning">Could not send: {result.sendError}. Copy the link and send it yourself:</p>}
          {result.sent === null && <p className="text-fg-tertiary">{result.email ? <>For <Email value={result.email} /> only.</> : "One person with this link can join — share it with care."} It works once, for seven days. Shown once:</p>}
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary">{result.url}</code>
            <button type="button" onClick={() => void copy(result.url)} className={buttonClass("secondary", "!px-2.5 !py-1 !text-xs")}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
      )}

      {manages && invites.length > 0 && (
        <div className="rounded-xl border border-line bg-surface">
          <p className="border-b border-line-faint px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Pending invites</p>
          <ul className="divide-y divide-line-faint">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{inv.email ? <Email value={inv.email} /> : <span className="text-fg-muted">anyone with the link</span>}</p>
                  <p className="text-xs text-fg-muted">
                    {describeScope(inv.workspaces)} · invited by <Email value={inv.invitedBy} /> · expires <LocalTime iso={inv.expiresAt} options={{ dateStyle: "medium", timeStyle: "short" }} />
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary" title={DESCRIBE[inv.role]}>{inv.role}</span>
                {(inv.role !== "admin" || managesAdmins) && (
                  <button type="button" onClick={() => void revokeInvite(inv)} className={buttonClass("destructive", "!px-2 !py-1 !text-xs")}>Revoke</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface">
        <ul className="divide-y divide-line-faint">
          {members.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <Avatar name={m.email} src={m.avatar} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">
                    <Email value={m.email} />
                    {m.email === self && <span className="ml-2 text-xs text-fg-subtle">you</span>}
                  </p>
                  <p className="text-xs text-fg-muted">
                    since <LocalTime iso={m.createdAt} options={{ dateStyle: "medium" }} /> · {m.owner ? "all workspaces" : describeScope(m.workspaces)}
                    {mayTouch(m) && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(editing === m.id ? null : m.id);
                          setDraftScope(m.workspaces);
                        }}
                        className="ml-2 font-medium text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                      >
                        {editing === m.id ? "cancel" : "change access"}
                      </button>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {mayTouch(m) ? (
                    <select value={m.role} onChange={(e) => void setRole(m, e.target.value as Role)} className={selectClass("!py-1 !text-xs")} title={DESCRIBE[m.role]} aria-label={`Role for ${m.email}`}>
                      {offer.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary" title={DESCRIBE[m.role]}>{m.role}</span>
                  )}
                  {mine === "owner" && !m.owner && m.email !== self && (
                    <button onClick={() => transfer(m)} className={buttonClass("minimal", "!px-2 !py-1 !text-xs")} title="Make them the owner; you become an admin">Transfer</button>
                  )}
                  {mayTouch(m) && members.length > 1 && (
                    <button onClick={() => remove(m)} className={buttonClass("destructive", "!px-2 !py-1 !text-xs")}>Remove</button>
                  )}
                </div>
              </div>
              {editing === m.id && (
                <div className="mt-3 space-y-2 rounded-md border border-line bg-sunken/60 p-3">
                  <ScopePicker all={workspaces} value={draftScope} onChange={setDraftScope} />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void saveScope(m)} className={buttonClass("primary", "!px-3 !py-1 !text-xs")}>Save access</button>
                    <button type="button" onClick={() => setEditing(null)} className={buttonClass("minimal", "!px-2 !py-1 !text-xs")}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      {error && !manages && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
