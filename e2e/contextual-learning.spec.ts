import path from "path";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`contextual learning preserves a storage decision in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.getByRole("group", { name: "game speed" })).toBeVisible();
    if (!(await page.locator("#facilitiesPane").isVisible())) {
      await page
        .getByRole("button", { name: "Facilities", exact: true })
        .click();
    }
    await page.locator(".button-buildStorage").click();
    const capacity = page.getByRole("slider", { name: /^Capacity/ });
    await capacity.focus();
    await capacity.press("ArrowLeft");
    const selectedCapacity = await capacity.getAttribute("aria-valuenow");
    const sort = page.getByRole("combobox", { name: "Sort facilities" });
    if (await sort.isVisible()) {
      await sort.click();
      await page.getByRole("option", { name: "Build Time" }).click();
    } else {
      await page.getByRole("button", { name: /^Sort facilities:/ }).click();
      await page.getByRole("menuitem", { name: "Build Time" }).click();
    }
    const first = page.locator(".buildOption").first();
    const metrics = await first.locator(".buildOptionMetrics").innerText();
    const help = page
      .getByRole("button", { name: /power, energy & duration/i })
      .first();
    await expect(help).toBeVisible();
    expect((await help.boundingBox())!.height).toBeGreaterThanOrEqual(
      testInfo.project.use.hasTouch ? 44 : 40,
    );
    await help.click();
    const manual = page.getByRole("dialog", { name: "Manual help" });
    await expect(manual).toBeVisible();
    const topic = manual
      .getByRole("heading", { name: "Power and Energy", exact: true })
      .getByRole("button", {
        name: "Power and Energy",
        exact: true,
      });
    await expect(topic).toHaveAttribute("aria-expanded", "true");
    await expect(topic).toBeFocused();
    await expect(manual).toContainText("80 MWh");
    await manual
      .getByRole("textbox", { name: "Search the manual" })
      .fill("round-trip");
    await manual
      .getByRole("navigation", { name: "Related to Round-trip Efficiency" })
      .getByRole("button", { name: "Power and Energy", exact: true })
      .click();
    await expect(topic).toHaveAttribute("aria-expanded", "true");
    await expect(topic).toBeFocused();
    expect(
      await manual.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    const shots = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      shots &&
      ((theme === "light" && testInfo.project.name === "desktop-chromium") ||
        (theme === "dark" && testInfo.project.name === "mobile-390px"))
    ) {
      // Capture after the dialog transition settles.
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(shots, `manual-${testInfo.project.name}-${theme}.png`),
      });
    }
    await manual.getByRole("button", { name: "back", exact: true }).click();
    await expect(manual).not.toBeVisible();
    await expect(help).toBeFocused();
    await expect(capacity).toHaveAttribute("aria-valuenow", selectedCapacity!);
    await expect(first.locator(".buildOptionMetrics")).toHaveText(metrics, {
      useInnerText: true,
    });
    if (await sort.isVisible()) {
      await expect(sort).toContainText("Build Time");
    } else {
      await expect(
        page.getByRole("button", { name: "Sort facilities: Build Time" }),
      ).toBeVisible();
    }
    // A second lookup must close to the same draft without creating a history loop.
    await help.click();
    await expect(manual).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(manual).not.toBeVisible();
    await expect(capacity).toHaveAttribute("aria-valuenow", selectedCapacity!);
    await page
      .locator('.buildOption button[aria-label^="Review purchase of"]:enabled')
      .first()
      .click();
    const purchase = page.getByRole("dialog");
    await expect(purchase).toContainText("Loan option");
    const purchaseHelp = purchase.getByRole("button", {
      name: "Power, energy & duration",
      exact: true,
    });
    await purchaseHelp.click();
    await expect(manual).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(manual).not.toBeVisible();
    await expect(purchaseHelp).toBeFocused();
    await expect(purchase).toContainText("Loan option");
    await purchase.getByRole("button", { name: "close", exact: true }).click();
    await expect(purchase).not.toBeVisible();
    await page.getByRole("button", { name: "close", exact: true }).click();
    await expect(page.getByRole("group", { name: "game speed" })).toBeVisible();
  });
}

test("reading help preserves the current tutorial objective", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  const objective = page.locator(".tutorialHud");
  await expect(objective).toBeVisible();
  const before = await objective.innerText();
  if (!(await page.locator(".insights:visible").isVisible())) {
    await page.getByRole("button", { name: "Insights", exact: true }).click();
  }
  const help = page.getByRole("button", {
    name: "How reserve works",
    exact: true,
  });
  await help.click();
  const manual = page.getByRole("dialog", { name: "Manual help" });
  await expect(manual).toBeVisible();
  await expect(objective).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).not.toBeVisible();
  await manual.getByRole("button", { name: "back", exact: true }).click();
  await expect(manual).not.toBeVisible();
  await expect(objective).toHaveText(before, { useInnerText: true });
  await expect(help).toBeFocused();
});
