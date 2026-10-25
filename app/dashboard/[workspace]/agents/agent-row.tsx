"use client";

// One agent, as a row.
//
// Agents used to be a two-column card grid while skills, memory, knowledge,
// tools and scripts were single-column rows — the same kind of thing listed
// two different ways. This matches the asset rows exactly: chevron to expand,
// name and badges, actions on hover, editor underneath.

import { useState } from "react";
import Link from "next/link";
import { ExpandableTitle } from "@/components/expandable";
import { InlineEditor } from "@/components/inline-editor";
import { RunButton } from "../../run-button";
import { DeleteButton } from "../../manage";

export function AgentRow({
  search,
  workspace,
  tenant,
  name,
  description,
  badges,
  footer,
  usedBy = [],
}: {
  /** What the list's search box matches this row on. */
  search?: string;
  workspace: string;
  tenant: string;
  name: string;
  description: string;
  /** model, tools, granted tools, secrets — rendered by the page. */
  badges: React.ReactNode;
  /** own skills / own memory / used by. */
  footer: React.ReactNode;
  /** Flows that call this agent — named in the confirmation, because
   *  deleting an agent silently breaks every flow that steps through it. */
  usedBy?: string[];
}) {
  const [open, setOpen] = useState(false);
  const path = `agents/${name}/agent.md`;

  return (
    <li className="group" data-search={search}>
      <div className="flex items-start gap-4 px-5 py-3">
        <ExpandableTitle
          open={open}
          onToggle={() => setOpen((o) => !o)}
          name={name}
          badges={badges}
          subtitle={description || "No description"}
          meta={path}
        />

        <span className="flex shrink-0 items-center gap-3">
          {/* What this one has actually done. The runs list is keyed by flow,
              so without this an agent's own history is only reachable by
              knowing which flows call it. */}
          <Link
            href={`/dashboard/${workspace}/agents/${name}${tenant !== "default" ? `?tenant=${tenant}` : ""}`}
            className="text-sm text-fg-muted hover:text-fg hover:underline"
          >
            Activity
          </Link>
          <span className="opacity-0 transition-opacity group-hover:opacity-100">
            <DeleteButton
              endpoint={`/api/workspaces/${workspace}/source`}
              tenant={tenant}
              body={{ path: `agents/${name}` }}
              confirmText={`Delete agent ${name}?`}
            />
          </span>
          {/* No task field here. A bare agent run is a debugging move, and the
              CLI does it better: foldrun run <agent> --task "…". On a list, an
              expanding input just breaks the row it lives in. */}
          <RunButton
            endpoint={`/api/workspaces/${workspace}/agents/${name}/run`}
            tenant={tenant}
            label="Run"
            withTask={false}
          />
        </span>
      </div>

      <div className="px-5 pb-3 pl-10 text-xs text-fg-muted">{footer}</div>

      {open && (
        <div className="border-t border-line-faint bg-sunken/60 px-5 py-4">
          <InlineEditor workspace={workspace} tenant={tenant} path={path} />
        </div>
      )}
    </li>
  );
}
