// The dashboard in a real browser (27 Oct 2026): sign in as the stack's
// owner, land on the dashboard, open the e2e workspace's runs — with no
// error in the browser console and no failed request along the way.
//
//   bash quality/browser.sh   (runs this inside the Playwright image)
import { chromium } from "playwright";

const base = process.env.QUALITY_URL;
const ws = process.env.QUALITY_WS || "quality-load";
const problems = [];
const browser = await chromium.launch();
const page = await browser.newPage();
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

await step("the sign-in page renders", async () => {
  await page.goto(`${base}/login`);
  await page.getByLabel(/email/i).waitFor({ timeout: 30000 });
});
await step("the owner signs in and lands on the dashboard", async () => {
  await page.getByLabel(/email/i).fill(process.env.QUALITY_EMAIL);
  await page.getByLabel(/password/i).fill(process.env.QUALITY_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in|continue/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
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
  await page.goto(`${base}/dashboard/${ws}/runs`);
  await page.getByText(/hello/i).first().waitFor({ timeout: 30000 });
});
await step("the settings page renders", async () => {
  // Not "network idle": a dashboard page may hold a live connection open.
  await page.goto(`${base}/dashboard/settings`, { waitUntil: "domcontentloaded" });
  await page.getByText(/settings/i).first().waitFor({ timeout: 30000 });
});

await browser.close();
if (problems.length) {
  console.log(problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("browser: all ok");
