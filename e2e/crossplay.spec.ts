import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { crossplayFixture, installSteamBridge } from "./crossplay-fixture";
import { isolateAnalytics } from "./fixtures";
import { reviewScreenshot } from "./review-screenshot";

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
  const code = await lobby(host)
    .getByText(/^[a-f0-9]{20}$/i, { exact: true })
    .innerText();
  await lobby(guest).getByRole("textbox", { name: "Invite code" }).fill(code);
  await lobby(guest).getByRole("button", { name: "Join", exact: true }).click();
  await expect(lobby(guest)).toContainText(/waiting for.*approv/i);
  const choose = lobby(host).getByRole("button", { name: "Choose a game" });
  await expect(choose).toBeDisabled();
  await lobby(host)
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(choose).toBeEnabled();
  await choose.click();
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
  test(`simulated relay lets ${steamHost ? "Steam" : "web"} host cross-play`, async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium" ||
        process.env.CROSSPLAY_WEB_ONLY === "1",
      "Mixed desktop bridge coverage runs with the desktop renderer.",
    );
    const otherContext = await browser.newContext({ ...testInfo.project.use });
    try {
      const other = await otherContext.newPage();
      const steam = steamHost ? page : other;
      const web = steamHost ? other : page;
      const fixture = crossplayFixture();
      await Promise.all([
        fixture.install(web, "web"),
        fixture.install(steam, "steam"),
      ]);
      await Promise.all([enter(web), enter(steam)]);
      await expect(
        lobby(steam).getByRole("button", { name: "Local Co-op" }),
      ).toBeVisible();
      await expect(
        lobby(web).getByRole("button", { name: "Local Co-op" }),
      ).toHaveCount(0);
      await expect(
        lobby(steam).getByRole("button", { name: "Steam friends" }),
      ).toHaveCount(0);
      if (steamHost) {
        await reviewScreenshot(lobby(steam), {
          path: testInfo.outputPath("steam-crossplay.png"),
          animations: "disabled",
        });
      }

      const host = steamHost ? steam : web;
      const guest = steamHost ? web : steam;
      await start(host, guest);

      const operations = fixture.operations.map(({ operation }) => operation);
      expect(operations).toEqual(
        expect.arrayContaining([
          "auth/google",
          "auth/steam",
          "room/approve",
          "room/lock",
          "signal/describe",
          "signal/turn",
          "save/publish",
          "transfer/put",
          "transfer/get",
        ]),
      );
      expect(operations.indexOf("save/publish")).toBeLessThan(
        operations.indexOf("transfer/put"),
      );
      if (steamHost) {
        const saved = operations.filter(
          (operation) => operation === "save/publish",
        ).length;
        await guest.getByRole("button", { name: /^menu/ }).click();
        await guest.getByRole("menuitem", { name: "Save & Quit" }).click();
        await expect(mainEntry(guest)).toBeVisible();
        await expect
          .poll(
            () =>
              fixture.operations.filter(
                ({ operation }) => operation === "save/publish",
              ).length,
          )
          .toBeGreaterThan(saved);
      } else {
        fixture.loseAuthority();
        await expect(
          guest.getByRole("dialog", { name: "Multiplayer" }),
        ).toContainText(/connection|reconnect/i);
      }
    } finally {
      await otherContext.close();
    }
  });
}

test("two browsers can start and advance a shared game with simulated relay", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390px", "Phone hosting journey.");
  const guestContext = await browser.newContext({ ...testInfo.project.use });
  try {
    const guest = await guestContext.newPage();
    const fixture = crossplayFixture();
    await Promise.all([
      fixture.install(page, "web"),
      fixture.install(guest, "web"),
    ]);
    await Promise.all([enter(page), enter(guest)]);
    await start(page, guest);
  } finally {
    await guestContext.close();
  }
});

test("the unified web lobby keeps the join and host controls visible", async ({
  page,
}, testInfo) => {
  await enter(page);
  await expect(
    lobby(page).getByRole("button", { name: "Host a game" }),
  ).toBeInViewport();
  await expect(
    lobby(page).getByRole("textbox", { name: "Invite code" }),
  ).toBeInViewport();
  await expect(
    lobby(page).getByRole("button", { name: "Join", exact: true }),
  ).toBeDisabled();
  const code = lobby(page).getByRole("textbox", { name: "Invite code" });
  await code.fill("0123456789abcdefghij");
  await expect(
    lobby(page).getByRole("button", { name: "Join", exact: true }),
  ).toBeDisabled();
  await code.fill("0123456789abcdef0123");
  await expect(
    lobby(page).getByRole("button", { name: "Join", exact: true }),
  ).toBeEnabled();
  await code.clear();
  if (testInfo.project.name === "mobile-360px")
    await reviewScreenshot(lobby(page), {
      path: testInfo.outputPath("web-crossplay.png"),
      animations: "disabled",
    });
});

test("offline desktop cannot start online play", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium" ||
      process.env.CROSSPLAY_WEB_ONLY === "1",
    "Offline desktop bridge coverage runs with the desktop renderer.",
  );
  await installSteamBridge(page, false);
  await enter(page);
  await expect(
    lobby(page).getByRole("button", { name: "Host a game" }),
  ).toBeDisabled();
  await expect(
    lobby(page).getByRole("button", { name: "Local Co-op" }),
  ).toHaveCount(0);
});
