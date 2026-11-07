// A workspace's checklist (cloudhost's Production checklist): what a desk
// needs before it can be left to run on its own — a flow that ran to the
// end, something that starts it without you, someone who answers for it, a
// test its agents must pass, and somebody told when it fails. Each item is
// read from what the workspace really has, never ticked by hand, so it is
// done whichever way the thing was done (dashboard, CLI, git push, API).
// The one thing stored is a person's choice to hide an item or the card.
//
// Pure: facts in, items out. server/onboarding.ts gathers the facts.

export type ChecklistItemId = "run" | "trigger" | "owner" | "eval" | "notify";

export const CHECKLIST_ITEM_IDS: readonly ChecklistItemId[] = ["run", "trigger", "owner", "eval", "notify"];

export function isChecklistItemId(v: unknown): v is ChecklistItemId {
  return typeof v === "string" && (CHECKLIST_ITEM_IDS as readonly string[]).includes(v);
}

export interface WorkspaceChecklistFacts {
  workspace: string;
  /** Runs of this workspace that completed. */
  completedRuns: number;
  /** Flows with a schedule or webhook trigger. */
  triggers: number;
  /** `owner:` as the cascade resolves it (the workspace's, else the
   *  account's); null when neither names one. */
  owner: string | null;
  evals: number;
  /** `notify:` with an address or a URL, the workspace's or inherited. */
  notify: boolean;
}

export interface ChecklistItem {
  id: ChecklistItemId;
  title: string;
  why: string;
  /** Where it is done, as a dashboard path (the caller adds ?tenant=). */
  href: string;
  done: boolean;
  /** This person hid it; it still ticks itself when done. */
  hidden: boolean;
}

export interface WorkspaceChecklist {
  workspace: string;
  items: ChecklistItem[];
  done: number;
  total: number;
  /** Every item done. */
  complete: boolean;
  /** This person hid the whole card for this workspace. */
  dismissed: boolean;
  /** Whether the card is drawn: not dismissed, and something is left that
   *  is neither done nor hidden. */
  show: boolean;
}

export function workspaceChecklist(f: WorkspaceChecklistFacts, prefs: { hidden?: readonly string[]; dismissed?: boolean } = {}): WorkspaceChecklist {
  const base = `/dashboard/${encodeURIComponent(f.workspace)}`;
  const hidden = prefs.hidden ?? [];
  const raw: Omit<ChecklistItem, "hidden">[] = [
    {
      id: "run",
      title: "Run a flow to the end",
      why: "A completed run is the proof this desk works.",
      href: `${base}/flows`,
      done: f.completedRuns > 0,
    },
    {
      id: "trigger",
      title: "Schedule it or give it a webhook",
      why: "A desk earns its keep when it runs without you.",
      href: `${base}/triggers`,
      done: f.triggers > 0,
    },
    {
      id: "owner",
      title: "Name an owner",
      why: "Who answers for these agents and flows.",
      href: `${base}/settings?tab=policies#governance`,
      done: Boolean(f.owner),
    },
    {
      id: "eval",
      title: "Add an eval",
      why: "A test its agents must pass, like a unit test.",
      href: `${base}/evals`,
      done: f.evals > 0,
    },
    {
      id: "notify",
      title: "Get told when a run fails",
      why: "notify: sends failures and approvals to an email or a webhook.",
      href: `${base}/settings?tab=policies#observability`,
      done: f.notify,
    },
  ];
  const items = raw.map((i) => ({ ...i, hidden: hidden.includes(i.id) }));
  const done = items.filter((i) => i.done).length;
  const dismissed = prefs.dismissed === true;
  return {
    workspace: f.workspace,
    items,
    done,
    total: items.length,
    complete: done === items.length,
    dismissed,
    show: !dismissed && items.some((i) => !i.done && !i.hidden),
  };
}
