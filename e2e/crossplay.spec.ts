/* eslint-disable testing-library/prefer-screen-queries -- Playwright owns browser queries. */
import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
  await expect(
    host.getByRole("heading", { name: "Custom setup" }),
  ).toBeVisible();
  const code = await host.locator(".coopInviteDigits").innerText();
  expect(code).toMatch(/^[a-z0-9]{6}$/);
  await lobby(guest).getByRole("textbox", { name: "Invite code" }).fill(code);
  await lobby(guest).getByRole("button", { name: "Join", exact: true }).click();

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
      .click({ timeout: 20_000 });
  }
  for (const player of [host, guest])
    await expect(clock(player)).toHaveAttribute("data-active-speed", "SLOW");
}

async function attachOperations(
  info: TestInfo,
  fixture: ReturnType<typeof crossplayFixture>,
  host: Page | undefined,
) {
  const file = info.outputPath("room-operations.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      fixture.operations.slice(-80).map(({ page, ...operation }) => ({
        ...operation,
        role: page === host ? "host" : "guest",
      })),
      null,
      2,
    ),
  );
  await info.attach("room-operations", {
    contentType: "application/json",
    path: file,
  });
}

async function saveAndQuit(page: Page) {
  await page.getByRole("button", { name: "menu", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Game menu" });
  // The menu paper scales into place and can move the item during the click.
  await expect(menu.locator("..")).toHaveCSS("transform", "none");
  await menu
    .getByRole("menuitem", { name: "Save & Quit", exact: true })
    .click();
  await expect(mainEntry(page)).toBeVisible();
}

async function loadCampaign(page: Page) {
  await mainEntry(page).click();
  await lobby(page)
    .getByRole("button", { name: "Multiplayer saves", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Multiplayer saves", exact: true })
    .getByRole("button", { name: "Load save", exact: true })
    .click();
}

async function saveAndResume(
  host: Page,
  guest: Page,
  fixture: ReturnType<typeof crossplayFixture>,
) {
  const beforeQuit = fixture.elapsedMs();
  await saveAndQuit(guest);
  await expect
    .poll(() =>
      fixture.operations.some(
        ({ operation, status, startedMs, explicit }) =>
          startedMs >= beforeQuit &&
          explicit &&
          operation === "save/publish" &&
          status === 200,
      ),
    )
    .toBe(true);
  await saveAndQuit(host);
  const confirmed = await fixture.checkpoint();
  expect(confirmed?.matchId).toBeTruthy();

  // A reload removes the active session. Both players reclaim their original seats.
  await Promise.all([host.reload(), guest.reload()]);
  await loadCampaign(host);
  const resume = lobby(host).getByRole("button", {
    name: "Resume campaign",
    exact: true,
  });
  await expect(resume).toBeDisabled();
  await loadCampaign(guest);
  await expect(resume).toBeEnabled();
  await resume.click();
  for (const player of [host, guest])
    await expect(clock(player)).toHaveAttribute("data-active-speed", "PAUSED");
  const resumed = await fixture.checkpoint();
  expect(resumed?.matchId).toBe(confirmed?.matchId);
  expect(resumed?.epoch).not.toBe(confirmed?.epoch);
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
    const fixture = crossplayFixture();
    await fixture.prepareCheckpoints();
    const otherContext = await browser.newContext({ ...testInfo.project.use });
    let host: Page | undefined;
    try {
      const other = await otherContext.newPage();
      const steam = steamHost ? page : other;
      const web = steamHost ? other : page;
      host = steamHost ? steam : web;
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

      const guest = steamHost ? web : steam;
      await start(host, guest);

      const operations = fixture.operations
        .filter(({ status }) => status === 200)
        .map(({ operation }) => operation);
      expect(operations).toEqual(
        expect.arrayContaining([
          "auth/google",
          "auth/steam",
          "room/join",
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
      await saveAndResume(host, guest, fixture);
      if (!steamHost) {
        fixture.loseAuthority();
        await expect(
          guest.getByRole("dialog", { name: "Multiplayer" }),
        ).toContainText(/connection|reconnect/i);
      }
    } catch (error) {
      await attachOperations(testInfo, fixture, host);
      throw error;
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
  const fixture = crossplayFixture();
  await fixture.prepareCheckpoints();
  const guestContext = await browser.newContext({ ...testInfo.project.use });
  try {
    const guest = await guestContext.newPage();
    await Promise.all([
      fixture.install(page, "web"),
      fixture.install(guest, "web"),
    ]);
    await Promise.all([enter(page), enter(guest)]);
    await start(page, guest);
    await saveAndResume(page, guest, fixture);
  } catch (error) {
    await attachOperations(testInfo, fixture, page);
    throw error;
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
  await code.fill("a1b2z3");
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

test("a copied web invite opens the join prompt and admits the guest directly", async ({
  page,
  browser,
}, info) => {
  const fixture = crossplayFixture();
  const guestContext = await browser.newContext({ ...info.project.use });
  try {
    const guest = await guestContext.newPage();
    await Promise.all([
      fixture.install(page, "web"),
      fixture.install(guest, "web"),
    ]);
    await isolateAnalytics(guestContext);
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await enter(page);
    await lobby(page).getByRole("button", { name: "Host a game" }).click();
    await expect(
      page.getByRole("heading", { name: "Custom setup" }),
    ).toBeVisible();
    const code = page.getByRole("button", { name: "Copy code", exact: true });
    const share = page.getByRole("button", { name: "Copy link", exact: true });
    const shareRow = page.locator(".coopInviteCodeWithLink");
    await expect(shareRow).toContainText(/invite code/i);
    await expect(shareRow.getByRole("button")).toHaveCount(2);
    await expect(code).toBeInViewport();
    await expect(share).toBeInViewport();
    expect(
      await shareRow.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await reviewScreenshot(shareRow, {
      path: info.outputPath("host-invite-actions.png"),
      animations: "disabled",
    });
    await expect(code).toHaveClass(/MuiButton-outlined/);
    await expect(share).toHaveClass(/MuiButton-contained/);
    await share.click();
    const link = new URL(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    expect(link.origin).toBe("https://electrifygame.com");
    expect(link.pathname).toBe("/");
    await guest.goto(link.pathname + link.hash);
    await expect(lobby(guest)).toBeVisible();
    await expect(lobby(guest).getByRole("textbox")).toHaveCount(0);
    expect(
      await lobby(guest).evaluate((element) => element.outerHTML),
    ).not.toContain(link.hash.slice("#invite=".length));
    await expect(
      lobby(guest).getByRole("button", { name: "Host a game" }),
    ).toHaveCount(0);
    await reviewScreenshot(lobby(guest), {
      path: info.outputPath("guest-join-prompt.png"),
      animations: "disabled",
    });
    await lobby(guest)
      .getByRole("button", { name: "Join", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Custom setup" }),
    ).toBeVisible();
    expect(fixture.seatId(guest)).toBeTruthy();
  } finally {
    await guestContext.close();
  }
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
