import { expect, test } from "./fixtures";
import { openBuild } from "./layout";
import { reviewScreenshot } from "./review-screenshot";

for (const theme of ["light", "dark"] as const) {
  test(`generator listing works before its first forecast in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      const send = Worker.prototype.postMessage;
      const held: (() => void)[] = [];
      let hold = true;
      let requests = 0;
      Object.defineProperty(window, "buildQuoteRequests", {
        get: () => requests,
      });
      Object.defineProperty(window, "releaseBuildQuotes", {
        value: () => {
          hold = false;
          held.splice(0).forEach((dispatch) => dispatch());
        },
      });
      Worker.prototype.postMessage = function (
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        const dispatch = () =>
          send.call(this, message, options as StructuredSerializeOptions);
        if (
          message &&
          typeof message === "object" &&
          "kind" in message &&
          message.kind === "build"
        ) {
          requests++;
          if (hold) {
            held.push(dispatch);
            return;
          }
        }
        dispatch();
      };
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    // Work must start before the player opens Build, even on a completely fresh run.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { buildQuoteRequests: number })
              .buildQuoteRequests,
        ),
      )
      .toBeGreaterThan(0);
    const build = await openBuild(page);
    await expect(build.getByRole("status")).toHaveText(
      "Calculating output and energy costs…",
    );
    const solar = build.locator('[data-build-option="Solar"]');
    const gas = build.locator('[data-build-option="Natural Gas Peaker"]');
    await expect(solar).toBeVisible();
    await expect(
      solar.getByRole("button", { name: "Review purchase of Solar" }),
    ).toBeDisabled();
    await expect(
      gas.getByRole("button", {
        name: "Review purchase of Natural Gas Peaker",
      }),
    ).toBeEnabled();
    await expect(solar).toContainText("Calculating output");
    const slider = build.getByRole("slider");
    await slider.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await solar.getByRole("button", { name: "Show Solar details" }).click();
    await expect(
      solar.getByRole("row", { name: /Lifetime cost/ }),
    ).toContainText("Calculating");
    expect(
      await build.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await reviewScreenshot(page, {
      path: info.outputPath(`pending-${theme}.png`),
      animations: "disabled",
    });
    await page.evaluate(() =>
      (
        window as unknown as { releaseBuildQuotes: () => void }
      ).releaseBuildQuotes(),
    );
    await expect(build.getByRole("status")).toHaveCount(0);
    await expect(
      solar.getByRole("button", { name: "Review purchase of Solar" }),
    ).toBeEnabled();
    await expect(
      solar.getByRole("img", { name: /^Typical year/ }),
    ).toBeVisible();
    await expect(
      solar.getByRole("row", { name: /Lifetime cost/ }),
    ).not.toContainText("Calculating");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await build
      .getByRole("button", { name: "Close Build", exact: true })
      .click();
    await openBuild(page);
    await expect(
      solar.getByRole("img", { name: /^Typical year/ }),
    ).toBeVisible();
    await expect(build.getByRole("status")).toHaveCount(0);
    await reviewScreenshot(page, {
      path: info.outputPath(`ready-${theme}.png`),
      animations: "disabled",
    });
  });
}
