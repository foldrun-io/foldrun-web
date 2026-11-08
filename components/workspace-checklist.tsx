"use client";

// A workspace's checklist on its overview (cloudhost's Production
// checklist), drawn with the kit's ChecklistCard: what the desk needs before
// it can be left to run, each item ticking itself from the workspace's real
// state (workspace-checklist-model.ts), each a link to where it is done. An
// item hides from its "…" menu, the whole card from the card's — a person's
// own choice, kept in their prefs (PATCH /api/me/onboarding { checklist }).

import type { ReactNode } from "react";
import { Bell, CalendarClock, FlaskConical, Play, UserRound, X } from "lucide-react";
import type { ChecklistItemId, WorkspaceChecklist as Checklist } from "./workspace-checklist-model";
import { useOnboardingPatch, withQs } from "./onboarding-card";
import { ChecklistCard } from "@foldrun/ui/react/checklist";
import { MenuItem } from "@foldrun/ui/react/menu";

const ICON: Record<ChecklistItemId, ReactNode> = {
  run: <Play />,
  trigger: <CalendarClock />,
  owner: <UserRound />,
  eval: <FlaskConical />,
  notify: <Bell />,
};

export function WorkspaceChecklist({ data, qs, canHide }: { data: Checklist; qs: string; canHide: boolean }) {
  const { busy, error, send } = useOnboardingPatch();
  if (!data.show) return null;
  const patch = (checklist: Record<string, unknown>) => send({ checklist: { workspace: data.workspace, ...checklist } });
  return (
    <ChecklistCard
      title="Workspace checklist"
      progress={{ done: data.done, total: data.total, style: "count" }}
      busy={busy}
      hideLabel="Hide this item"
      menuLabel="Checklist options"
      menu={
        canHide ? (
          <MenuItem onSelect={() => void patch({ dismissed: true })}>
            <X />
            Hide checklist
          </MenuItem>
        ) : undefined
      }
      rows={data.items
        .filter((i) => i.done || !i.hidden)
        .map((i) => ({
          key: i.id,
          label: i.title,
          hint: i.why,
          icon: ICON[i.id],
          href: withQs(i.href, qs),
          done: i.done,
          onHide: canHide && !i.done ? () => void patch({ hide: [i.id] }) : undefined,
        }))}
      footer={error ? <span role="alert" className="text-danger">{error}</span> : undefined}
    />
  );
}
