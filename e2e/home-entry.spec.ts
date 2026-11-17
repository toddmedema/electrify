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

test("a failed direct-link entry download offers a working reload", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
    "Production chunk delivery.",
  );
  await page.route("**/static/js/game.*.js", (route) => route.abort());
  await page.goto("/?scenario=107");
  await expect(page.getByRole("alert")).toContainText(
    "couldn't finish loading",
  );
  await page.unroute("**/static/js/game.*.js");
  await page.getByRole("button", { name: "Reload Electrify" }).click();
  await expect(
    page.getByRole("button", { name: "Start game", exact: true }),
  ).toBeVisible();
});

test("sound unlocks within the gesture while game chunks are still held", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
    "Production chunk delivery.",
  );
  await page.addInitScript(() => {
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      document.documentElement.dataset.audioGesture = String(
        navigator.userActivation.isActive,
      );
      return resume.call(this);
    };
  });
  await page.goto("/");
  const sound = page.getByRole("button", { name: "Turn on sound" });
  await expect(sound).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/static/js/*.js", async (route) => {
    await held;
    await route.continue();
  });
  await sound.click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-audio-gesture",
    "true",
  );
  release();
  await expect(sound).toHaveCount(0);
});
