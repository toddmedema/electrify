import { expect, test } from "./fixtures";

test("a fresh production title defers the game until an action and preserves the selected destination", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
    "The small entry is a production delivery feature.",
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#appStartup")).toHaveCount(0);
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).some((db) => db.name === "electrify-saves"),
    ),
  ).toBe(false);
  await expect(
    page
      .getByRole("navigation", { name: "Explore Electrify" })
      .getByRole("link"),
  ).toHaveCount(7);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/static/js/*.js", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Loading game…" }),
  ).toHaveText("Loading game…");
  release();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
});
