import { expect, test } from "./fixtures";

// Held-download probes must own requests even after background offline caching starts.
test.use({ serviceWorkers: "block" });

test("a fresh production title defers the game until an action and preserves the selected destination", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
    "The small entry is a production delivery feature.",
  );
  const fonts: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(".woff2")) fonts.push(request.url());
  });
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
  expect(
    fonts.some((url) => /InterVariable-latin\.[a-f0-9]+\.woff2$/.test(url)),
  ).toBe(true);
  expect(fonts.some((url) => /\/InterVariable\.woff2$/.test(url))).toBe(false);
  await page.evaluate(() => document.fonts.load("16px Inter", "Ж"));
  expect(fonts.some((url) => /\/InterVariable\.woff2$/.test(url))).toBe(true);
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
    const OriginalAudioContext = window.AudioContext;
    window.AudioContext = class extends OriginalAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        document.documentElement.dataset.audioGesture = String(
          navigator.userActivation.isActive,
        );
      }
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

test("a stalled logo cannot block the title actions", async ({ page }) => {
  test.skip(
    !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
    "Production entry delivery.",
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/images/logo-home*.svg", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#appStartup")).toHaveCount(0);
  } finally {
    release();
  }
  await expect
    .poll(() =>
      page
        .locator("#logo img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
});
