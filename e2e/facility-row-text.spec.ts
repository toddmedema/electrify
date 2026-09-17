import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

// Heatwave + Drought starts with hydro, storage and a mixed fleet, and a new build adds a row
// under construction, so every kind of status line the list can show is on screen at once.
test("facility rows keep their name and status to one untruncated line", async ({
  page,
}, testInfo) => {
  test.skip(
    !["desktop-chromium", "mobile-390px", "mobile-320px"].includes(
      testInfo.project.name,
    ),
  );
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const pane = page.locator(".facilities:visible");
  await openPane(
    pane,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  await pane.getByRole("button", { name: "Build", exact: true }).click();
  await page.locator(".button-buildGenerator").click();
  await page
    .getByRole("button", { name: /^Review purchase of / })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Pay cash" })
    .click();
  await openPane(
    pane,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );

  const rows = pane.locator(".facilityRow");
  await expect(rows.getByText(/^Building \d+%/)).toBeVisible();
  await expect(
    rows.getByText(/^(reservoir \d+%|\d+% full)$/).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    rows.getByText(/Wh · (charging|discharging|idle)/),
  ).toBeVisible();

  const lines = await rows
    .locator(
      ".MuiListItemText-primary, .MuiListItemText-secondary, .facilityName, .facilityStatus, .facilityStatusDetail",
    )
    .evaluateAll((elements) =>
      elements.map((el) => ({
        text: el.textContent,
        lines: Math.round(
          el.getBoundingClientRect().height /
            parseFloat(getComputedStyle(el).lineHeight),
        ),
        truncated: el.scrollWidth > el.clientWidth + 1,
      })),
    );
  expect(lines.filter((line) => line.lines !== 1)).toEqual([]);
  expect(lines.filter((line) => line.truncated)).toEqual([]);
});
