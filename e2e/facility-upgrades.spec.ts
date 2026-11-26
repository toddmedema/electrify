import { expect, test } from "./fixtures";
import { openPane } from "./layout";

for (const theme of ["light", "dark"]) {
  test(`facility upgrade details stay readable in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const fleet = page.locator(".facilities:visible");
    await openPane(
      fleet,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const row = fleet.locator(".facilityRow").filter({
      has: page.locator(".facilityName", { hasText: /^Natural Gas Peaker$/ }),
    });
    await row.locator(".facilityDisclosure").click();
    const actions = row.locator(".facilityActions");
    await expect(row.getByText("Combined-cycle conversion")).toHaveCount(0);
    await expect(row.getByText(/output afterward/)).toHaveCount(0);
    const action = actions.getByRole("button", {
      name: /^Convert \([^)]+\)$/,
    });
    await expect(action).toBeDisabled();
    await expect(action).toHaveAccessibleDescription(/more cash needed/);
    const labels = await actions.getByRole("button").allInnerTexts();
    const upgradeIndex = labels.findIndex((label) =>
      label.startsWith("Upgrade capacity"),
    );
    const convertIndex = labels.findIndex((label) =>
      label.startsWith("Convert"),
    );
    expect(upgradeIndex).toBeGreaterThanOrEqual(0);
    expect(convertIndex).toBeGreaterThan(upgradeIndex);
    const resilience = row.getByRole("region", { name: "Upgrades" });
    await expect(resilience).toContainText("Cold-weather package");
    await expect(resilience).not.toContainText("Cold protection");
    await expect(resilience).toContainText("Rated to");
    const layout = await actions.evaluate((element) => {
      const button = element.querySelector("button")!;
      const note = element.querySelector(".facilityRetrofit p")!;
      return {
        stacked:
          note.getBoundingClientRect().top >=
          button.getBoundingClientRect().bottom + 7,
        contained: Array.from(element.querySelectorAll<HTMLElement>("*")).every(
          (child) => child.scrollWidth <= child.clientWidth + 1,
        ),
      };
    });
    expect(layout).toEqual({ stacked: true, contained: true });
    await resilience.scrollIntoViewIfNeeded();
    await expect(fleet.getByText("Oil", { exact: true })).toBeInViewport();
    // Let the scroll repaint before capturing the adjacent row and sticky header.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await page.screenshot({
      path: info.outputPath(`facility-upgrades-${theme}.png`),
      animations: "disabled",
    });
  });
}

test("capacity upgrades use the build slider and cash or loan choices", async ({
  page,
}) => {
  await page.goto("/?scenario=106");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const fleet = page.locator(".facilities:visible");
  await openPane(
    fleet,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  const row = fleet.locator(".facilityRow").filter({
    has: page.locator(".facilityName", { hasText: /^Natural Gas Peaker$/ }),
  });
  await row.locator(".facilityDisclosure").click();
  await row.getByRole("button", { name: "Upgrade capacity" }).click();
  const review = page.getByRole("dialog", { name: /Upgrade.*capacity/ });
  const slider = review.getByRole("slider", { name: "New capacity (MW)" });
  const readout = review.locator(".constructionCapacity");
  await expect(slider).toBeVisible();
  expect((await readout.boundingBox())!.x).toBeLessThan(
    (await slider.boundingBox())!.x,
  );
  await expect(review.getByRole("button", { name: "Pay cash" })).toBeVisible();
  await expect(review.getByRole("button", { name: "Take loan" })).toBeVisible();
  await slider.press("Home");
  await expect(slider).toHaveAttribute(
    "aria-valuenow",
    (await slider.getAttribute("aria-valuemin"))!,
  );
  await expect(review.getByRole("button", { name: "Pay cash" })).toBeDisabled();
  await expect(
    review.getByRole("button", { name: "Take loan" }),
  ).toBeDisabled();
  await slider.press("End");
  await expect(slider).toHaveAttribute(
    "aria-valuenow",
    (await slider.getAttribute("aria-valuemax"))!,
  );
  await expect(review.getByText("Loan option", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).toBeHidden();
});
