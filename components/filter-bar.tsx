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
import { selectClass } from "@/components/ui";

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

const LABEL = "text-[10px] font-medium uppercase tracking-wide text-fg-subtle";
const CHIP = "shrink-0 whitespace-nowrap px-2.5 py-1 text-xs font-medium transition-colors";
const CHIP_ON = "bg-ink text-on-ink";
const CHIP_OFF = "bg-surface text-fg-tertiary hover:bg-sunken";

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
    <div className="mb-4 flex flex-wrap items-end gap-x-5 gap-y-3">
      {dimensions.map((d) => {
        // A dimension with one value is not a choice; it is shown only when
        // it is the active filter, so it can be cleared.
        if (d.options.length < 2 && !current[d.key]) return null;
        const kind = d.kind === "auto" || !d.kind ? (d.options.length <= CHIPS_UP_TO ? "chips" : "select") : d.kind;
        const value = current[d.key] ?? "";
        const all = d.allLabel ?? "All";
        return (
          <div key={d.key} className="flex min-w-0 max-w-full flex-col gap-1">
            <span className={LABEL}>{d.label}</span>
            {kind === "select" ? (
              // A GET form: the select navigates on change, and the hidden
              // inputs carry every other filter so the URL the form builds
              // is the same one `href` would. The submit button is for a
              // page where nothing runs on change; it is hidden once it does.
              <form method="get" action={base} className="flex items-center gap-1">
                {Object.entries(current)
                  .filter(([k, v]) => v && k !== d.key && !(d.resets ?? []).includes(k))
                  .map(([k, v]) => (
                    <input key={k} type="hidden" name={k} value={v} />
                  ))}
                {tenant && <input type="hidden" name="tenant" value={tenant.replace(/^tenant=/, "")} />}
                <select
                  name={d.key}
                  aria-label={d.label}
                  value={value}
                  onChange={(e) => router.push(href(patchFor(d, e.target.value)))}
                  className={selectClass("py-1 pr-7 text-xs")}
                >
                  <option value="">{all}</option>
                  {d.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label ?? o.value}
                    </option>
                  ))}
                </select>
                <noscript>
                  <button type="submit" className="rounded-md px-2 py-1 text-xs ring-1 ring-inset ring-line">
                    Go
                  </button>
                </noscript>
              </form>
            ) : (
              // A segmented control: one box, the chips joined inside it, so
              // five statuses read as one question rather than five buttons.
              // Too many for a phone's width, it scrolls inside its box.
              <div role="group" aria-label={d.label} className="inline-flex max-w-full overflow-x-auto rounded-md ring-1 ring-inset ring-line">
                <Link
                  href={href(patchFor(d, undefined))}
                  aria-current={!value ? "true" : undefined}
                  className={`${CHIP} ${!value ? CHIP_ON : CHIP_OFF}`}
                >
                  {all}
                </Link>
                {d.options.map((o) => {
                  const on = value === o.value;
                  return (
                    <Link
                      key={o.value}
                      href={href(patchFor(d, on ? undefined : o.value))}
                      aria-current={on ? "true" : undefined}
                      className={`${CHIP} border-l border-line ${on ? CHIP_ON : CHIP_OFF}`}
                    >
                      {o.label ?? o.value}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {(active.length > 0 || total !== undefined) && (
        <div className="ml-auto flex items-center gap-3 self-center text-xs text-fg-muted">
          {total !== undefined && (
            <span className="tabular-nums">
              {total} {noun}
            </span>
          )}
          {active.length > 0 && (
            <Link
              href={clearAll}
              className="font-medium text-fg-tertiary underline-offset-2 hover:text-fg hover:underline"
            >
              Clear filters
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
