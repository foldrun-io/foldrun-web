"use client";

// One filter bar for every filtered list in the dashboard.
//
// A list's filters are URL params on a server-rendered page, so every control
// here is a navigation: pick a value, the page reloads with that one param
// changed and every other kept. The old runs bar spelled every value of every
// dimension out as a chip — eight workspaces, thirty-odd agents, five statuses
// and four windows in one wall — which is a search you can only read by
// scanning. Here each dimension is one labelled control: a select where the
// list is long, a segmented row of chips where it is short enough to see at
// once. The page decides what the dimensions are; this decides how they look.
//
// A chip is a link, not a button. It used to be a button that pushed the
// route, which works only once React has taken over the page: before that —
// and on any page where it never does — the chips looked pressed and did
// nothing, which is what "the filter is broken" looks like from a chair. A
// link filters whether or not a script is running, opens in a new tab, and
// is the same thing the pager already is. The select cannot be a link, so it
// stays a navigation, with a plain submit for anyone without script.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/components/kit/cn";
import { Select } from "@/components/kit/select";
import { Segmented } from "@/components/kit/segmented";
import { buttonVariants } from "@/components/kit/button";

export interface FilterOption {
  value: string;
  /** Shown in place of the value — "7 days" for `7d`. */
  label?: string;
}

export interface FilterDimension {
  /** The URL param this dimension writes. */
  key: string;
  /** The label above the control: "Workspace", "Status", "When". */
  label: string;
  /** Drawn from the data by the page — a filter never offers a value that
   *  would return nothing. */
  options: FilterOption[];
  /** `chips` reads at a glance and suits up to about six values; `select`
   *  suits any length. `auto` (the default) picks by count. */
  kind?: "chips" | "select" | "auto";
  /** What the empty choice is called: "All", "Any", "All time". */
  allLabel?: string;
  /** Params that stop making sense when this one changes — a flow name
   *  belongs to one workspace, so picking a workspace clears the flow. */
  resets?: string[];
}

const CHIPS_UP_TO = 6;

// The kit's controls (UI refactor, Nov 2026): a long dimension is the kit's
// Select; a short one is the kit's Segmented in link mode. The dimension's
// name is the control's accessible label and its "all" value, not a
// micro-label above it.

export function FilterBar({
  base,
  current,
  dimensions,
  tenantParam = "",
  total,
  noun = "results",
}: {
  /** The page's path, no query. */
  base: string;
  /** The active value per dimension key, as the page read them. */
  current: Record<string, string | undefined>;
  dimensions: FilterDimension[];
  /** `&tenant=x` or empty. */
  tenantParam?: string;
  /** How many rows the current filters leave, when the page knows. */
  total?: number;
  noun?: string;
}) {
  const router = useRouter();
  const tenant = tenantParam.replace(/^&/, "");

  const href = (patch: Record<string, string | undefined>) => {
    const next = { ...current, ...patch };
    const qs = Object.entries(next)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join("&");
    const all = [qs, tenant].filter(Boolean).join("&");
    return all ? `${base}?${all}` : base;
  };
  const patchFor = (d: FilterDimension, value: string | undefined) => {
    const patch: Record<string, string | undefined> = { [d.key]: value || undefined };
    for (const k of d.resets ?? []) patch[k] = undefined;
    return patch;
  };

  const active = dimensions.filter((d) => current[d.key]);
  const clearAll = href(Object.fromEntries(dimensions.map((d) => [d.key, undefined])));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {dimensions.map((d) => {
        // A dimension with one value is not a choice; it is shown only when
        // it is the active filter, so it can be cleared.
        if (d.options.length < 2 && !current[d.key]) return null;
        const kind = d.kind === "auto" || !d.kind ? (d.options.length <= CHIPS_UP_TO ? "chips" : "select") : d.kind;
        const value = current[d.key] ?? "";
        const all = d.allLabel ?? "All";
        return kind === "select" ? (
          // A GET form: the select navigates on change, and the hidden
          // inputs carry every other filter so the URL the form builds is
          // the same one `href` would. The submit button is for a page where
          // nothing runs on change; it is hidden once it does.
          <form key={d.key} method="get" action={base} className="flex min-w-0 max-w-full items-center gap-1">
            {Object.entries(current)
              .filter(([k, v]) => v && k !== d.key && !(d.resets ?? []).includes(k))
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            {tenant && <input type="hidden" name="tenant" value={tenant.replace(/^tenant=/, "")} />}
            <Select
              name={d.key}
              aria-label={d.label}
              title={d.label}
              value={value}
              onChange={(e) => router.push(href(patchFor(d, e.target.value)))}
              className="max-w-56"
              selectClassName={cn("text-[13px]", value && "border-line-strong font-medium")}
            >
              <option value="">{all}</option>
              {d.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label ?? o.value}
                </option>
              ))}
            </Select>
            <noscript>
              <button type="submit" className={buttonVariants({ variant: "secondary", size: "md" })}>
                Go
              </button>
            </noscript>
          </form>
        ) : (
          // A segmented control: one box, the chips joined inside it, so
          // five statuses read as one question rather than five buttons.
          // Too many for a phone's width, it scrolls inside its box.
          <Segmented
            key={d.key}
            label={d.label}
            current="true"
            value={value}
            items={[
              { key: "", label: all, href: href(patchFor(d, undefined)) },
              ...d.options.map((o) => ({ key: o.value, label: o.label ?? o.value, href: href(patchFor(d, value === o.value ? undefined : o.value)) })),
            ]}
          />
        );
      })}
      {(active.length > 0 || total !== undefined) && (
        <div className="ml-auto flex items-center gap-3 text-[13px] text-fg-muted">
          {total !== undefined && (
            <span className="tabular-nums">
              {total} {noun}
            </span>
          )}
          {active.length > 0 && (
            <Link href={clearAll} className="font-medium text-fg-secondary underline-offset-2 hover:text-fg hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
