import path from "path";
import { expect, test } from "./fixtures";
import { openBuild, openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`enlarged manual help keeps its header and scroll body in a short viewport in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: page.viewportSize()!.width,
      height: 1080,
    });
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("interfaceScale", "2.5");
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const build = await openBuild(page);
    const option = build.locator(".buildOption").first();
    await option.getByRole("button", { name: /^Show .* details$/ }).click();
    await option
      .getByRole("button", { name: /^What is / })
      .first()
      .click();
    const manual = page.getByRole("dialog", { name: "Manual help" });
    await expect(manual).toBeVisible();
    await page.setViewportSize({
      width: page.viewportSize()!.width,
      height: 360,
    });
    const close = manual.getByRole("button", { name: "close", exact: true });
    await expect(close).toBeInViewport({ ratio: 1 });
    await expect
      .poll(async () => {
        const box = (await manual.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(353);
    const body = manual.locator(".manual-popover-body");
    const geometry = await manual.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const header = element
        .querySelector(".manual-popover-header")!
        .getBoundingClientRect();
      const body = element.querySelector(".manual-popover-body")!;
      return {
        top: box.top,
        bottom: box.bottom,
        headerBottom: header.bottom,
        bodyHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(8);
    expect(geometry.bottom).toBeLessThanOrEqual(353);
    expect(geometry.headerBottom).toBeLessThan(geometry.bottom);
    expect(geometry.bodyHeight).toBeGreaterThanOrEqual(40);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.bodyHeight);
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      0,
    );
    await expect(close).toBeInViewport({ ratio: 1 });
    await close.click();
    await expect(manual).not.toBeVisible();
  });
}

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
    const facilities = page.locator(".facilities");
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const build = await openBuild(page);
    await build.getByRole("tab", { name: "Storage", exact: true }).click();
    const capacity = page.getByRole("slider", { name: /^Capacity/ });
    await capacity.focus();
    await capacity.press("ArrowLeft");
    const selectedCapacity = await capacity.getAttribute("aria-valuenow");
    const sort = page.getByRole("combobox", { name: "Sort facilities" });
    if (await sort.isVisible()) {
      await sort.click();
      await page.getByRole("option", { name: "Build time" }).click();
    } else {
      await page.getByRole("button", { name: /^Sort facilities:/ }).click();
      await page.getByRole("menuitem", { name: "Build time" }).click();
    }
    const first = page.locator(".buildOption").first();
    const metrics = await first.locator(".buildOptionMetrics").innerText();
    await expect(
      page.getByRole("button", {
        name: /power, energy & duration|charging & losses/i,
      }),
    ).toHaveCount(0);
    await page
      .locator('.buildOption button[aria-label^="Review purchase of"]:enabled')
      .first()
      .click();
    const purchase = page.getByRole("dialog", { name: /^Build / });
    const help = purchase.getByRole("button", {
      name: "What is interest rate?",
      exact: true,
    });
    await expect(help).toBeVisible();
    expect((await help.boundingBox())!.height).toBeGreaterThanOrEqual(
      testInfo.project.use.hasTouch ? 44 : 40,
    );
    await help.click();
    const manual = page.getByRole("dialog", { name: "Manual help" });
    await expect(manual).toBeVisible();
    // Just the entry, beside the term, rather than the whole manual over the decision
    await expect(
      manual.getByRole("heading", {
        name: "Interest rates & inflation",
        exact: true,
      }),
    ).toBeVisible();
    await expect(manual).toContainText("prime rate");
    await expect(
      manual.getByRole("textbox", { name: "Search the manual" }),
    ).toHaveCount(0);
    const viewport = page.viewportSize()!;
    const box = (await manual.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(viewport.height / 2 + 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
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
    await manual.getByRole("button", { name: "close", exact: true }).click();
    await expect(manual).not.toBeVisible();
    await expect(help).toBeFocused();
    // Tapping anywhere outside puts it away too, without acting on what was tapped
    await help.click();
    await expect(manual).toBeVisible();
    await page.mouse.click(4, viewport.height - 4);
    await expect(manual).not.toBeVisible();
    await expect(purchase).toContainText("Loan option");
    // A second lookup must close to the same draft without creating a history loop.
    await help.click();
    await expect(manual).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(manual).not.toBeVisible();
    await expect(purchase).toContainText("Loan option");
    await expect(help).toBeFocused();
    await purchase.getByRole("button", { name: "close", exact: true }).click();
    await expect(purchase).not.toBeVisible();
    await expect(capacity).toHaveAttribute("aria-valuenow", selectedCapacity!);
    await expect(first.locator(".buildOptionMetrics")).toHaveText(metrics, {
      useInnerText: true,
    });
    if (await sort.isVisible()) {
      await expect(sort).toContainText("Build time");
    } else {
      await expect(
        page.getByRole("button", { name: "Sort facilities: Build time" }),
      ).toBeVisible();
    }

    await page
      .getByRole("button", { name: "Close Build", exact: true })
      .click();
    // The outgoing catalog retains its speed controls during the closing transition.
    await expect(page.getByRole("group", { name: "game speed" })).toHaveCount(
      1,
    );
    await expect(page.getByRole("group", { name: "game speed" })).toBeVisible();
  });
}

test("reading help preserves the current tutorial objective", async ({
  page,
}) => {
  // Mission 4, since Missions 1-3 keep the navigation to Insights hidden while they teach
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [0, 1, 2].map((scenarioId) => ({
          scenarioId,
          timesPlayed: 1,
          date: "2026-09-10",
        })),
      }),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page
    .getByRole("button", { name: "Start Finances", exact: true })
    .click();
  const objective = page.locator(".tutorialHud");
  await expect(objective).toBeVisible();
  // Financing terms carry the mission's money help. Insights no longer has an inline help link.
  const facilities = page.locator(".facilities:visible");
  await openPane(
    facilities,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  const build = await openBuild(page);
  await build.getByRole("tab", { name: "Generators", exact: true }).click();
  await page
    .locator('.buildOption button[aria-label^="Review purchase of"]:enabled')
    .first()
    .click();
  await expect(objective).toBeVisible();
  const before = await objective.innerText();
  const help = page.getByRole("button", {
    name: "What is interest rate?",
    exact: true,
  });
  await help.click();
  const manual = page.getByRole("dialog", { name: "Manual help" });
  await expect(manual).toBeVisible();
  await expect(objective).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).not.toBeVisible();
  await manual.getByRole("button", { name: "close", exact: true }).click();
  await expect(manual).not.toBeVisible();
  await expect(objective).toHaveText(before, { useInnerText: true });
  await expect(help).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  test(`insights help shows only its chart subsection in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem(
        "insightsLayers",
        JSON.stringify(["supplyDemand", "cash"]),
      );
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const insights = page.getByRole("region", {
      name: "Insights",
      exact: true,
    });
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    const supplyHelp = insights.getByRole("button", {
      name: "What is Supply & Demand?",
      exact: true,
    });
    const pinned = page.getByRole("dialog", {
      name: "Manual help",
      exact: true,
    });
    const shots = process.env.REVIEW_SCREENSHOT_DIR;
    if (!info.project.use.hasTouch) {
      await supplyHelp.hover();
      const preview = page.getByRole("dialog", {
        name: "Manual preview",
        exact: true,
      });
      await expect(preview.getByRole("heading")).toHaveText([
        "Supply & Demand",
      ]);
      await expect(preview).toContainText("missing energy");
      await expect(preview).not.toContainText("Choose a preset");
      if (shots && theme === "light") {
        await page.screenshot({
          path: path.join(shots, "insights-subsection-desktop-light.png"),
          animations: "disabled",
        });
      }
    }
    await supplyHelp.click();
    await expect(pinned.getByRole("heading")).toHaveText(["Supply & Demand"]);
    await pinned.getByRole("link", { name: "blackouts", exact: true }).click();
    await expect(pinned.getByRole("heading")).toHaveText(["Blackouts"]);
    await pinned.getByRole("button", { name: "close", exact: true }).click();
    await expect(supplyHelp).toBeFocused();
    await insights
      .getByRole("button", { name: "What is Cash?", exact: true })
      .click();
    await expect(pinned.getByRole("heading")).toHaveText(["Cash"]);
    await expect(pinned).toContainText("cash balance");
    const bounds = (await pinned.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    expect(
      await pinned.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    if (shots && theme === "dark" && info.project.name === "mobile-390px") {
      await page.screenshot({
        path: path.join(shots, "insights-subsection-mobile-dark.png"),
        animations: "disabled",
      });
    }
    await page.keyboard.press("Escape");
    await expect(pinned).toBeHidden();
    await expect(insights).toBeVisible();
  });
}

test("manual search keeps chart subsections inside the insights page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search the manual" })
    .fill("dwindling reserves");
  const entry = page.locator("#manual-insights-data-layers-content");
  await expect(page.locator(".manual-entry")).toHaveCount(1);
  await expect(
    page.locator("#manual-insights-data-layers-header"),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    entry.getByRole("heading", { name: "Water", exact: true }),
  ).toBeVisible();
  await expect(entry.locator("mark")).toHaveText(["dwindling reserves"]);
});

for (const theme of ["light", "dark"] as const) {
  test(`hydro and storage help link directly to Water in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await page.locator("#manual-insights-data-layers-header").click();
    const storage = page.locator("section:has(> #manual-stored-energy)");
    const shots = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      shots &&
      ((theme === "light" && info.project.name === "desktop-chromium") ||
        (theme === "dark" && info.project.name === "mobile-390px"))
    ) {
      await storage.screenshot({
        path: path.join(
          shots,
          `storage-water-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
    await storage.getByRole("link", { name: "Water", exact: true }).click();
    const water = page.getByRole("heading", { name: "Water", exact: true });
    await expect(water).toBeVisible();
    await expect(water).toBeFocused();
    await page
      .locator("section:has(> #manual-water)")
      .getByRole("link", { name: "hydropower", exact: true })
      .click();
    await page.getByRole("link", { name: "Water chart", exact: true }).click();
    await expect(water).toBeVisible();
    await expect(water).toBeFocused();
    await expect(
      page.locator("#manual-insights-data-layers-header"),
    ).toHaveAttribute("aria-expanded", "true");
  });
}
