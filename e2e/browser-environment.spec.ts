const { browserLaunchOptions } = require("../scripts/ci/browser-launch");
import { chromium, expect, test } from "./fixtures";

// Exercise the Windows fixture on every host, including its inheritance by manual
// chromium.launch() calls. Otherwise POSIX runs miss Windows-only option leakage.
test.use({ launchOptions: browserLaunchOptions("win32") });

// Chromium's repeated-switch semantics are platform independent.
test("the Windows workaround preserves the browser's effective default features", async () => {
  // Manual launches inherit the suite's launchOptions. Reset both halves of the
  // workaround so the control browser actually retains Playwright's defaults.
  const defaults = await chromium.launch({
    ignoreDefaultArgs: [],
    args: ["--enable-automation"],
  });
  const options = browserLaunchOptions("win32");
  let mitigated: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    mitigated = await chromium.launch({
      ...options,
      args: [...options.args, "--enable-automation"],
    });
    const commandLine = async (
      browser: Awaited<ReturnType<typeof chromium.launch>>,
    ) => {
      const session = await browser.newBrowserCDPSession();
      const { arguments: args } = await session.send(
        "Browser.getBrowserCommandLine",
      );
      await session.detach();
      return args.filter((arg: string) =>
        arg.startsWith("--disable-features="),
      );
    };
    const original = await commandLine(defaults);
    const actual = await commandLine(mitigated);
    expect(original).toHaveLength(1);
    expect(actual).toEqual([original[0] + ",TcpPortRandomizationWin"]);
  } finally {
    await mitigated?.close();
    await defaults.close();
  }
});

test.describe("shared browser analytics", () => {
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ page }) => {
    // Execute no real Google code and send no test events to the production stream.
    await page.route("https://www.googletagmanager.com/**", (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" }),
    );
    await page.addInitScript(() =>
      localStorage.setItem("audioEnabled", "false"),
    );
  });

  test("public documents initialize the same stream once", async ({ page }) => {
    for (const pathname of [
      "/about.html",
      "/privacy.html",
      "/scenarios.html",
      "/scenarios/deep-freeze.html",
    ]) {
      await page.goto(pathname);
      const commands = await page.evaluate(() =>
        Array.from(
          (window as typeof window & { dataLayer: ArrayLike<unknown>[] })
            .dataLayer,
          (command) => Array.from(command),
        ),
      );
      expect(commands.filter(([name]) => name === "config")).toEqual([
        ["config", "G-M064W1XFDY"],
      ]);
      expect(commands.filter(([name]) => name === "event")).toEqual([]);
      await expect(
        page.locator('script[src*="googletagmanager.com/gtag/js"]'),
      ).toHaveCount(1);
    }
  });

  test("game startup and card events share one document configuration", async ({
    page,
  }) => {
    await page.goto("/?scenario=107");
    const start = page.getByRole("button", { name: "Start game", exact: true });
    await expect(start).toBeVisible();
    await start.click();
    await expect(page.locator("#appbar:visible")).toBeVisible();
    const commands = await page.evaluate(() => {
      window.electrifyAnalytics?.initialize();
      window.electrifyAnalytics?.initialize();
      return Array.from(
        (window as typeof window & { dataLayer: ArrayLike<unknown>[] })
          .dataLayer,
        (command) => Array.from(command),
      );
    });
    expect(commands.filter(([name]) => name === "config")).toEqual([
      ["config", "G-M064W1XFDY"],
    ]);
    expect(
      commands.filter(
        ([name, event]) => name === "event" && event === "page_view",
      ),
    ).toEqual([]);
    const events = commands.filter(([name]) => name === "event");
    expect(events.some(([, name]) => name === "card_view")).toBe(true);
    expect(events.find(([, name]) => name === "scenario_start")).toEqual([
      "event",
      "scenario_start",
      expect.objectContaining({
        id: 107,
        resumed: false,
        app_version: expect.any(String),
      }),
    ]);
    for (const [, , params] of events)
      expect(params).toEqual(
        expect.objectContaining({ app_version: expect.any(String) }),
      );
    await expect(
      page.locator('script[src*="googletagmanager.com/gtag/js"]'),
    ).toHaveCount(1);
  });

  test("a delayed local analytics runtime leaves game startup usable and preserves early events", async ({
    page,
  }) => {
    let release!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/analytics.js", async (route) => {
      await responseReady;
      await route.continue();
    });
    try {
      await page.goto("/?scenario=107", { waitUntil: "domcontentloaded" });
      expect(
        await page.evaluate(() => document.documentElement.dataset.theme),
      ).toMatch(/^(light|dark)$/);
      expect(
        await page.evaluate(() => window.electrifyAnalytics),
      ).toBeUndefined();
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await expect(page.locator("#appbar:visible")).toBeVisible();
      const early = await page.evaluate(
        () => window.electrifyAnalyticsQueue || [],
      );
      expect(early.length).toBeGreaterThan(0);
      expect(early.length).toBeLessThanOrEqual(100);
      expect(early).toContainEqual({
        name: "scenario_start",
        params: expect.objectContaining({ id: 107, resumed: false }),
      });
      expect(early.some(({ name }) => name === "card_view")).toBe(true);
      for (const { params } of early)
        expect(params).toEqual(
          expect.objectContaining({ app_version: expect.any(String) }),
        );
      release();
      const commands = () =>
        page.evaluate(() =>
          Array.from(
            (window as typeof window & { dataLayer?: ArrayLike<unknown>[] })
              .dataLayer || [],
            (command) => Array.from(command),
          ),
        );
      await expect
        .poll(
          async () =>
            (await commands()).filter(([name]) => name === "event").length,
        )
        .toBeGreaterThanOrEqual(early.length);
      const sent = await commands();
      expect(sent.filter(([name]) => name === "config")).toEqual([
        ["config", "G-M064W1XFDY"],
      ]);
      expect(
        sent.filter(([name]) => name === "event").slice(0, early.length),
      ).toEqual(early.map(({ name, params }) => ["event", name, params]));
      expect(
        await page.evaluate(() => window.electrifyAnalyticsQueue),
      ).toBeUndefined();
    } finally {
      release();
    }
  });

  test("blocked analytics leaves startup and navigation usable", async ({
    page,
  }) => {
    await page.route("https://www.googletagmanager.com/**", (route) =>
      route.abort(),
    );
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeVisible();
  });
});
