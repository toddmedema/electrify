import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { isolateAnalytics } from "./fixtures";
import { reviewScreenshot } from "./review-screenshot";

async function installDesktopBridge(page: Page, steamEdition: boolean) {
  await page.addInitScript((steamEdition) => {
    const noop = () => () => {};
    const display = {
      fullscreen: false,
      width: 1280,
      height: 900,
      resolutions: [],
    };
    window.electrifyDesktop = {
      apiVersion: 1,
      steamEdition,
      getState: async () => ({
        display,
        steam: {
          available: steamEdition,
          online: steamEdition,
          cloudEnabled: false,
          displayName: "Steam Engineer",
        },
      }),
      setDisplay: async () => display,
      couchRequest: async () => ({ available: steamEdition, devices: [] }),
      multiplayerRequest: async () => ({
        available: steamEdition,
        members: [],
        connected: [],
      }),
      onMultiplayerEvent: noop,
      onStateChanged: noop,
      onGameFocusChanged: noop,
      onBeforeQuit: noop,
      readyToQuit: () => {},
      quit: async () => {},
      readSaveLibrary: async () => ({
        local: null,
        cloud: null,
        cloudState: "disabled",
      }),
      writeSaveLibrary: async () => ({ cloudState: "disabled" }),
      getLeaderboard: async () => [],
      submitScore: async () => {},
      openFriends: async () => {},
    };
  }, steamEdition);
}

const lobby = (page: Page) =>
  page.getByRole("dialog", { name: "Play with friends" });
const mainEntry = (page: Page) =>
  page.getByRole("button", { name: "Play with friends", exact: true });
const clock = (page: Page) =>
  page.locator(".multiplayerSpeedToggles:visible").last();

async function enter(page: Page) {
  await isolateAnalytics(page.context());
  await page.goto("/");
  await mainEntry(page).click();
  await expect(lobby(page)).toBeVisible();
}

async function start(host: Page, guest: Page) {
  await lobby(host).getByRole("button", { name: "Host a game" }).click();
  await expect(host.getByTestId("mission-row-999")).toBeVisible();
  const invite = host
    .getByRole("region", { name: "Playing together" })
    .last()
    .getByText(/^\d{6}$/, { exact: true });
  const code = await invite.innerText();
  await lobby(guest)
    .getByRole("textbox", { name: "6-digit invite code" })
    .fill(code);
  await lobby(guest).getByRole("button", { name: "Join", exact: true }).click();

  await host.getByTestId("mission-row-999").click();
  const ready = guest.getByRole("button", { name: "I'm ready", exact: true });
  await expect(ready).toBeEnabled();
  await ready.click();
  const roster = host
    .getByRole("list", { name: "Players", exact: true })
    .last();
  await expect(
    roster.getByRole("img", { name: "Ready", exact: true }),
  ).toBeVisible();
  await host
    .getByRole("button", { name: "Start for everyone", exact: true })
    .click();
  for (const player of [host, guest]) {
    await expect(clock(player)).toBeVisible();
    await clock(player)
      .getByRole("button", { name: "slow speed", exact: true })
      .click();
  }
  for (const player of [host, guest])
    await expect(clock(player)).toHaveAttribute("data-active-speed", "SLOW");
}

for (const steamHost of [false, true]) {
  test(`web and Steam play together with ${steamHost ? "a Steam" : "a web"} host`, async ({
    page,
    context,
    browser,
  }, testInfo) => {
    test.skip(
      steamHost && testInfo.project.name !== "desktop-chromium",
      "Steam host uses the desktop viewport.",
    );
    const otherContext = await browser.newContext({ ...testInfo.project.use });
    const other = await otherContext.newPage();
    const steam = steamHost ? page : other;
    const web = steamHost ? other : page;
    await installDesktopBridge(steam, true);
    try {
      await Promise.all([enter(web), enter(steam)]);
      await expect(
        lobby(web).getByRole("button", { name: "Local Co-op" }),
      ).toHaveCount(0);
      await expect(
        lobby(steam).getByRole("button", { name: "Local Co-op" }),
      ).toBeVisible();
      await lobby(steam)
        .getByRole("button", { name: "Web & Steam", exact: true })
        .click();
      await expect(
        lobby(steam).getByRole("button", { name: "Web & Steam", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        lobby(web).getByRole("button", { name: "Host a game" }),
      ).toBeInViewport();
      await expect(
        lobby(web).getByRole("textbox", { name: "6-digit invite code" }),
      ).toBeInViewport();
      if (!steamHost && testInfo.project.name === "mobile-360px")
        await reviewScreenshot(lobby(web), {
          path: testInfo.outputPath("web-crossplay.png"),
          animations: "disabled",
        });
      if (steamHost)
        await reviewScreenshot(lobby(steam), {
          path: testInfo.outputPath("steam-crossplay.png"),
          animations: "disabled",
        });

      const host = steamHost ? steam : web;
      const guest = steamHost ? web : steam;
      await start(host, guest);
      await guest.getByRole("button", { name: /^menu/ }).click();
      await guest.getByRole("menuitem", { name: "Save & Quit" }).click();
      await expect(mainEntry(guest)).toBeVisible();
      await host.getByRole("button", { name: /^menu/ }).click();
      await host.getByRole("menuitem", { name: "Save & Quit" }).click();
      await expect(mainEntry(host)).toBeVisible();

      // Refreshing proves the campaign is stored beyond the active session.
      await host.reload();
      await mainEntry(host).click();
      if (steamHost)
        await lobby(host)
          .getByRole("button", { name: "Web & Steam", exact: true })
          .click();
      await lobby(host).getByRole("button", { name: "Host a game" }).click();
      await host.getByRole("button", { name: "Load multiplayer save" }).click();
      await host
        .getByRole("button", { name: "Load save", exact: true })
        .click();
      const resume = host.getByRole("button", {
        name: "Resume game",
        exact: true,
      });
      await expect(resume).toBeDisabled();
      const code = await host
        .getByRole("dialog", { name: "Pick your company" })
        .getByText(/^\d{6}$/, { exact: true })
        .innerText();
      await mainEntry(guest).click();
      await lobby(guest)
        .getByRole("textbox", { name: "6-digit invite code" })
        .fill(code);
      await lobby(guest)
        .getByRole("button", { name: "Join", exact: true })
        .click();
      await expect(resume).toBeEnabled();
      await resume.click();
      for (const player of [host, guest])
        await expect(clock(player)).toHaveAttribute(
          "data-active-speed",
          "PAUSED",
        );
      await host.getByRole("button", { name: /^menu/ }).click();
      await host.getByRole("menuitem", { name: "Save & Quit" }).click();
      await expect(mainEntry(host)).toBeVisible();
    } finally {
      await otherContext.close();
    }
  });
}

test("two browsers can start and advance a shared game", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-390px",
    "Cover browser-only play on a phone.",
  );
  const guestContext = await browser.newContext({ ...testInfo.project.use });
  try {
    const guest = await guestContext.newPage();
    await Promise.all([enter(page), enter(guest)]);
    await start(page, guest);
  } finally {
    await guestContext.close();
  }
});

test("a non-Steam desktop build offers online play without local co-op", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Desktop standalone edition.",
  );
  await installDesktopBridge(page, false);
  await enter(page);
  await expect(
    lobby(page).getByRole("button", { name: "Host a game" }),
  ).toBeEnabled();
  await expect(
    lobby(page).getByRole("button", { name: "Local Co-op" }),
  ).toHaveCount(0);
  await expect(
    lobby(page).getByRole("button", { name: "Steam friends" }),
  ).toHaveCount(0);
});
