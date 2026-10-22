import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`wildfire intertie outage is clear and inspectable in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=111");
    await expect(
      page.getByRole("heading", { name: "Wildfire Emergency" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Your existing northern intertie will lose 90%/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Inspect Northern intertie/ }),
    ).toBeVisible();
    const events = page.locator(".eventLog");
    await openPane(
      events,
      page.getByRole("button", { name: "Events", exact: true }),
    );
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "fast speed" })
      .first()
      .click();
    const ongoing = page.locator(".ongoingEvents:visible");
    await expect(
      ongoing.getByText("Northern intertie capacity down 90%", { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    await expect(ongoing).toContainText("Through Feb 2025");
    await expect(ongoing).toContainText("10% capacity through February");
    const screenshotDir = process.env.REVIEW_SCREENSHOT_DIR;
    if (screenshotDir && theme === "light") {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          screenshotDir,
          `wildfire-events-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });
    }
    await openPane(
      page.locator(".facilities"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const line = page.locator(".transmissionLine").filter({
      has: page.getByRole("button", { name: /Inspect Northern intertie/ }),
    });
    const limit = line.getByLabel(
      "Temporarily limited to 10% of rated capacity",
    );
    await expect(limit).toBeVisible();
    await expect(limit).toHaveText("10% limit");
    const name = line.getByText("Northern intertie", { exact: true });
    const [nameBox, limitBox] = await Promise.all([
      name.boundingBox(),
      limit.boundingBox(),
    ]);
    expect(nameBox).not.toBeNull();
    expect(limitBox).not.toBeNull();
    expect(limitBox!.x).toBeGreaterThanOrEqual(nameBox!.x + nameBox!.width);
    expect(
      Math.abs(
        nameBox!.y + nameBox!.height / 2 - limitBox!.y - limitBox!.height / 2,
      ),
    ).toBeLessThanOrEqual(2);
    const inspect = line.getByRole("button", {
      name: /Inspect Northern intertie/,
    });
    if ((await inspect.getAttribute("aria-expanded")) !== "true")
      await inspect.click();
    await expect(
      line.getByText("Import available now", { exact: true }),
    ).toBeVisible();
    expect(
      await line.evaluate((el) => Math.max(0, el.scrollWidth - el.clientWidth)),
    ).toBeLessThanOrEqual(1);
    if (screenshotDir && theme === "light") {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          screenshotDir,
          `wildfire-route-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });
    }
  });
}
