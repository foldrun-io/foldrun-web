// The dashboard in a real browser (27 Oct 2026): sign in as the stack's
// owner, land on the dashboard, open the e2e workspace's runs — with no
// error in the browser console and no failed request along the way.
//
// And the content security policy (28 Oct 2026), which is enforced: every
// page answers with it and a fresh nonce, is not cacheable, raises no
// violation (a listener is in every document before its first script), and
// still works — the docs and help pages included, which render per request
// from the markdown in the image, and in-app navigation across them.
//
//   bash quality/browser.sh   (runs this inside the Playwright image)
import { chromium } from "playwright";

const base = process.env.QUALITY_URL;
const ws = process.env.QUALITY_WS || "quality-load";
const problems = [];
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI || "inline"} (${e.disposition})`));
});
const page = await context.newPage();
const nonces = new Set();
// A document's headers: the policy enforced, with a nonce, never cached.
const policed = (res, what) => {
  if (!res) throw new Error(`${what}: no response`);
  if (res.status() >= 400) throw new Error(`${what}: HTTP ${res.status()}`);
  const h = res.headers();
  const policy = h["content-security-policy"];
  if (!policy) throw new Error(`${what}: no enforced Content-Security-Policy`);
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  if (!nonce) throw new Error(`${what}: the policy has no nonce`);
  if (nonces.has(nonce)) throw new Error(`${what}: a nonce was served twice`);
  nonces.add(nonce);
  if (!/no-store|private/.test(h["cache-control"] ?? "")) throw new Error(`${what}: cacheable (${h["cache-control"]})`);
};
const violations = async (what) => {
  const v = await page.evaluate(() => window.__csp.splice(0));
  for (const x of v) problems.push(`CSP on ${what}: ${x}`);
};
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });

const step = async (what, fn) => {
  try {
    await fn();
    console.log(`ok   ${what}`);
  } catch (e) {
    problems.push(`${what}: ${e.message.split("\n")[0]}`);
    console.log(`FAIL ${what}`);
  }
};

await step("the sign-in page renders under the enforced policy", async () => {
  policed(await page.goto(`${base}/login`), "/login");
  await page.getByLabel(/email/i).waitFor({ timeout: 30000 });
  await violations("/login");
});
await step("the owner signs in and lands on the dashboard", async () => {
  await page.getByLabel(/email/i).fill(process.env.QUALITY_EMAIL);
  await page.getByLabel(/password/i).fill(process.env.QUALITY_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in|continue/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  await violations("the dashboard after sign-in");
});
await step("a run exists to look at (started through the API)", async () => {
  const r = await fetch(`${base}/api/workspaces/${ws}/flows/hello/run?wait=true&timeout=300`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.QUALITY_TOKEN}`, "content-type": "application/json", "idempotency-key": `browser-${Date.now()}` },
    body: "{}",
  });
  if (r.status !== 200) throw new Error(`the seed run answered HTTP ${r.status}`);
});
await step("the workspace's runs page lists the run", async () => {
  policed(await page.goto(`${base}/dashboard/${ws}/runs`), "runs");
  await page.getByText(/hello/i).first().waitFor({ timeout: 30000 });
  await violations("runs");
});
await step("the settings page renders", async () => {
  // Not "network idle": a dashboard page may hold a live connection open.
  policed(await page.goto(`${base}/dashboard/settings`, { waitUntil: "domcontentloaded" }), "/dashboard/settings");
  await page.getByText(/settings/i).first().waitFor({ timeout: 30000 });
  await violations("/dashboard/settings");
});

for (const [path, text] of [
  ["/dashboard/docs", /docs/i],
  ["/dashboard/docs/flows", /flow/i],
  ["/dashboard/docs/api-reference", /api/i],
  ["/dashboard/help", /how foldrun reads your files/i],
  ["/dashboard/help/notes/README", /foldrun/i],
]) {
  await step(`${path} renders per request, with no violation`, async () => {
    policed(await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" }), path);
    await page.getByText(text).first().waitFor({ timeout: 30000 });
    await violations(path);
  });
}
await step("in-app navigation from the docs to the runs keeps working", async () => {
  await page.goto(`${base}/dashboard/docs`, { waitUntil: "domcontentloaded" });
  await page.locator(`a[href$="/${ws}/runs"], a[href*="/runs"]`).first().click({ timeout: 30000 });
  await page.waitForURL(/\/runs/, { timeout: 30000 });
  await page.getByText(/hello/i).first().waitFor({ timeout: 30000 });
  await violations("docs → runs");
});
await step("a second load of a page gets a new nonce", async () => {
  policed(await page.goto(`${base}/dashboard/settings`, { waitUntil: "domcontentloaded" }), "/dashboard/settings (again)");
  await violations("/dashboard/settings");
});

await browser.close();
if (problems.length) {
  console.log(problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("browser: all ok");
