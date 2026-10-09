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
    await fleet.getByRole("button", { name: "Dispatch", exact: true }).click();
    const row = fleet.locator(".facilityRow").filter({
      has: page.locator(".facilityName", { hasText: /^Natural Gas Peaker$/ }),
    });
    await row.locator(".facilityDisclosure").click();
    const conversion = row.getByRole("region", {
      name: "Combined-cycle conversion",
    });
    const action = conversion.getByRole("button", { name: /^Convert ·/ });
    await expect(action).toBeDisabled();
    await expect(action).toHaveAccessibleDescription(/more cash needed/);
    const resilience = row.getByRole("region", { name: "Upgrades" });
    await expect(resilience).toContainText("Cold-weather package");
    await expect(resilience).not.toContainText("Cold protection");
    await expect(resilience).toContainText("Rated to");
    const layout = await conversion.evaluate((element) => {
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
