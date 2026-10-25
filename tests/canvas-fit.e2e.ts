// In a real browser: a flow card that starts collapsed, expanded, draws
// every step of a 5-step flow inside the canvas — the opening view is fitted
// once the card body has a width, not while it was hidden at 0px (which left
// steps 1–4 off to the left and a band of empty canvas above them). Also
// that the pane is no taller than the drawing needs.
//
// Opt-in, outside `npm test` (the name has e2e in it): it needs Chromium and
// a dashboard to drive.
//
//   FOLDRUN_CANVAS_E2E=1 node --import ./tests/register.mjs --test tests/canvas-fit.e2e.ts
//
// Starts `next dev` on a free port against a temporary FOLDRUN_DATA, unless
// CANVAS_E2E_URL and CANVAS_E2E_DATA name a dashboard already running (dev
// mode, no auth) and the data directory it reads. PLAYWRIGHT_CORE points at a
// playwright-core module and CHROME_PATH at a Chromium binary when they are
// not where Node and Playwright would find them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";

const ON = process.env.FOLDRUN_CANVAS_E2E === "1";
const WEB = path.join(import.meta.dirname, "..");

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

test("a collapsed card, expanded: all five steps inside the canvas, no empty band", { skip: !ON && "set FOLDRUN_CANVAS_E2E=1" }, async () => {
  const data = process.env.CANVAS_E2E_DATA ?? fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-canvas-e2e-"));
  const ws = path.join(data, "default", "workspaces", "fit-check");
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: fit-check\n---\n");
  const names = ["fetcher", "cleaner", "enricher", "scorer", "writer"];
  for (const a of names) {
    fs.mkdirSync(path.join(ws, "agents", a), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", a, "agent.md"), `---\nname: ${a}\ndescription: The ${a}.\nmodel: default\n---\n\nYou are the ${a}.\n`);
  }
  fs.writeFileSync(path.join(ws, "flows", "five.md"), `---\nname: five\n---\n\n${names.map((a, i) => `${i + 1}. [[${a}]] — step ${i + 1}`).join("\n")}\n`);

  let server: ChildProcess | null = null;
  let base = process.env.CANVAS_E2E_URL;
  if (!base) {
    const port = await freePort();
    base = `http://localhost:${port}`;
    server = spawn("npx", ["next", "dev", "-p", String(port)], {
      cwd: WEB,
      env: { ...process.env, FOLDRUN_DATA: data, FOLDRUN_DEV_NO_AUTH: "1", FOLDRUN_DISABLE_SCHEDULER: "1", FOLDRUN_DISABLE_WORKER: "1" },
      stdio: "ignore",
    });
  }
  const req = createRequire(process.env.PLAYWRIGHT_CORE ? path.join(process.env.PLAYWRIGHT_CORE, "..", "x") : import.meta.filename);
  // Typed by hand: playwright-core is not a dependency of this repo.
  type Box = { left: number; top: number; right: number; bottom: number };
  type Loc = {
    first(): Loc;
    nth(i: number): Loc;
    locator(sel: string): Loc;
    click(): Promise<void>;
    getAttribute(n: string): Promise<string | null>;
    waitFor(): Promise<void>;
    boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
    evaluateAll(fn: (els: Element[]) => Box[]): Promise<Box[]>;
  };
  type Page = {
    goto(u: string, o: { waitUntil: string }): Promise<{ ok(): boolean } | null>;
    locator(sel: string, o?: { has: Loc }): Loc;
    waitForTimeout(ms: number): Promise<void>;
  };
  const { chromium } = req(process.env.PLAYWRIGHT_CORE ?? "playwright-core") as {
    chromium: { launch(o: object): Promise<{ newPage(o: object): Promise<Page>; close(): Promise<void> }> };
  };
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    for (let i = 0; i < 60; i++) {
      const ok = await page.goto(`${base}/dashboard/fit-check/flows`, { waitUntil: "load" }).then((r) => r?.ok()).catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const card = page.locator("section", { has: page.locator('button[aria-expanded] >> text="five"') }).first();
    const toggle = card.locator("button[aria-expanded]").first();
    // Shut first, so the canvas mounts inside a body that was hidden.
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
    await toggle.click();
    await card.locator(".react-flow__node-step").nth(4).waitFor();
    await page.waitForTimeout(800);
    const pane = (await card.locator(".react-flow").first().boundingBox())!;
    const boxes = await card.locator(".react-flow__node-step").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }),
    );
    assert.equal(boxes.length, 5);
    for (const [i, b] of boxes.entries()) {
      assert.ok(b.left >= pane.x - 1 && b.right <= pane.x + pane.width + 1, `step ${i + 1} is outside the canvas horizontally`);
      assert.ok(b.top >= pane.y - 1 && b.bottom <= pane.y + pane.height + 1, `step ${i + 1} is outside the canvas vertically`);
    }
    const drawn = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
    assert.ok(pane.height - drawn < 140, `the canvas is ${Math.round(pane.height)}px tall for ${Math.round(drawn)}px of steps`);
  } finally {
    await browser.close();
    server?.kill();
    if (!process.env.CANVAS_E2E_DATA) fs.rmSync(data, { recursive: true, force: true });
    else fs.rmSync(ws, { recursive: true, force: true });
  }
});

// A flow too wide for the opening fit (9 steps): the Fit button brings every
// step into view, Full screen fills the screen with all of it, and the
// library's attribution badge is not drawn (owner, 1 Oct: "the expand
// button doesn't work", "why is it written React Flow").
test("Fit shows all nine steps, Full screen fills the screen, no attribution", { skip: !ON && "set FOLDRUN_CANVAS_E2E=1" }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-canvas-e2e-"));
  const ws = path.join(data, "default", "workspaces", "wide-check");
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: wide-check\n---\n");
  const names = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"];
  for (const a of names) {
    fs.mkdirSync(path.join(ws, "agents", a), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", a, "agent.md"), `---\nname: ${a}\ndescription: The ${a}.\nmodel: default\n---\n\nYou are ${a}.\n`);
  }
  fs.writeFileSync(path.join(ws, "flows", "nine.md"), `---\nname: nine\n---\n\n${names.map((a, i) => `${i + 1}. [[${a}]] — step ${i + 1}`).join("\n")}\n`);
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const server = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: WEB,
    env: { ...process.env, FOLDRUN_DATA: data, FOLDRUN_DEV_NO_AUTH: "1", FOLDRUN_DISABLE_SCHEDULER: "1", FOLDRUN_DISABLE_WORKER: "1" },
    stdio: "ignore",
  });
  const req = createRequire(process.env.PLAYWRIGHT_CORE ? path.join(process.env.PLAYWRIGHT_CORE, "..", "x") : import.meta.filename);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { chromium } = req(process.env.PLAYWRIGHT_CORE ?? "playwright-core") as any;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    for (let i = 0; i < 60; i++) {
      const ok = await page.goto(`${base}/dashboard/wide-check/flows`, { waitUntil: "load" }).then((r: { ok(): boolean } | null) => r?.ok()).catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const card = page.locator("section", { has: page.locator('button[aria-expanded] >> text="nine"') }).first();
    const toggle = card.locator("button[aria-expanded]").first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await card.locator(".react-flow__node-step").nth(8).waitFor();
    await page.waitForTimeout(800);
    const inside = async () => {
      const pane = await card.locator(".react-flow").first().boundingBox();
      const boxes = await card.locator(".react-flow__node-step").evaluateAll((els: Element[]) =>
        els.map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }));
      return { pane, boxes, all: boxes.every((b: { left: number; right: number; top: number; bottom: number }) =>
        b.left >= pane.x - 1 && b.right <= pane.x + pane.width + 1 && b.top >= pane.y - 1 && b.bottom <= pane.y + pane.height + 1) };
    };
    assert.equal(await card.locator(".react-flow__attribution").count(), 0, "no React Flow badge");
    await card.locator('button[aria-label="Fit the whole flow"]').click();
    await page.waitForTimeout(600);
    const fitted = await inside();
    assert.equal(fitted.boxes.length, 9);
    assert.ok(fitted.all, "after Fit, every step is inside the canvas");
    await card.locator('button[aria-label="Full screen"]').click();
    await page.waitForTimeout(900);
    const full = await inside();
    assert.ok(full.pane.height > 900, `full screen pane is ${Math.round(full.pane.height)}px tall`);
    assert.ok(full.all, "in full screen, every step is inside");
    await page.keyboard.press("Escape");
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
