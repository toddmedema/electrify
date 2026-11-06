import path from "node:path";
import { expect, test } from "./fixtures";
import { expectSignInButtonsToFit } from "./layout";

for (const theme of ["light", "dark"]) {
  test(`account providers stay side by side in ${theme}`, async ({
    page,
    context,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=101");
    await expectSignInButtonsToFit(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expectSignInButtonsToFit(page);
    const mailingList = page.getByRole("checkbox", {
      name: "Join the Electrify mailing list",
    });
    await mailingList.check();
    await expect(mailingList).toBeChecked();
    await mailingList.uncheck();
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      ((theme === "light" && info.project.name === "desktop-chromium") ||
        (theme === "dark" && info.project.name === "mobile-360px"))
    ) {
      await page
        .getByRole("button", { name: "Sign in with Apple", exact: true })
        .scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `sign-in-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(mailingList).not.toBeChecked();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page
      .getByRole("button", { name: "Achievements", exact: true })
      .click();
    const gallery = page.locator(".achievementCard");
    await expectSignInButtonsToFit(gallery);
    await context.setOffline(true);
    await expect(gallery.getByRole("checkbox")).toBeDisabled();
    for (const name of ["Google", "Apple"]) {
      await expect(
        gallery.getByRole("button", {
          name: `Sign in with ${name}`,
          exact: true,
        }),
      ).toBeDisabled();
    }
  });
}
