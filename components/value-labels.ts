// The words for values the code compares (a run's status, a role, a webhook
// outcome): the code keeps the value, the page shows its label from
// messages/<locale>/values.json. Owner, 17 Nov 2026: no language hard-coded
// in the dashboard. A value in no map is shown as itself (forward-compatible
// with a value the server adds before the dashboard knows it).
//
// File syntax (network: trusted, size: large, transport: mcp, an eval's
// contains:) is not here: the page shows what the person writes in the file.

import { $t, localized } from "@/i18n";

/** The label for a value, or the value itself when it has none yet. */
export function labelOf(map: Readonly<Record<string, string>>, value: string): string {
  return map[value] ?? value;
}

export const RUN_STATUS_LABEL: Readonly<Record<string, string>> = localized(() => ({ "queued": $t("values.runStatus.queued"), "running": $t("values.runStatus.running"), "awaiting-approval": $t("values.runStatus.awaitingApproval"), "completed": $t("values.runStatus.completed"), "failed": $t("values.runStatus.failed"), "stopped": $t("values.runStatus.stopped") }));

export const STEP_STATUS_LABEL: Readonly<Record<string, string>> = localized(() => ({ "pending": $t("values.stepStatus.pending"), "awaiting-approval": $t("values.stepStatus.awaitingApproval"), "running": $t("values.stepStatus.running"), "completed": $t("values.stepStatus.completed"), "failed": $t("values.stepStatus.failed"), "skipped": $t("values.stepStatus.skipped") }));

export const EVAL_RESULT_LABEL: Readonly<Record<string, string>> = localized(() => ({ "pass": $t("values.evalResult.pass"), "fail": $t("values.evalResult.fail"), "error": $t("values.evalResult.error") }));

export const TARGET_KIND_LABEL: Readonly<Record<string, string>> = localized(() => ({ "agent": $t("values.targetKind.agent"), "flow": $t("values.targetKind.flow"), "eval": $t("values.targetKind.eval") }));

export const FILE_CHANGE_LABEL: Readonly<Record<string, string>> = localized(() => ({ "added": $t("values.fileChange.added"), "updated": $t("values.fileChange.updated"), "removed": $t("values.fileChange.removed"), "created": $t("values.fileChange.created"), "deleted": $t("values.fileChange.deleted"), "edited": $t("values.fileChange.edited"), "new": $t("values.fileChange.new"), "changed": $t("values.fileChange.changed") }));

export const LINK_STATE_LABEL: Readonly<Record<string, string>> = localized(() => ({ "live": $t("values.linkState.live"), "reconnecting": $t("values.linkState.reconnecting"), "connecting": $t("values.linkState.connecting"), "closed": $t("values.linkState.closed"), "last": $t("values.linkState.last") }));

export const WEBHOOK_OUTCOME_LABEL: Readonly<Record<string, string>> = localized(() => ({ "error": $t("values.webhookOutcome.error"), "accepted": $t("values.webhookOutcome.accepted"), "invalid-token": $t("values.webhookOutcome.invalidToken"), "invalid-signature": $t("values.webhookOutcome.invalidSignature"), "not-webhook": $t("values.webhookOutcome.notWebhook"), "no-flow": $t("values.webhookOutcome.noFlow"), "dropped": $t("values.webhookOutcome.dropped") }));

export const DELIVERY_STATUS_LABEL: Readonly<Record<string, string>> = localized(() => ({ "failed": $t("values.deliveryStatus.failed"), "skipped": $t("values.deliveryStatus.skipped"), "delivered": $t("values.deliveryStatus.delivered"), "retrying": $t("values.deliveryStatus.retrying") }));

export const ISSUE_STATUS_LABEL: Readonly<Record<string, string>> = localized(() => ({ "acknowledged": $t("values.issueStatus.acknowledged"), "snoozed": $t("values.issueStatus.snoozed"), "resolved": $t("values.issueStatus.resolved") }));

export const SWITCH_LABEL: Readonly<Record<string, string>> = localized(() => ({ "on": $t("values.switch.on"), "off": $t("values.switch.off") }));

export const ROLE_LABEL: Readonly<Record<string, string>> = localized(() => ({ "viewer": $t("values.role.viewer"), "editor": $t("values.role.editor"), "admin": $t("values.role.admin"), "owner": $t("values.role.owner") }));

export const PROVIDER_VERDICT_LABEL: Readonly<Record<string, string>> = localized(() => ({ "ok": $t("values.providerVerdict.ok"), "credential": $t("values.providerVerdict.credential"), "not-found": $t("values.providerVerdict.notFound"), "busy": $t("values.providerVerdict.busy"), "unreachable": $t("values.providerVerdict.unreachable"), "provider-error": $t("values.providerVerdict.providerError") }));

export const TREND_LABEL: Readonly<Record<string, string>> = localized(() => ({ "up": $t("values.trend.up"), "down": $t("values.trend.down") }));

export const LINK_KIND_LABEL: Readonly<Record<string, string>> = localized(() => ({ "consult": $t("values.linkKind.consult"), "sub-agent": $t("values.linkKind.subAgent") }));
