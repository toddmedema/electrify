import { expect, test } from "./fixtures";

test("one online visit stores everything a styled offline launch needs", async ({
  page,
  context,
}) => {
  const offlineKey = "electrify-test-offline";
  await page.addInitScript((key) => {
    // Chromium's emulated network state can update after cached startup scripts run.
    Object.defineProperty(navigator, "onLine", {
      get: () => sessionStorage.getItem(key) !== "true",
    });
  }, offlineKey);
  let offline = false;
  let tagRequests = 0;
  await page.route("https://www.googletagmanager.com/**", (route) => {
    tagRequests++;
    if (offline) return route.abort();
    return route.fulfill({ contentType: "application/javascript", body: "" });
  });
  await page.goto("/");
  const play = page.getByRole("button", { name: "Play" });
  await expect(play).toBeVisible();
  // Activation follows install, which stores the build. A browser HTTP cache could otherwise
  // hide a missing file on this reload, so check the worker's own cache as well.
  await page.evaluate(() => navigator.serviceWorker.ready);
  const uncached = await page.evaluate(async () => {
    const manifest = await (await fetch("/asset-manifest.json")).json();
    const files = Object.values<string>(manifest.files).filter(
      (file) => file.startsWith("/static/") && !/\.(map|txt)$/.test(file),
    );
    const loaded = await Promise.all(
      files.map(async (file) => ((await caches.match(file)) ? "" : file)),
    );
    return loaded.filter(Boolean);
  });
  expect(uncached).toEqual([]);
  expect(
    await page.evaluate(async () =>
      Boolean(await caches.match("/analytics.js")),
    ),
  ).toBe(true);

  await expect.poll(() => tagRequests).toBe(1);
  const onlineRequests = tagRequests;
  offline = true;
  await page.evaluate((key) => sessionStorage.setItem(key, "true"), offlineKey);
  await context.setOffline(true);
  await page.reload();

  await expect(play).toBeVisible();
  // The stored fonts and stylesheet replace browser defaults; only app styles hide this heading.
  await expect(page.locator("body")).toHaveCSS("font-family", /Inter/);
  const heading = await page.locator("h1").boundingBox();
  expect(heading!.width).toBeLessThanOrEqual(1);
  // The local runtime survives an offline launch, then initializes when connectivity returns.
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(await page.evaluate(() => Boolean(window.electrifyAnalytics))).toBe(
    true,
  );
  const configCount = () =>
    page.evaluate(
      () =>
        Array.from(
          (window as typeof window & { dataLayer: ArrayLike<unknown>[] })
            .dataLayer || [],
          (command) => Array.from(command),
        ).filter(([name]) => name === "config").length,
    );
  expect(tagRequests).toBe(onlineRequests);
  expect(await configCount()).toBe(0);

  const tagResponse = page.waitForResponse(
    "https://www.googletagmanager.com/**",
  );
  offline = false;
  await context.setOffline(false);
  await page.evaluate((key) => {
    sessionStorage.removeItem(key);
    window.dispatchEvent(new Event("online"));
  }, offlineKey);
  expect((await tagResponse).ok()).toBe(true);
  await expect.poll(() => tagRequests).toBe(onlineRequests + 1);
  await expect.poll(configCount).toBe(1);
});

test("installed play preloads official weather and enables custom cities after selection", async ({
  page,
  context,
}, { project }) => {
  const offlineKey = "electrify-test-offline";
  await page.addInitScript((key) => {
    // Keep the emulated offline state through the guided setup's new document.
    Object.defineProperty(navigator, "onLine", {
      get: () => sessionStorage.getItem(key) !== "true",
    });
    Object.defineProperty(navigator, "standalone", { value: true });
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [{ scenarioId: 0, timesPlayed: 1, date: new Date().toString() }],
      }),
    );
  }, offlineKey);
  await page.goto("/");
  const cachedWeather = (ids: string[]) =>
    page.evaluate(
      (locations) =>
        Promise.all(
          locations.map(async (id) =>
            Boolean(await caches.match(`/data/weather/${id}.bin`)),
          ),
        ),
      ids,
    );
  await expect
    .poll(() =>
      cachedWeather(["SF", "PIT", "AlleghenyUpper", "Zurich", "Tokyo"]),
    )
    .toEqual([true, true, true, false, false]);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean(await caches.match("/data/data-center-customers.json")),
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "View Custom Game details" }).click();
  const weatherSearch = page.getByRole("combobox", {
    name: "Search playable cities",
  });
  await weatherSearch.fill("Zurich");
  await page
    .getByRole("option", { name: "Zurich, Switzerland", exact: true })
    .click();
  await expect.poll(() => cachedWeather(["Zurich"])).toEqual([true]);

  await page.evaluate((key) => sessionStorage.setItem(key, "true"), offlineKey);
  await context.setOffline(true);
  await weatherSearch.fill("Tokyo");
  const unavailable = page.getByRole("option", {
    name: "Tokyo, Japan",
    exact: true,
  });
  await expect(unavailable).toBeDisabled();
  await expect(unavailable).toHaveAccessibleDescription(
    "An internet connection is required to download location weather data.",
  );
  const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
  if (reviewDir) {
    await page.screenshot({
      path: `${reviewDir}/offline-custom-weather-${project.name}.png`,
    });
  }

  await weatherSearch.fill("Pittsburgh");
  await expect(
    page.getByRole("option", { name: "Pittsburgh, PA", exact: true }),
  ).toBeEnabled();
  await weatherSearch.fill("Zurich");
  const available = page.getByRole("option", {
    name: "Zurich, Switzerland",
    exact: true,
  });
  await expect(available).toBeEnabled();
  await available.click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Plants and storage" }),
  ).toBeVisible();

  await page.goto("/?dataCenters=1");
  await expect(
    page.getByRole("heading", { name: "Explore data center growth" }),
  ).toBeVisible();
  const guidedSearch = page.getByRole("combobox", { name: "Select a city" });
  await guidedSearch.fill("Tokyo");
  await expect(
    page.getByRole("option", { name: "Tokyo, Japan", exact: true }),
  ).toBeDisabled();
  await guidedSearch.fill("Pittsburgh");
  await page
    .getByRole("option", { name: "Pittsburgh, PA", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start exploring", exact: true }),
  ).toBeEnabled();
});
