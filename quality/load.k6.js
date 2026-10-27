// Load on the quality stack (27 Oct 2026), in five shapes:
//
//   smoke   a few users for 30 s — the script and the stack work at all
//   load    the expected busy hour: 30 users for 5 min, with latency budgets
//   stress  past it: up to 200 users — find where it bends; no 5xx allowed
//   spike   0 → 300 users in 10 s and back — survive a burst, recover
//   soak    20 users for 60 min — no leak, no slow creep
//
//   docker run --rm --network host -v "$PWD/quality:/q" -e PROFILE=load \
//     -e QUALITY_URL -e QUALITY_TOKEN grafana/k6 run /q/load.k6.js
//
// A 429 is the platform's rate limit doing its job, not a failure; a 5xx
// always is. Runs started here hit the fake model, so they cost nothing.
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const BASE = __ENV.QUALITY_URL;
const TOKEN = __ENV.QUALITY_TOKEN;
const WS = __ENV.QUALITY_WS || "quality-load";
const PROFILE = __ENV.PROFILE || "smoke";

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));
const serverErrors = new Rate("server_errors");
// Run submissions on their own: six a minute would vanish in the reads'
// check rate, so a broken write path gets its own threshold (Codex review).
const runAccepted = new Rate("run_accepted");
const limited = new Rate("rate_limited");

const shapes = {
  smoke: { executor: "constant-vus", vus: 3, duration: "30s" },
  load: { executor: "ramping-vus", stages: [{ duration: "1m", target: 30 }, { duration: "3m", target: 30 }, { duration: "1m", target: 0 }] },
  stress: { executor: "ramping-vus", stages: [{ duration: "2m", target: 50 }, { duration: "2m", target: 100 }, { duration: "2m", target: 200 }, { duration: "2m", target: 0 }] },
  spike: { executor: "ramping-vus", stages: [{ duration: "10s", target: 300 }, { duration: "1m", target: 300 }, { duration: "10s", target: 0 }, { duration: "1m", target: 0 }] },
  soak: { executor: "constant-vus", vus: 20, duration: "60m" },
};

/** A shape's whole length in seconds: its duration, or its stages added up. */
function lengthOf(shape) {
  const secs = (d) => Number(d.replace(/(\d+)([smh])/g, (_, n, u) => String(Number(n) * { s: 1, m: 60, h: 3600 }[u])));
  return shape.duration ? `${secs(shape.duration)}s` : `${shape.stages.reduce((t, st) => t + secs(st.duration), 0)}s`;
}

const budgets = {
  // Every profile: nothing breaks.
  server_errors: ["rate==0"],
  checks: ["rate>0.99"],
  run_accepted: ["rate>0.99"],
};
if (PROFILE === "load" || PROFILE === "smoke") {
  // The busy hour is what users feel: these are the budgets.
  budgets["http_req_duration{kind:read}"] = ["p(95)<800", "p(99)<2000"];
  budgets["http_req_duration{kind:health}"] = ["p(95)<200"];
  budgets["rate_limited"] = ["rate<0.05"];
}

export const options = {
  scenarios: {
    traffic: { ...shapes[PROFILE], exec: "traffic" },
    // Runs started alongside: the queue and the run containers under load,
    // at a rate a busy account could reach.
    runs: { executor: "constant-arrival-rate", rate: PROFILE === "soak" ? 2 : 6, timeUnit: "1m", duration: lengthOf(shapes[PROFILE]), preAllocatedVUs: 2, exec: "startRun" },
  },
  thresholds: budgets,
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

const auth = { headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } };
const tagged = (kind) => ({ ...auth, tags: { kind } });

function record(res) {
  serverErrors.add(res.status >= 500);
  limited.add(res.status === 429);
  return res;
}

export function traffic() {
  const h = record(http.get(`${BASE}/api/healthz`, { tags: { kind: "health" } }));
  check(h, { "health 200": (r) => r.status === 200 });
  const pick = Math.random();
  let r;
  if (pick < 0.4) r = record(http.get(`${BASE}/api/workspaces`, tagged("read")));
  else if (pick < 0.7) r = record(http.get(`${BASE}/api/workspaces/${WS}/runs`, tagged("read")));
  else if (pick < 0.85) r = record(http.get(`${BASE}/api/workspaces/${WS}/flows`, tagged("read")));
  else r = record(http.get(`${BASE}/api/openapi.json`, tagged("read")));
  check(r, { "read answered (or rate limited)": (x) => x.status === 200 || x.status === 429 });
  sleep(0.5 + Math.random());
}

export function startRun() {
  const r = record(http.post(`${BASE}/api/workspaces/${WS}/flows/hello/run`, "{}", { ...auth, headers: { ...auth.headers, "idempotency-key": `load-${__VU}-${__ITER}-${Date.now()}` }, tags: { kind: "write" } }));
  const ok = r.status === 200 || r.status === 201 || r.status === 202;
  runAccepted.add(ok);
  check(r, { "run accepted": () => ok });
}
