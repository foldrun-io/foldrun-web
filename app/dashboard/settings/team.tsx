"use client";

// The team: who is in this account, what each may do, and which workspaces
// each may open. An invite goes by email through the account's Resend key
// and is shown as a link too; either way it is bound to the address it was
// made for, works once, and is good for seven days. The invites still out
// are listed with a Revoke each. A member's role and scope are edited in
// place; the owner is never scoped and is the only one who can hand the
// account on.

import { ROLE_LABEL, labelOf } from "@/components/value-labels";
import { $el, $rich, $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { Avatar } from "@/components/avatar";
import { Email } from "@/components/email";
import { Input } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { Mail } from "lucide-react";
import { Button } from "@foldrun/ui/react/button";
import { IconBox, Tag, Field } from "@foldrun/ui/react/page";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { useRole } from "@/components/role";
import { ASSIGNABLE, can, type Role } from "@/platform/permissions";
import { describeScope } from "@/platform/scope";
import { Checkbox, RadioGroup, RadioGroupItem } from "@foldrun/ui/react/choice";
import { useCopyFallback } from "@foldrun/ui/react/prompt";
import { Tooltip } from "@foldrun/ui/react/tooltip";

interface Member {
  id: string;
  email: string;
  createdAt: string;
  owner: boolean;
  role: Role;
  workspaces: string[] | null;
  avatar?: string | null;
}

/** A pending invite, as GET /v1/team/invites answers — never its link. */
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
  viewer: $t("settings.team.readsEverythingChangesNothing"),
  editor: $t("settings.team.editsDeploysRunsAndApproves"),
  admin: $t("settings.team.plusWorkspaceSecretsKeysAndThe"),
  owner: $t("settings.team.plusBillingAndTheAdmins"),
};

/** All workspaces, or a chosen few: the same picker for an invite and for a member. */
function ScopePicker({ all, value, onChange, disabled = false }: { all: string[]; value: string[] | null; onChange: (v: string[] | null) => void; disabled?: boolean }) {
  const some = value !== null;
  return (
    <div className="space-y-1.5">
      <RadioGroup className="flex flex-wrap gap-3 text-sm" aria-label={$t("settings.team.workspace")} value={some ? "some" : "all"} disabled={disabled} onValueChange={(v) => onChange(v === "all" ? null : [])}>
        <label className="flex items-center gap-1.5">
          {$rich("settings.team.allTerm", { radioGroupItem: $el(<RadioGroupItem value="all" />) })}
        </label>
        <label className="flex items-center gap-1.5">
          {$rich("settings.team.onlySome", { radioGroupItem: $el(<RadioGroupItem value="some" disabled={disabled || all.length === 0} />) })}
        </label>
      </RadioGroup>
      {some && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-line bg-sunken px-3 py-2 text-sm">
          {all.map((w) => (
            <label key={w} className="flex items-center gap-1.5 font-mono text-xs">
              <Checkbox
                disabled={disabled}
                checked={value!.includes(w)}
                onCheckedChange={(checked: boolean) => onChange(checked ? [...value!, w] : value!.filter((x) => x !== w))}
              />
              {w}
            </label>
          ))}
          {all.length === 0 && <span className="text-sm text-fg-muted">{$t("settings.team.noWorkspaceYet")}</span>}
        </div>
      )}
    </div>
  );
}

export function TeamManager({ members, invites = [], self, workspaces }: { members: Member[]; invites?: PendingInvite[]; self: string | null; workspaces: string[] }) {
  const mine = useRole();
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [copyFallback, copyDialog] = useCopyFallback();
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
    const data = await call("/v1/team", "POST", { role: inviteRole, workspaces: inviteScope, email: email.trim() || null, send });
    if (data?.path) {
      setResult({ url: `${window.location.origin}${data.path as string}`, sent: (data.sent as boolean | null) ?? null, sendError: (data.sendError as string | null) ?? null, email: (data.email as string | null) ?? null });
      // The new one joins the pending list; one it replaced leaves it.
      router.refresh();
    }
    setBusy(false);
  }
  async function revokeInvite(inv: PendingInvite) {
    const who = inv.email ?? $t("settings.team.anyoneWithTheLink");
    if (!(await confirm({ title: $t("settings.team.revokeTheInviteFor", { who: String(who) }), body: $t("settings.team.theLinkStopsWorkingAtOnce"), confirmLabel: $t("settings.team.revoke") }))) return;
    if (await call(`/v1/team/invites/${encodeURIComponent(inv.id)}`, "DELETE")) router.refresh();
  }
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      copyFallback(url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  async function setRole(m: Member, role: Role) {
    if (role === m.role) return;
    if (await call(`/v1/team/members/${m.id}`, "PATCH", { role })) router.refresh();
  }
  async function saveScope(m: Member) {
    if (await call(`/v1/team/members/${m.id}`, "PATCH", { workspaces: draftScope })) {
      setEditing(null);
      router.refresh();
    }
  }
  async function remove(m: Member) {
    if (!(await confirm({ title: $t("settings.team.remove", { email: String(m.email) }), body: $t("settings.team.theirSignInStopsWorkingImmediately"), confirmLabel: $t("settings.team.remove2") }))) return;
    if (await call(`/v1/team/members/${m.id}`, "DELETE")) router.refresh();
  }
  async function transfer(m: Member) {
    // Handing over the account asks for the owner again (30 Oct 2026): the
    // password, and a code from the app when two-step sign-in is on. Read
    // from the dialog's own fields as they are typed — the dialog is gone
    // by the time it answers.
    const proof = { password: "", code: "" };
    const body = (
      <div className="space-y-2">
        <p>{$t("settings.team.theyTakeOverBillingAndThe")}</p>
        <Input type="password" autoComplete="current-password" placeholder={$t("settings.team.yourPassword")} aria-label={$t("settings.team.yourPassword2")} onChange={(e) => { proof.password = e.target.value; }} className="w-full" />
        <Input inputMode="numeric" autoComplete="one-time-code" placeholder={$t("settings.team.codeFromYourAppIfTwo")} aria-label={$t("settings.team.twoStepCode")} onChange={(e) => { proof.code = e.target.value; }} className="w-full" />
      </div>
    );
    if (!(await confirm({ title: $t("settings.team.makeTheOwner", { email: String(m.email) }), body, confirmLabel: $t("settings.team.transferOwnership") }))) return;
    if (await call("/v1/team/transfer", "POST", { to: m.id, password: proof.password, ...(proof.code.trim() ? { code: proof.code.trim() } : {}) })) router.refresh();
  }

  const mayTouch = (m: Member) => manages && !m.owner && m.email !== self && (m.role !== "admin" || managesAdmins);

  return (
    <div className="space-y-6">
      {confirmDialog}
      {copyDialog}
      {manages && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void invite(Boolean(email.trim()));
          }}
          className="overflow-hidden rounded-lg border border-line bg-surface"
        >
          <div className="space-y-4 p-5 sm:p-6">
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold text-fg">{$t("settings.team.invitePeople")}</h2>
              <p className="text-sm text-fg-muted">{$t("settings.team.anInviteIsALinkThat")}</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={$t("settings.team.email")} className="min-w-0 flex-1 basis-60">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" className="w-full" />
              </Field>
              <Field label={$t("settings.team.role")}>
                <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}  title={DESCRIBE[inviteRole]}>
                  {offer.map((r) => (
                    <option key={r} value={r}>{labelOf(ROLE_LABEL, r)}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-fg">{$t("settings.team.access")}</span>
              <ScopePicker all={workspaces} value={inviteScope} onChange={setInviteScope} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken px-5 py-3 text-sm text-fg-muted sm:px-6">
            <span className="min-w-0">
              {error ? (
                <span role="alert" className="text-danger">{error}</span>
              ) : (
                <>
                  {$rich("settings.team.withAnAddressOnlyThatAddress", { inviteRole: inviteRole, span: (chunks) => <span className="font-medium text-fg">{chunks}</span>, inviteRole2: DESCRIBE[inviteRole] })}
                </>
              )}
            </span>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void invite(false)}>
                {email.trim() ? $t("settings.team.justMakeTheLink") : $t("settings.team.makeALinkAnyoneCanUse")}
              </Button>
              <Tooltip label={email.trim() ? undefined : $t("settings.team.enterAnAddressToSendTo")}>
                <span className="inline-flex">
                  <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
                    {busy ? $t("settings.team.working") : $t("settings.team.sendInvite")}
                  </Button>
                </span>
              </Tooltip>
            </div>
          </div>
        </form>
      )}

      {result && (
        <div role="status" className="rounded-lg border border-line bg-surface p-4 text-sm">
          {result.sent === true && <p className="text-success">{$rich("settings.team.sentToTheSameLinkIn", { email: $el(<Email value={result.email} />) })}</p>}
          {result.sent === false && <p className="text-warning">{$t("settings.team.couldNotSendCopyTheLink", { sendError: result.sendError ?? "" })}</p>}
          {result.sent === null && <p className="text-fg-muted">{result.email ? <>{$rich("settings.team.forOnly", { email: $el(<Email value={result.email} />) })}</> : $t("settings.team.onePersonWithThisLinkCan")}{" "}{$t("settings.team.itWorksOnceForSevenDays")}</p>}
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-sunken px-3 py-1.5 font-mono text-xs text-fg-secondary">{result.url}</code>
            <Button variant="secondary" onClick={() => void copy(result.url)}>{copied ? $t("settings.team.copied") : $t("settings.team.copy")}</Button>
          </div>
        </div>
      )}

      {manages && invites.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-2 px-1">
            <h2 className="text-base font-medium text-fg">{$t("settings.team.pendingInvites")}</h2>
            <span className="text-sm tabular-nums text-fg-muted">{invites.length}</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <ul className="divide-y divide-line">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <IconBox round className="max-sm:hidden"><Mail /></IconBox>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{inv.email ? <Email value={inv.email} /> : <span className="text-fg-muted">{$t("settings.team.anyoneWithTheLink")}</span>}</p>
                  <p className="text-xs text-fg-muted">
                    {$rich("settings.team.invitedByExpires", { describeScope: describeScope(inv.workspaces), email: $el(<Email value={inv.invitedBy} />), localTime: $el(<LocalTime iso={inv.expiresAt} options={{ dateStyle: "medium", timeStyle: "short" }} />) })}
                  </p>
                </div>
                <Tag><Tooltip label={DESCRIBE[inv.role]}><span>{labelOf(ROLE_LABEL, inv.role)}</span></Tooltip></Tag>
                {(inv.role !== "admin" || managesAdmins) && (
                  <Button variant="ghost" className="hover:text-danger" onClick={() => void revokeInvite(inv)}>{$t("settings.team.revoke")}</Button>
                )}
              </li>
            ))}
          </ul>
          </div>
        </section>
      )}

      <section className="space-y-3">
      <div className="flex items-end justify-between gap-2 px-1">
        <h2 className="text-base font-medium text-fg">{$t("settings.team.members")}</h2>
        <span className="text-sm tabular-nums text-fg-muted">{members.length}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="px-4 py-3 sm:px-5">
              <div className="flex items-center gap-3">
                <Avatar name={m.email} src={m.avatar} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">
                    <Email value={m.email} />
                    {m.email === self && <span className="ml-2 text-xs text-fg-muted">{$t("settings.team.you")}</span>}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {$rich("settings.team.since", { localTime: $el(<LocalTime iso={m.createdAt} options={{ dateStyle: "medium" }} />), part: m.owner ? $t("settings.team.allWorkspace2") : describeScope(m.workspaces) })}
                    {mayTouch(m) && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(editing === m.id ? null : m.id);
                          setDraftScope(m.workspaces);
                        }}
                        className="ml-2 font-medium text-link underline-offset-2 hover:underline"
                      >
                        {editing === m.id ? "cancel" : $t("settings.team.changeAccess")}
                      </button>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {mayTouch(m) ? (
                    <Select value={m.role} onChange={(e) => void setRole(m, e.target.value as Role)} size="sm" title={DESCRIBE[m.role]} aria-label={$t("settings.team.roleFor", { email: String(m.email) })}>
                      {offer.map((r) => (
                        <option key={r} value={r}>{labelOf(ROLE_LABEL, r)}</option>
                      ))}
                    </Select>
                  ) : (
                    <Tag><Tooltip label={DESCRIBE[m.role]}><span>{labelOf(ROLE_LABEL, m.role)}</span></Tooltip></Tag>
                  )}
                  {mine === "owner" && !m.owner && m.email !== self && (
                    <Tooltip label={$t("settings.team.makeThemTheOwnerYouBecome")}><Button variant="ghost" onClick={() => transfer(m)}>{$t("settings.team.transfer")}</Button></Tooltip>
                  )}
                  {mayTouch(m) && members.length > 1 && (
                    <Button variant="ghost" className="hover:text-danger" onClick={() => remove(m)}>{$t("settings.team.remove2")}</Button>
                  )}
                </div>
              </div>
              {editing === m.id && (
                <div className="mt-3 space-y-3 rounded-md border border-line bg-sunken p-3">
                  <ScopePicker all={workspaces} value={draftScope} onChange={setDraftScope} />
                  <div className="flex items-center gap-2">
                    <Button variant="primary" onClick={() => void saveScope(m)}>{$t("settings.team.saveAccess")}</Button>
                    <Button variant="ghost" onClick={() => setEditing(null)}>{$t("settings.team.cancel")}</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      </section>
      {error && !manages && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
