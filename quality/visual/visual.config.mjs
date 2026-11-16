// The dashboard's look, compared with committed baselines (FOL-196, 16 Nov
// 2026). Run by quality/visual.sh inside Microsoft's Playwright image, so
// the browser, fonts and renderer are the same on every machine — the
// baselines are made by CI on Linux (quality/README.md), never on a laptop.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.mjs/,
  outputDir: process.env.VISUAL_OUT || "/reports/visual",
  // One baseline per page and theme: baselines/<name>-<light|dark>.png.
  snapshotPathTemplate: "{testDir}/baselines/{arg}-{projectName}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      // A fixed number, not a share of the page: CI shoots in the same
      // Playwright image every time, so an unchanged page differs by a few
      // anti-aliased pixels at most, while a share grows with the page
      // (0.2% of a tall page hid a letter-spacing change on every heading).
      maxDiffPixels: 100,
      threshold: 0.2,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    viewport: { width: 1360, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  },
  projects: [
    { name: "light", use: { colorScheme: "light" } },
    { name: "dark", use: { colorScheme: "dark" } },
  ],
});
