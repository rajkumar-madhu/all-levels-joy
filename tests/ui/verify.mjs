import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// Use an existing Playwright install, or install Playwright locally before running.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
});
const artifacts = resolve(process.env.ITSM_UI_ARTIFACTS || "artifacts/itsm-ui.local");
await mkdir(artifacts, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(
    `${process.env.ITSM_UI_URL || "http://127.0.0.1:8081"}/tests/ui/incident-workbench.html`,
  );
  await page.getByRole("heading", { name: "Incident workspace" }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 8);
  await page.screenshot({ path: `${artifacts}/desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await page.getByText("No notifications yet.").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Unassigned 3$/ }).click();
  assert.equal(await page.locator("tbody tr").count(), 3);
  await page.getByRole("button", { name: /^Active 8$/ }).click();
  await page.getByRole("textbox", { name: "Search incident number or title" }).fill("VPN");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("button", { name: "Open INC0012846", exact: true }).click();
  assert.equal(
    await page.getByTestId("selected").innerText(),
    "50000000-0000-0000-0000-000000000002",
  );
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Filter by priority").selectOption("1");
  assert.equal(await page.locator("tbody tr").count(), 2);
  await page
    .getByRole("textbox", { name: "Search incident number or title" })
    .fill("no-matching-record");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("heading", { name: "No incidents in this view" }).waitFor();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Toggle error fixture" }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator("tbody tr").count(), 0);
  await page.getByRole("button", { name: "Try again" }).click();
  assert.equal(await page.locator("tbody tr").count(), 8);
  await page.getByRole("button", { name: "Toggle loading fixture" }).click();
  await page.getByText("Loading incidents", { exact: true }).waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Toggle loading fixture" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCards = page.getByLabel("Incident cards");
  await mobileCards.waitFor({ state: "visible" });
  assert.equal(await mobileCards.locator("article").count(), 8);
  assert.equal(
    await mobileCards.getByText("SLA: Breached", { exact: true }).first().isVisible(),
    true,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    "mobile page must not overflow horizontally",
  );
  await page.screenshot({ path: `${artifacts}/mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await drawer.waitFor();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await drawer.evaluate((node) => node.contains(document.activeElement)),
      true,
      "drawer traps keyboard focus",
    );
  }
  await page.screenshot({ path: `${artifacts}/mobile-navigation.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "Open navigation" })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.deepEqual(errors, [], "browser must not report page errors");
  console.log(
    "PASS: desktop/mobile rendering, queue selection, search, priority, record selection, empty/error/loading states, notification popover, mobile overflow, drawer focus trap and Escape restoration. Synthetic UI fixtures only.",
  );
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser.close();
}
