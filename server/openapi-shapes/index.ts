// Every group's schema file, for server/openapi.ts to merge.

import { SHAPES as account } from "./account.ts";
import { SHAPES as people } from "./people.ts";
import { SHAPES as billingKeys } from "./billing-keys.ts";
import { SHAPES as platform } from "./platform.ts";
import { SHAPES as runs } from "./runs.ts";
import { SHAPES as flows } from "./flows.ts";
import { SHAPES as workspaceA } from "./workspace-a.ts";
import { SHAPES as workspaceB } from "./workspace-b.ts";

export const GROUP_SHAPES = [account, people, billingKeys, platform, runs, flows, workspaceA, workspaceB];
