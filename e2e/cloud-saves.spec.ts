import path from "path";
import { expect, Page, test, TestInfo } from "./fixtures";
import { readSaveRecords } from "./save-fixture";

// Exercise the real invitation on a fresh device, without the gameplay fixture's dismissal.
test.use({ showCloudSaveInvitation: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
});

async function startGame(page: Page) {
  await page.goto("/?scenario=101");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
}

async function openSaves(page: Page) {
  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Saved games", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved games", exact: true }),
  ).toBeVisible();
}

async function checkDialogLayout(page: Page, name: string, info: TestInfo) {
  const dialog = page.getByRole("dialog", { name, exact: true });
  const bounds = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  for (const button of await dialog.getByRole("button").all()) {
    const buttonBounds = (await button.boundingBox())!;
    expect(buttonBounds.height).toBeGreaterThanOrEqual(
      info.project.use.hasTouch ? 44 : 40,
    );
    expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(
      bounds.x + bounds.width + 1,
    );
  }
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  if (!process.env.REVIEW_SCREENSHOT_DIR) return;
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(process.env.REVIEW_SCREENSHOT_DIR, name),
    animations: "disabled",
  });
}

for (const theme of ["light", "dark"]) {
  test(`incompatible backups stay separate from playable device saves in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("electrify-cloud-save-prompt-seen", "true");
    }, theme);
    await startGame(page);
    await openSaves(page);
    const before = (await readSaveRecords(page)).map(
      (entry) => entry.metadata.id,
    );
    // Seed the real view with a known sync result. Jest covers transport, account
    // changes and reconciliation; this fixture checks layout without a live account.
    await page.evaluate(() => {
      type FixtureStore = {
        dispatch(action: { type: string; payload: unknown }): void;
      };
      const runtime = window as unknown as {
        webpackChunkelectrify: {
          push(
            chunk: [
              string[],
              object,
              (require: (id: string) => { store: FixtureStore }) => void,
            ],
          ): void;
        };
      };
      runtime.webpackChunkelectrify.push([
        ["cloud-save-ui-fixture"],
        {},
        (require) => {
          require("./src/Store.tsx").store.dispatch({
            type: "saves/sessionChanged",
            payload: {
              cloudUid: "review-fixture",
              cloudState: "synced",
              incompatibleCloudSaves: [
                {
                  id: "old-austin",
                  version: "old",
                  name: "Deep Freeze — Austin, TX",
                },
                {
                  id: "old-pittsburgh",
                  version: "old",
                  name: "Rise of Renewables — Pittsburgh, PA — planning experiment",
                },
              ],
            },
          });
        },
      ]);
    });
    const warning = page.getByRole("alert");
    await expect(warning).toContainText(
      "Backups from a different game version",
    );
    await expect(warning).toContainText("still stored in your account");
    await expect(warning).toContainText("won't make the game playable");
    await expect(
      page.getByRole("button", { name: "Retry cloud backup" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Load", exact: true }),
    ).toBeEnabled();
    for (const button of await warning.getByRole("button").all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(
        info.project.use.hasTouch ? 44 : 40,
      );
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        page.viewportSize()!.width + 1,
      );
    }
    expect(
      await warning.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    if (
      info.project.name === "desktop-chromium" ||
      (theme === "dark" && info.project.name === "mobile-390px")
    )
      await screenshot(
        page,
        info,
        `incompatible-backups-${info.project.name}-${theme}.png`,
      );
    expect(
      (await readSaveRecords(page)).map((entry) => entry.metadata.id),
    ).toEqual(before);
  });

  test(`the cloud invitation is optional, once per device, and fits in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (mode) => localStorage.setItem("theme", mode),
      theme,
    );
    await startGame(page);
    const invitation = page.getByRole("dialog", {
      name: "Back up your saves to the cloud",
    });
    await expect(invitation).toBeHidden();
    await expect(page.locator("#appbar:visible .saveStatus")).toHaveCount(0);
    await page.getByRole("button", { name: "menu", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /Rename/ })).toHaveCount(0);
    await page
      .getByRole("menuitem", { name: "Save & Quit", exact: true })
      .click();
    await expect(invitation).toBeVisible();
    await expect(invitation).toContainText("even offline");
    await expect(invitation).toContainText("sign in later from Saved games");
    await checkDialogLayout(page, "Back up your saves to the cloud", info);
    if (theme === "light" && info.project.name === "mobile-390px") {
      await screenshot(page, info, "cloud-invitation-mobile-light.png");
    }
    await invitation
      .getByRole("button", { name: "Continue without syncing", exact: true })
      .click();
    await expect(invitation).toBeHidden();
    const originalId = (await readSaveRecords(page))[0].metadata.id;
    const primary = page.getByRole("region", { name: "Primary actions" });
    await expect(primary.getByRole("button")).toHaveText([
      "Continue",
      "Start a new game",
      "Saved games",
    ]);
    await expect(
      primary.getByRole("button", { name: "Saved games", exact: true }),
    ).toHaveClass(/MuiButton-outlined/);
    if (theme === "light" && info.project.name === "desktop-chromium") {
      await screenshot(page, info, "main-menu-desktop-light.png");
    }
    if (theme === "dark" && info.project.name === "mobile-390px") {
      await screenshot(page, info, "main-menu-mobile-dark.png");
    }
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openSaves(page);
    await expect(
      page.getByText(
        "Saves stay on this device. Sign in for cloud backup and access on other devices.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in with Google", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Save game file")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Import", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    if (theme === "light" && info.project.name === "desktop-chromium") {
      await screenshot(page, info, "cloud-saves-desktop-light.png");
    }
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator("#appbar:visible")).toBeVisible();
    await expect(invitation).toBeHidden();
    expect((await readSaveRecords(page))[0].metadata.id).toBe(originalId);
  });

  test(`sharing explains the snapshot and account requirement in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("electrify-cloud-save-prompt-seen", "true");
    }, theme);
    await startGame(page);
    await openSaves(page);
    const records = await readSaveRecords(page);
    await page
      .locator("article.saveEntry")
      .getByRole("button", { name: /^Actions for/ })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Export", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Share", exact: true }).click();
    const sharing = page.getByRole("dialog", { name: "Share a frozen copy" });
    await expect(sharing).toContainText("Your later changes won't affect it");
    await expect(sharing).toContainText(
      "expires after a year without being opened",
    );
    await expect(sharing).toContainText("No account is needed to open it");
    await expect(
      sharing.getByRole("button", { name: "Sign in and share", exact: true }),
    ).toBeEnabled();
    await checkDialogLayout(page, "Share a frozen copy", info);
    if (theme === "dark" && info.project.name === "mobile-390px") {
      await screenshot(page, info, "share-save-mobile-dark.png");
    }
    await sharing.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sharing).toBeHidden();
    expect(
      (await readSaveRecords(page)).map((entry) => entry.metadata.id),
    ).toEqual(records.map((entry) => entry.metadata.id));
  });
}

test("an invalid shared link is explained and closing keeps other URL parameters", async ({
  page,
}, info) => {
  await page.goto("/?game=invalid!&scenario=101");
  const shared = page.getByRole("dialog", { name: "Shared game", exact: true });
  await expect(shared).toBeVisible();
  await expect(shared.getByRole("alert")).toHaveText(
    "This share link is invalid.",
  );
  await checkDialogLayout(page, "Shared game", info);
  await shared.getByRole("button", { name: "Close", exact: true }).click();
  await expect(shared).toBeHidden();
  expect(new URL(page.url()).searchParams.has("game")).toBe(false);
  expect(new URL(page.url()).searchParams.get("scenario")).toBe("101");
  expect(await readSaveRecords(page)).toHaveLength(0);
});

test("Settings links to save management and explains cloud backup", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const data = page.getByRole("region", { name: "Game data", exact: true });
  await expect(data).toContainText("Resume, rename, share, or delete saves");
  await expect(data).toContainText(
    "Sign in for cloud backup and access on other devices",
  );
  expect(
    await page
      .locator(".scrollable:visible")
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await data.getByRole("button", { name: "Manage saves", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Saved games", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No saved games yet", exact: true }),
  ).toBeVisible();
});
