import { expect, test } from "./fixtures";
import { openBuild } from "./layout";
import { reviewScreenshot } from "./review-screenshot";

// Held-download probes must own requests even after background offline caching starts.
test.use({ serviceWorkers: "block" });

test("homepage feedback opens in place and tracks each opening and submission", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({
    colorScheme: testInfo.project.name.startsWith("mobile") ? "dark" : "light",
  });
  await page.route("https://www.googletagmanager.com/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  let received: unknown;
  await page.route("**/submitGameFeedback", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    received = route.request().postDataJSON();
    await route.fulfill({ headers, json: { result: { sent: true } } });
  });
  await page.goto("/");
  const open = page.getByRole("button", { name: "Send feedback", exact: true });
  const dialog = page.getByRole("dialog", { name: "Share feedback" });
  const message = dialog.getByRole("textbox", { name: "Your feedback" });
  const submit = dialog.getByRole("button", { name: "Send feedback" });
  await open.click();
  await expect(message).toBeFocused();
  await expect(page).toHaveURL("/");
  await expect(submit).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(open).toBeFocused();
  await open.click();
  await message.fill("The tutorial was helpful.");
  await dialog
    .getByRole("textbox", { name: "Email for a reply (optional)" })
    .fill("player@example.com");
  await reviewScreenshot(dialog, {
    path: testInfo.outputPath("homepage-feedback.png"),
    animations: "disabled",
  });
  await submit.click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Thanks for sharing your feedback.",
  );
  expect(received).toMatchObject({
    data: {
      source: "game-menu",
      message: "The tutorial was helpful.",
      replyEmail: "player@example.com",
    },
  });
  const eventParams = { source: "game-menu", app_version: expect.any(String) };
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { dataLayer = [] } = window as typeof window & {
          dataLayer?: ArrayLike<unknown>[];
        };
        return dataLayer
          .map((command) => Array.from(command))
          .filter(
            ([command, name]) =>
              command === "event" && String(name).startsWith("feedback_"),
          );
      }),
    )
    .toEqual([
      ["event", "feedback_open", eventParams],
      ["event", "feedback_open", eventParams],
      ["event", "feedback_submit", eventParams],
    ]);
});

test("a fresh production title defers the game until an action and preserves the selected destination @phone", async ({
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

test("sound unlocks within the gesture while game chunks are still held @phone", async ({
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

for (const theme of ["light", "dark"] as const) {
  test(`the startup logo has no unstyled fills in ${theme} mode`, async ({
    page,
  }, info) => {
    test.skip(
      !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
      "Production stylesheet delivery.",
    );
    await page.emulateMedia({ colorScheme: theme });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const appStyles = "**/static/css/main.*.css";
    await page.route(appStyles, async (route) => {
      await held;
      await route.continue();
    });
    const stylesRequested = page.waitForRequest(appStyles);
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await stylesRequested;
      const logo = page.locator("#appStartup .homeLogo");
      await expect(logo).toBeVisible();
      await logo
        .getByRole("img", { name: "Electrify" })
        .evaluate((image: HTMLImageElement) => image.decode());
      await reviewScreenshot(logo, {
        path: info.outputPath(`startup-logo-${theme}.png`),
        scale: "css",
      });
      await expect(logo.locator(".homeEnergyPulse")).toHaveCSS("fill", "none");
      await expect(logo.locator(".homeSmokePuff").first()).toHaveCSS(
        "fill",
        "none",
      );
    } finally {
      release();
    }
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#appStartup")).toHaveCount(0);
  });
}

for (const entry of ["home", "game"] as const) {
  test(`a stylesheet failure before the ${entry} entry offers a working reload`, async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
      "Production stylesheet delivery.",
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entryPattern = new RegExp(`/static/js/${entry}\\.[^/]+\\.js$`);
    await page.route(entryPattern, async (route) => {
      await held;
      await route.continue();
    });
    await page.route("**/static/css/main.*.css", (route) => route.abort());
    const failedStyle = page.waitForEvent("requestfailed", (request) =>
      request.url().includes("/static/css/"),
    );
    const requestedEntry = page.waitForRequest(entryPattern);
    try {
      await page.goto(entry === "home" ? "/" : "/?scenario=107", {
        waitUntil: "domcontentloaded",
      });
      await Promise.all([failedStyle, requestedEntry]);
    } finally {
      release();
    }
    await expect(page.getByRole("alert")).toContainText(
      "couldn't finish loading",
    );
    await expect(page.locator("link[data-app-style]")).toHaveCount(0);
    await page.unroute("**/static/css/main.*.css");
    await page.unroute(entryPattern);
    await page.getByRole("button", { name: "Reload Electrify" }).click();
    await expect(
      page.getByRole("button", {
        name: entry === "home" ? "Play" : "Start game",
        exact: true,
      }),
    ).toBeVisible();
  });
}

test("installation waits for loading and open homepage feedback to close", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
    "Production chunk delivery.",
  );
  await page.goto("/");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const feedbackChunk = "**/static/js/feedback.*.js";
  await page.route(feedbackChunk, async (route) => {
    await held;
    await route.continue();
  });
  const requested = page.waitForRequest(feedbackChunk);
  const gameRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/static\/js\/game\.[^/]+\.js$/.test(request.url()))
      gameRequests.push(request.url());
  });
  const prompt = () =>
    page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: async () => {
          document.documentElement.dataset.installPrompted = "true";
        },
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      });
      window.dispatchEvent(event);
    });
  try {
    await page
      .getByRole("button", { name: "Send feedback", exact: true })
      .click();
    await requested;
    await prompt();
    expect(gameRequests).toEqual([]);
  } finally {
    release();
  }
  const dialog = page.getByRole("dialog", { name: "Share feedback" });
  const message = dialog.getByRole("textbox", { name: "Your feedback" });
  await message.fill("Keep this draft until I close feedback.");
  await prompt();
  await expect(message).toHaveValue("Keep this draft until I close feedback.");
  expect(gameRequests).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Install app", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-install-prompted",
    "true",
  );
});

test("feedback still opens when manual game entry fails before its download finishes", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
    "Production chunk delivery.",
  );
  await page.goto("/");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const feedbackChunk = "**/static/js/feedback.*.js";
  await page.route(feedbackChunk, async (route) => {
    await held;
    await route.continue();
  });
  const requested = page.waitForRequest(feedbackChunk);
  await page.route("**/static/js/game.*.js", (route) => route.abort());
  try {
    await page
      .getByRole("button", { name: "Send feedback", exact: true })
      .click();
    await requested;
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("could not load");
  } finally {
    release();
  }
  const dialog = page.getByRole("dialog", { name: "Share feedback" });
  await expect(
    dialog.getByRole("textbox", { name: "Your feedback" }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("button", { name: "Send feedback", exact: true })
    .click();
  await expect(dialog).toBeVisible();
});

test("an installation prompt captured before Home mounts reaches the install control @phone", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
    "Production entry delivery.",
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/static/js/home.*.js", async (route) => {
    await held;
    await route.continue();
  });
  const homeRequested = page.waitForRequest("**/static/js/home.*.js");
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await homeRequested;
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: async () => {
          document.documentElement.dataset.installPrompted = "true";
        },
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      });
      window.dispatchEvent(event);
    });
  } finally {
    release();
  }
  await page.getByRole("button", { name: "Install app", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-install-prompted",
    "true",
  );
});

test("a failed scenario-list download retries without restarting the app", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
    "Production chunk delivery.",
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [{ scenarioId: 0, timesPlayed: 1, date: "2026-11-02" }],
      }),
    );
  });
  await page.route("**/static/js/new-game.*.js", (route) => route.abort());
  const failedView = page.waitForEvent("requestfailed", (request) =>
    request.url().includes("/static/js/new-game."),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await failedView;
  await expect(
    page.getByRole("dialog", { name: "This screen couldn't load" }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.retainedApp = "true";
  });
  await page.unroute("**/static/js/new-game.*.js");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a game", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-retained-app",
    "true",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`a failed help download retries while retaining the workspace in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(
      !process.env.E2E_BASE_URL && !process.env.E2E_BUILD_DIR,
      "Production chunk delivery.",
    );
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
    }, theme);
    await page.route("**/static/js/manual-help.*.js", (route) => route.abort());
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const build = await openBuild(page);
    const option = build.locator(".buildOption").first();
    await option.getByRole("button", { name: /^Show .* details$/ }).click();
    const help = option.getByRole("button", { name: /^What is / }).first();
    await help.click();
    const recovery = page.getByRole("dialog", {
      name: "This screen couldn't load",
    });
    await expect(recovery).toBeVisible();
    await expect(recovery.locator("..")).toHaveCSS("opacity", "1");
    await reviewScreenshot(recovery, {
      path: info.outputPath(`help-recovery-${theme}.png`),
    });
    await page.evaluate(() => {
      document.documentElement.dataset.retainedApp = "true";
    });
    await page.unroute("**/static/js/manual-help.*.js");
    await recovery.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Manual help", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toBeVisible();
    await expect(build).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-retained-app",
      "true",
    );
  });
}
