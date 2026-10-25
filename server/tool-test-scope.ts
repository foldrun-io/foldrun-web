// What the Test button can and cannot exercise from the web tier.
//
// Search on a k8s install runs in the account's own search pod, and that pod
// admits run pods only; the web tier has neither the permission to create it
// nor a network path to it, and should not be given either. So a Test of the
// search tool from here can only ever reach the old shared address, which is
// scaled to zero, and report "unreachable" about a tool that works in every
// run. Say where it can be tested instead.

export interface TestRefusal {
  ok: false;
  transport: "script";
  missingSecrets: string[];
  summary: string;
  detail: string;
}

export function testableHere(tool: string, env: Record<string, string | undefined> = process.env): TestRefusal | null {
  const perAccountSearch = env.FOLDRUN_SEARCH_PER_ACCOUNT === "1" && env.FOLDRUN_RUN_ISOLATION === "k8s";
  // `web` searches the account's engine.
  if (tool !== "web" || !perAccountSearch) return null;
  return {
    ok: false,
    transport: "script",
    missingSecrets: [],
    summary: "search is tested inside a run, not from here",
    detail:
      "This install gives every account its own search engine, reachable only from a run's sandbox.\n\n" +
      "Test it with a test run of a flow whose agent has `web` in tools:, e.g.\n" +
      "  foldrun invoke <flow> --to <workspace> --test --wait",
  };
}
