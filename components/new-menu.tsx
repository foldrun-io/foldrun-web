"use client";

// "New", top right: one menu for everything a person can create, scoped to
// where they are. Inside a workspace it makes things in that workspace;
// elsewhere it offers a workspace and the account's shared tools and skills.
// Each item opens the existing create dialog on its own page (?create=<kind>),
// so there is one create flow per noun, not two. Hidden for viewers.

import { $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bot, Boxes, FlaskConical, Plus, Webhook, Workflow, Wrench, BookOpen } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@foldrun/ui/react/menu";
import { Button } from "@foldrun/ui/react/button";
import { workspaceOf } from "./nav-model";
import { useCan } from "./role";

export function NewMenu() {
  const pathname = usePathname();
  const params = useSearchParams();
  const mayWrite = useCan("workspace:write");
  if (!mayWrite) return null;
  const tenant = params.get("tenant") ?? "default";
  const t = tenant !== "default" ? `&tenant=${tenant}` : "";
  const workspace = workspaceOf(pathname);
  const base = workspace ? `/dashboard/${workspace}` : null;

  const inWorkspace = base
    ? [
        { name: $t("components.new-menu.flow"), hint: $t("components.new-menu.stepsThatRunInOrder"), href: `${base}/flows?create=flows${t}`, icon: Workflow },
        { name: $t("components.new-menu.agent"), hint: $t("components.new-menu.aRoleWithAModelAnd"), href: `${base}/agents?create=agents${t}`, icon: Bot },
        { name: $t("components.new-menu.eval"), hint: $t("components.new-menu.testsForAnAgent"), href: `${base}/evals?create=evals${t}`, icon: FlaskConical },
        { name: $t("components.new-menu.tool"), hint: $t("components.new-menu.codeAnAgentCanCall"), href: `${base}/assets?kind=tools&create=tools${t}`, icon: Wrench },
        { name: $t("components.new-menu.hook"), hint: $t("components.new-menu.yourCodeAtEveryToolCall"), href: `${base}/assets?kind=hooks&create=hooks${t}`, icon: Webhook },
      ]
    : [
        { name: $t("components.new-menu.sharedTool"), hint: $t("components.new-menu.forEveryWorkspace"), href: `/dashboard/library?kind=tools&create=tools${t}`, icon: Wrench },
        { name: $t("components.new-menu.sharedSkill"), hint: $t("components.new-menu.aProcedureAnyAgentCanFollow"), href: `/dashboard/library?kind=skills&create=skills${t}`, icon: BookOpen },
      ];

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-fg">
          <Plus className="size-4" />
          {$t("components.new-menu.createNew")}
        </Button>
      </MenuTrigger>
      <MenuContent className="w-72">
        {workspace && <MenuLabel>{$t("components.new-menu.in", { workspace: workspace })}</MenuLabel>}
        {inWorkspace.map((i) => (
          <MenuItem key={i.name} asChild>
            <Link href={i.href} className="items-start!">
              <i.icon className="mt-0.5" />
              <span className="flex flex-col">
                <span className="text-fg">{i.name}</span>
                <span className="text-xs text-fg-muted">{i.hint}</span>
              </span>
            </Link>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem asChild>
          <Link href={`/dashboard?create=workspace${t}`} className="items-start!">
            <Boxes className="mt-0.5" />
            <span className="flex flex-col">
              <span className="text-fg">{$t("components.new-menu.workspace")}</span>
              <span className="text-xs text-fg-muted">{$t("components.new-menu.itsOwnAgentsFlowsSecretsAnd")}</span>
            </span>
          </Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
