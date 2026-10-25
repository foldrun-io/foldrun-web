// A scope's defaults, read from frontmatter and checked on the way in.

import test from "node:test";
import assert from "node:assert/strict";
import { defaultsOf, defaultsPatch } from "../components/defaults-model.ts";

test("defaults read out of frontmatter, with the notify events defaulted", () => {
  assert.deepEqual(defaultsOf({ timezone: "Australia/Sydney", budget: "40", concurrency: 3, notify: { email: "x@y.z" } }), {
    timezone: "Australia/Sydney",
    budget: { usd: 40, period: "month" },
    concurrency: 3,
    notify: { email: "x@y.z", events: ["failed", "awaiting-approval"] },
    deployBlock: null,
    networkEnforce: false,
    telemetry: null,
    owner: null,
    alerts: null,
    judge: null,
  });
  assert.deepEqual(defaultsOf({}), { timezone: null, budget: null, concurrency: null, notify: null, deployBlock: null, networkEnforce: false, telemetry: null, owner: null, alerts: null, judge: null });
  assert.equal(defaultsOf({ concurrency: "2.5" }).concurrency, null, "runs are whole");
  assert.equal(defaultsOf({ concurrency: 0 }).concurrency, null);
});

test("a patch touches only the keys sent, and refuses bad values whole", () => {
  assert.deepEqual(defaultsPatch({ budget: "12.5" }), { keys: { budget: 12.5 } }, "a month is the bare number, as the file has always read");
  assert.deepEqual(defaultsPatch({ budget: "12.5/day" }), { keys: { budget: "12.5/day" } });
  assert.deepEqual(defaultsPatch({ budget: { usd: 60, period: "week" } }), { keys: { budget: "60/week" } });
  assert.deepEqual(defaultsPatch({ budget: "" }), { keys: { budget: null } });
  assert.deepEqual(defaultsPatch({ budget: "unlimited" }), { keys: { budget: null } }, "unlimited is the key removed — unset means no limit");
  assert.ok("error" in defaultsPatch({ budget: "abc" }));
  assert.match((defaultsPatch({ budget: "5/run" }) as { error: string }).error, /does not apply|per run/);
  assert.deepEqual(defaultsOf({ budget: "60/day" }).budget, { usd: 60, period: "day" });
  assert.equal(defaultsOf({ budget: "unlimited" }).budget, null);
  assert.deepEqual(defaultsPatch({ concurrency: "4" }), { keys: { concurrency: 4 } });
  assert.deepEqual(defaultsPatch({ concurrency: "" }), { keys: { concurrency: null } });
  assert.ok("error" in defaultsPatch({ concurrency: "1.5" }));
  assert.ok("error" in defaultsPatch({ concurrency: 0 }));
  assert.ok("error" in defaultsPatch({ concurrency: 999 }));
  assert.ok("error" in defaultsPatch({ timezone: "Mars/Olympus" }));
  assert.deepEqual(defaultsPatch({ timezone: "UTC" }), { keys: { timezone: "UTC" } });
  assert.ok("error" in defaultsPatch({}));
});

test("notify needs a destination and an event, and keeps a secret-named URL", () => {
  assert.ok("error" in defaultsPatch({ notify: { events: ["failed"] } }));
  assert.ok("error" in defaultsPatch({ notify: { email: "nope", events: ["failed"] } }));
  assert.ok("error" in defaultsPatch({ notify: { url: "ftp://x", events: ["failed"] } }));
  assert.ok("error" in defaultsPatch({ notify: { email: "a@b.co", events: [] } }));
  assert.deepEqual(defaultsPatch({ notify: { url: "${SLACK_WEBHOOK_URL}", email: "", events: ["failed", "bogus", "completed"] } }), {
    keys: { notify: { url: "${SLACK_WEBHOOK_URL}", events: ["failed", "completed"] } },
  });
  assert.deepEqual(defaultsPatch({ notify: null }), { keys: { notify: null } });
});

test("deploy_block (FOL-58): read when it is a mode, patched or cleared, anything else refused", () => {
  assert.equal(defaultsOf({ deploy_block: "secrets" }).deployBlock, "secrets");
  assert.equal(defaultsOf({ deploy_block: "strict" }).deployBlock, null);
  assert.deepEqual(defaultsPatch({ deploy_block: "security" }), { keys: { deploy_block: "security" } });
  assert.deepEqual(defaultsPatch({ deploy_block: null }), { keys: { deploy_block: null } });
  assert.match((defaultsPatch({ deploy_block: "strict" }) as { error: string }).error, /none, secrets, security/);
});

test("network_enforce: only true is on; false or null removes the key; anything else is refused", () => {
  assert.equal(defaultsOf({ network_enforce: true }).networkEnforce, true);
  assert.equal(defaultsOf({ network_enforce: "true" }).networkEnforce, false);
  assert.deepEqual(defaultsPatch({ network_enforce: true }), { keys: { network_enforce: true } });
  assert.deepEqual(defaultsPatch({ network_enforce: false }), { keys: { network_enforce: null } });
  assert.match((defaultsPatch({ network_enforce: "yes" }) as { error: string }).error, /true or false/);
});

test("telemetry: an https collector and secret-named headers are kept; a written-in token is refused", () => {
  const t = { otlp: "https://otel.example.com/v1/traces", headers: { authorization: "${OTEL_TOKEN}" } };
  assert.deepEqual(defaultsOf({ telemetry: t }).telemetry, { endpoint: t.otlp, headers: { authorization: "${OTEL_TOKEN}" } });
  assert.deepEqual(defaultsPatch({ telemetry: t }), { keys: { telemetry: t } });
  assert.deepEqual(defaultsPatch({ telemetry: null }), { keys: { telemetry: null } });
  assert.match((defaultsPatch({ telemetry: { otlp: "https://x.io/v1/traces", headers: { authorization: "Bearer abc" } } }) as { error: string }).error, /put it in the vault/);
});

test("the four jobs' new defaults: owner, alerts as written, judge — read, patched, refused when wrong", () => {
  const d = defaultsOf({ owner: " ops@acme.io ", alerts: { failure_rate: "30%", new_host: true, min_runs: 5 }, judge: { model: "max" } });
  assert.equal(d.owner, "ops@acme.io");
  assert.deepEqual(d.alerts, { failure_rate: "30%", min_runs: 5, new_host: true });
  assert.deepEqual(d.judge, { model: "max" });
  assert.deepEqual(defaultsPatch({ owner: "" }), { keys: { owner: null } });
  assert.deepEqual(defaultsPatch({ alerts: { failure_rate: "30%", stale_days: "" } }), { keys: { alerts: { failure_rate: "30%" } } }, "blank thresholds are left out");
  // A workspace's own alerts: false turns off what the account has on, {}
  // is "none here", null goes back to the account's.
  assert.deepEqual(defaultsPatch({ alerts: { new_host: false } }), { keys: { alerts: { new_host: false } } });
  assert.deepEqual(defaultsPatch({ alerts: {} }), { keys: { alerts: {} } });
  assert.deepEqual(defaultsPatch({ alerts: null }), { keys: { alerts: null } });
  assert.deepEqual(defaultsOf({ alerts: {} }).alerts, {}, "an empty block reads as empty, not as unset");
  assert.equal(defaultsOf({}).alerts, null);
  assert.match((defaultsPatch({ alerts: { cost_spike: 1 } }) as { error: string }).error, /cost_spike 1 — a number, at least 1.5/);
  assert.deepEqual(defaultsPatch({ judge: { model: "fast", effort: "" } }), { keys: { judge: { model: "fast" } } });
  assert.match((defaultsPatch({ judge: { temperature: 1 } }) as { error: string }).error, /temperature — not a key/);
});
