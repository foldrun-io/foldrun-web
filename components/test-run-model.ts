// What a test run did instead of the real thing, read off its record.
//
// The run page's "Test run" panel is built from the events that carry an
// `effect` — the proxy's refusals and redirects, the write-back's diverted
// files, the runner's withheld secrets. Pure, so the shape of the panel is
// a test and not a screenshot.

import type { RunRecord } from "@/lib/store";
import type { TestEffect } from "../../foldrun-core/src/test-mode.ts";

export interface TestEffectRow extends TestEffect {
  /** Which step it happened in, by the trace's 1-based numbering. */
  step: number;
  agent: string;
}

/** Every effect on the run, in step order then event order. */
export function testEffects(run: Pick<RunRecord, "steps">): TestEffectRow[] {
  const out: TestEffectRow[] = [];
  run.steps.forEach((s, i) => {
    for (const e of s.events ?? []) {
      if (e.effect) out.push({ ...e.effect, step: i + 1, agent: s.agent });
    }
  });
  return out;
}

/** The panel's one-line count: "2 sends refused · 1 email redirected · 3 files diverted". */
export function testEffectSummary(effects: TestEffect[]): string {
  const n = (kind: TestEffect["kind"]) => effects.filter((e) => e.kind === kind).length;
  const parts = [
    [n("refused"), "send refused", "sends refused"],
    [n("redirected"), "email redirected", "emails redirected"],
    [n("diverted"), "file diverted", "files diverted"],
    [n("withheld"), "secret withheld", "secrets withheld"],
  ] as const;
  const said = parts.filter(([c]) => c > 0).map(([c, one, many]) => `${c} ${c === 1 ? one : many}`);
  return said.length ? said.join(" · ") : "nothing outward was attempted";
}
