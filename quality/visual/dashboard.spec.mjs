// Key dashboard pages, light and dark, against committed baselines
// (FOL-196). Runs first on a fresh quality stack (quality/run.sh), so the
// data is always the same: one account, the `hello` fixture workspace, no
// runs. What differs between two runs by nature — the version, times, ids —
// is masked; everything else is compared.
import { test, expect } from "@playwright/test";

const base = process.env.QUALITY_URL;
const ws = process.env.QUALITY_WS || "quality-load";
const email = process.env.QUALITY_EMAIL;
const password = process.env.QUALITY_PASSWORD;

// Never the same twice: masked as boxes, compared as boxes.
const VOLATILE = [
  "time",
  "[data-volatile]",
  "[data-version]",
  "[data-testid='version']",
];

const settle = async (page) => {
  await page.waitForLoadState("networkidle");
  // Web fonts and images done before the shot.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
};

const shoot = async (page, name, extra = []) => {
  await settle(page);
  const mask = [...VOLATILE, ...extra].map((s) => page.locator(s));
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: false, mask });
};

test.beforeEach(async ({ page }) => {
  // Every clock the page reads is the same day: relative times read alike.
  await page.clock.install({ time: new Date("2026-11-16T09:00:00Z") });
});

test("sign-in page", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel(/email/i).waitFor();
  await shoot(page, "login");
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${base}/login`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click();
    await page.waitForURL(/\/dashboard/);
  });

  const pages = [
    ["workspaces", "/dashboard"],
    ["workspace", `/dashboard/${ws}`],
    ["flows", `/dashboard/${ws}/flows`],
    ["agents", `/dashboard/${ws}/agents`],
    ["runs", "/dashboard/runs"],
    ["settings", "/dashboard/settings"],
    ["docs", "/dashboard/docs"],
  ];
  for (const [name, path] of pages) {
    test(name, async ({ page }) => {
      await page.goto(`${base}${path}`);
      await shoot(page, name);
    });
  }
});
