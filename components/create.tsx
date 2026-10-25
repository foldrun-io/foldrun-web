"use client";

// The one way to make a new thing.
//
// This existed four times: `NewButton` (agents, flows, evals, workspaces),
// `NewProjectAsset` (workspace documents, with a scope picker and *templates
// written in the browser*), `NewLibraryItem` (account), and the file tree's
// draft rows. Four components, three template sources, and no two of them said
// the same thing while you typed a name.
//
// One gesture, one surface: the button opens a **dialog**. Inline forms
// unfolding inside a page header pushed the page around and buried the
// choices; a dialog holds the whole decision — start from scratch or from a
// template, name it, say where it lives — in one place, the way every SaaS
// you already know does it.
//
// What gets written is the server's business — it reads KINDS, so a skill
// made here and a skill made by `foldrun init` are the same file.
//
// Two layers, because one of them is not about documents:
//
//   CreateForm    the gesture. Knows nothing about kinds.
//   CreateButton  CreateForm with the labels and endpoint filled from KINDS.
//
// A workspace is a container, not a document — it has no `type:` and no scope
// above it. It uses CreateForm directly. That is the split doing its job:
// sharing the interaction without claiming a workspace is a kind of document.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { buttonClass, inputClass, selectClass, FIELD_LABEL_CLASS } from "@/components/ui";
import { KINDS, type Kind } from "@/lib/kinds";
import { useCan } from "@/components/role";
import { createdHref } from "@/components/create-model";

/** The scope a new document lands in. `agent:<name>` is one agent's own. */
export type Where = "account" | "workspace" | `agent:${string}`;

export interface CreateTarget {
  /** POST here with { name, ...body }. */
  endpoint: string;
  body?: Record<string, unknown>;
}

/**
 * One scope you can create into, and where that posts.
 *
 * Plain data on purpose. This was a `(where: Where) => CreateTarget` callback,
 * which typechecks perfectly and throws at runtime the moment a *server*
 * component renders it: functions can't cross the RSC boundary. Serialisable
 * props are the only kind this component can safely take.
 */
export interface CreateOption {
  where: Where;
  label: string;
  target: CreateTarget;
}

/**
 * One way to start. `section` groups the cards in the dialog — "From
 * scratch" shapes above "Templates" — and `suggestName` prefills the name
 * field when a template is picked, so adding a stock tool is two clicks.
 * Plain data, for the same RSC-boundary reason as CreateOption.
 */
export interface VariantChoice {
  value: string;
  label: string;
  /** One line saying what this choice gives you. */
  hint?: string;
  /** Heading the choice renders under. Absent = one unlabeled group. */
  section?: string;
  /** Prefill for the name field while the user hasn't typed their own. */
  suggestName?: string;
  /**
   * A follow-up choice this one needs, shown only while it is selected.
   *
   * There is exactly one today: a script tool's language. It is a second
   * question rather than three more cards because "what kind of tool" and
   * "written in what" are different questions, and folding them together
   * turns a three-item list into a nine-item one.
   */
  then?: { key: string; label: string; choices: { value: string; label: string; hint?: string }[] };
}

function scopeLabel(where: Where) {
  if (where === "workspace") return "Whole workspace";
  if (where === "account") return "Whole account";
  return `Only ${where.slice("agent:".length)}`;
}

/**
 * Name a thing and create it — a button that opens a dialog.
 *
 * @param noun    what you're making, for the button and title: "agent", "tool"
 * @param options scopes offered; fewer than two hides the picker, because one
 *                choice is not a choice
 * @param variants ways to start (blank shapes, templates); one hides the cards
 */
export function CreateForm({
  noun,
  hint,
  placeholder,
  tenant,
  options,
  label,
  variants,
  trigger = true,
  autoOpen = false,
}: {
  noun: string;
  hint: string;
  placeholder: string;
  tenant: string;
  options: CreateOption[];
  label?: string;
  /** Render the opening button. False when the page opens the dialog some
   *  other way (a menu, a URL) and does not want a second door. */
  trigger?: boolean;
  /** Open on mount — the page read `?create=` and wants the dialog up. Closing
   *  strips the param, so a refresh does not reopen it. */
  autoOpen?: boolean;
  /** An optional second axis — "what shape of thing" where scope is "where
   *  it lives". The chosen value is POSTed under `key`. */
  variants?: { key: string; choices: VariantChoice[] };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // Whether `name` is the user's own typing. A picked template suggests its
  // canonical name; that suggestion must never overwrite something typed,
  // and picking a different template must replace a mere suggestion.
  const [named, setNamed] = useState(false);
  const [where, setWhere] = useState<Where>(options[0]?.where ?? "workspace");
  const [variant, setVariant] = useState(variants?.choices[0]?.value ?? "");
  // The follow-up answer, keyed by the choice that asked — so switching from
  // Script to API and back does not lose which language you had picked.
  const [thenBy, setThenBy] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Adjusting state to a prop, the React way: during render, once, rather
  // than in an effect that would paint closed and then open.
  const [openedFor, setOpenedFor] = useState(false);
  if (autoOpen && !openedFor) {
    setOpenedFor(true);
    setOpen(true);
  }
  const close = () => {
    setOpen(false);
    if (autoOpen) {
      const u = new URL(window.location.href);
      u.searchParams.delete("create");
      router.replace(u.pathname + (u.search ? u.search : ""));
    }
    setName("");
    setNamed(false);
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The follow-up question the selected card asks, if it asks one, and the
  // answer standing for it. Rendered beside the name so the whole dialog is
  // one read: what kind, what it's called, what it's written in.
  const followUp = variants?.choices.find((c) => c.value === variant)?.then ?? null;
  const thenValue = followUp ? thenBy[variant] ?? followUp.choices[0].value : "";

  // The shapes people choose between, and the templates that are a shortcut
  // to one of them. The first section is the type; every later section is a
  // template list. A single-choice first section (one "Blank file") is not a
  // choice and renders nothing.
  const { primary, templates } = useMemo(() => {
    const choices = variants?.choices ?? [];
    const firstSection = choices[0]?.section ?? "";
    return {
      primary: choices.filter((c) => (c.section ?? "") === firstSection),
      templates: choices.filter((c) => (c.section ?? "") !== firstSection),
    };
  }, [variants]);

  const pick = (c: VariantChoice) => {
    setVariant(c.value);
    if (!named) setName(c.suggestName ?? "");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { endpoint, body } = (options.find((o) => o.where === where) ?? options[0]).target;
    try {
      const data = await postCreate(endpoint, tenant, name, {
        ...body,
        ...(variants && variant ? { [variants.key]: variant } : {}),
        ...(followUp ? { [followUp.key]: thenValue } : {}),
      });
      const href = createdHref(data);
      if (href) {
        // Straight into what was made. Not close(): its replace() back to
        // this page would race the push.
        setOpen(false);
        setName("");
        setNamed(false);
        router.push(href);
        return;
      }
      close();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {trigger && (
      <button onClick={() => setOpen(true)} className={buttonClass("primary")}>
        {label ?? `New ${noun}`}
      </button>
      )}

      {open &&
        createPortal(
          // A portal to <body>: the trigger lives inside page headers whose
          // ancestors are free to clip or transform, and a fixed overlay
          // inside a transformed ancestor is fixed to it, not the viewport.
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[10vh] backdrop-blur-[2px]"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-label={`New ${noun}`}
              onSubmit={submit}
              className="w-full max-w-lg rounded-xl border border-line bg-surface shadow-2xl"
            >
              <header className="border-b border-line-faint px-5 py-4">
                <h2 className="font-cal text-base font-semibold text-fg">
                  New {noun}
                </h2>
                <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>
              </header>

              <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
                {/* Three questions, top to bottom, each labelled: what kind,
                    what it's called, what it's written in. No search box —
                    the one that filtered the cards sat exactly where a name
                    field belongs, unlabelled, so people typed the tool's name
                    into it, every card vanished, and "Nothing matches" was
                    the whole of the feedback. */}
                {primary.length > 1 && (
                  <fieldset>
                    <legend className={`${FIELD_LABEL_CLASS} pb-1.5`}>Type</legend>
                    <div className={`grid gap-2 ${primary.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                      {primary.map((c) => {
                        const on = variant === c.value;
                        return (
                          <button
                            key={c.value || c.label}
                            type="button"
                            aria-pressed={on}
                            onClick={() => pick(c)}
                            className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                              on
                                ? "border-gray-900 bg-sunken ring-1 ring-gray-900"
                                : "border-line hover:border-line-strong hover:bg-sunken"
                            }`}
                          >
                            <span className="block text-sm font-medium text-fg">{c.label}</span>
                            {c.hint && (
                              <span className="mt-0.5 block text-[11px] leading-snug text-fg-muted">
                                {c.hint}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                )}

                {/* Templates are a shortcut, not a fourth kind: one dropdown,
                    out of the way. Seven cards of them beside the three that
                    matter is what made the list need a search box. */}
                {templates.length > 0 && (
                  <label className="block">
                    <span className={`${FIELD_LABEL_CLASS} pb-1`}>
                      {primary.length > 1 ? "Or start from a template" : "Start from"}
                    </span>
                    <select
                      value={templates.some((t) => t.value === variant) ? variant : ""}
                      onChange={(e) => {
                        const t = templates.find((c) => c.value === e.target.value);
                        if (t) pick(t);
                        else pick(primary[0]);
                      }}
                      className={selectClass("w-full py-2")}
                    >
                      <option value="">{primary.length > 1 ? "— none, start from scratch —" : "Blank"}</option>
                      {templates.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                          {t.hint ? ` — ${t.hint.slice(0, 60)}${t.hint.length > 60 ? "…" : ""}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-0 flex-1">
                    <span className={`${FIELD_LABEL_CLASS} pb-1`}>Name</span>
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setNamed(e.target.value.length > 0);
                      }}
                      placeholder={placeholder}
                      spellCheck={false}
                      className={inputClass("w-full py-2")}
                    />
                  </label>

                  {options.length > 1 && (
                    <label className="shrink-0">
                      <span className={`${FIELD_LABEL_CLASS} pb-1`}>Where it lives</span>
                      <select
                        value={where}
                        onChange={(e) => setWhere(e.target.value as Where)}
                        className={selectClass("py-2")}
                      >
                        {options.map((o) => (
                          <option key={o.where} value={o.where}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {followUp && (
                  <fieldset>
                    <legend className={`${FIELD_LABEL_CLASS} pb-1.5`}>{followUp.label}</legend>
                    <div className="flex flex-wrap gap-2">
                      {followUp.choices.map((c) => {
                        const on = thenValue === c.value;
                        return (
                          <button
                            key={c.value}
                            type="button"
                            aria-pressed={on}
                            title={c.hint}
                            onClick={() => setThenBy((m) => ({ ...m, [variant]: c.value }))}
                            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                              on
                                ? "border-gray-900 bg-sunken text-fg ring-1 ring-gray-900"
                                : "border-line text-fg-tertiary hover:border-line-strong hover:bg-sunken"
                            }`}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                )}

                {error && <p className="text-xs text-red-600">{error}</p>}
              </div>

              <footer className="flex items-center justify-end gap-2 border-t border-line-faint px-5 py-3">
                <button type="button" onClick={close} className={buttonClass("minimal")}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim() || busy}
                  className={buttonClass("primary")}
                >
                  {busy ? "Creating…" : `Create ${noun}`}
                </button>
              </footer>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * The one create request: POST `{ name, ...body }` to `endpoint`, the
 * server building whatever the new thing holds. CreateForm sends it, and so
 * does anything else that makes a thing (the assistant's Create workspace),
 * so the dashboard has exactly one way to create. Throws the refusal.
 */
export async function postCreate(endpoint: string, tenant: string, name: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
    body: JSON.stringify({ name, ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `${res.status}`);
  return data;
}

/** Where each scope posts to, for a document kind. */
function targetFor(kind: Kind, where: Where, workspace?: string): CreateTarget {
  if (where === "account") return { endpoint: `/api/library/${kind}` };

  const base = `/api/workspaces/${workspace}`;
  // Agents, flows and evals have their own REST collections; the rest share
  // the assets endpoint, which takes the kind as a field.
  if (kind === "agents" || kind === "flows" || kind === "evals") return { endpoint: `${base}/${kind}` };

  const agent = where.startsWith("agent:") ? where.slice("agent:".length) : undefined;
  return { endpoint: `${base}/assets`, body: { kind, ...(agent ? { agent } : {}) } };
}

/** CreateForm for a document kind — every label comes from KINDS. */
export function CreateButton({
  kind,
  tenant,
  workspace,
  /** Agents in this workspace, when this kind can belong to one. */
  agents = [],
  /** Scopes offered, in the order shown. Defaults to what the kind supports. */
  scopes,
  label,
  variants,
}: {
  kind: Kind;
  tenant: string;
  workspace?: string;
  agents?: string[];
  scopes?: Where[];
  label?: string;
  variants?: { key: string; choices: VariantChoice[] };
}) {
  const meta = KINDS[kind];
  // Creating is a write. Hidden for a viewer: an "Add" that always refuses
  // is worse than none.
  const mayWrite = useCan("workspace:write");
  const choices: Where[] =
    scopes ??
    (workspace && meta.scopes.includes("agent")
      ? (["workspace", ...agents.map((a) => `agent:${a}` as Where)] as Where[])
      : workspace
        ? ["workspace"]
        : ["account"]);

  if (!mayWrite) return null;
  return (
    <CreateForm
      noun={meta.one}
      hint={meta.hint}
      placeholder={meta.placeholder}
      tenant={tenant}
      label={label}
      variants={variants}
      options={choices.map((where) => ({
        where,
        label: scopeLabel(where),
        target: targetFor(kind, where, workspace),
      }))}
    />
  );
}
