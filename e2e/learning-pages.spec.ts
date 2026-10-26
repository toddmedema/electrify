import { expect, test } from "./fixtures";

const pages = [
  "/power-grid-simulator.html",
  "/classroom.html",
  "/energy-simulators.html",
  "/data-centers.html",
];

test.describe("learning pages without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const theme of ["light", "dark"] as const) {
    for (const pathname of pages) {
      test(`${pathname} remains readable and navigable in ${theme} mode`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: theme });
        const response = await page.goto(pathname);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByRole("main")).toBeVisible();
        const primary = page.locator(".hero .button--primary");
        await expect(primary).toBeVisible();
        if (pathname === "/data-centers.html")
          await expect(primary).toHaveAttribute("href", "/?dataCenters=1");
        else await expect(page.locator(".topnav a[href='/']")).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
        for (const panel of await page.locator(".panel").all()) {
          expect(
            await panel.evaluate(
              (element) => element.scrollWidth - element.clientWidth,
            ),
          ).toBeLessThanOrEqual(1);
        }
        for (const image of await page.locator("main img:visible").all()) {
          await image.scrollIntoViewIfNeeded();
          await expect(image).toBeVisible();
          await expect
            .poll(() =>
              image.evaluate(
                (element: HTMLImageElement) => element.naturalWidth,
              ),
            )
            .toBeGreaterThan(0);
        }

        // A reader must be able to get to these resources without running the game.
        await page.locator(".topnav a[href='/about.html']").click();
        await expect(page).toHaveURL(/\/about\.html$/);
        for (const linkedPage of pages.slice(0, 3)) {
          await expect(
            page.getByRole("main").locator(`a[href='${linkedPage}']`),
          ).toBeVisible();
        }
      });
    }
  }

  test("the classroom worksheet prints with answer space and without teacher notes", async ({
    page,
  }) => {
    await page.goto("/classroom.html");
    const worksheet = page.locator(".student-worksheet");
    await expect(worksheet).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(worksheet).toBeVisible();
    await expect(page.locator(".hero")).toBeHidden();
    await expect(page.locator(".topbar")).toBeHidden();
    await expect(page.locator(".site-footer")).toBeHidden();
    for (const section of await page
      .locator(".comparison-content > :not(.student-worksheet)")
      .all()) {
      await expect(section).toBeHidden();
    }
    const answers = worksheet.locator(".worksheet-answer");
    expect(await answers.count()).toBeGreaterThan(0);
    for (const answer of await answers.all()) {
      await expect(answer).toBeVisible();
      expect((await answer.boundingBox())!.height).toBeGreaterThanOrEqual(60);
    }
  });
});

test("the player page opens the playable game", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
  await page.goto("/power-grid-simulator.html");
  await page.locator(".hero .button--primary").click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
});
