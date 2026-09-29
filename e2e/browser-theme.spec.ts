import { expect, Page, test } from "@playwright/test";

async function expectTheme(page: Page, mode: "light" | "dark") {
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  await expect(page.locator("html")).toHaveCSS("color-scheme", mode);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
    "content",
    mode,
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    mode === "dark" ? "#121212" : "#ffffff",
  );
}

for (const scenario of [
  { system: "dark", saved: null, expected: "dark" },
  { system: "light", saved: null, expected: "light" },
  { system: "dark", saved: "light", expected: "light" },
  { system: "light", saved: "dark", expected: "dark" },
  { system: "dark", saved: "system", expected: "dark" },
  { system: "dark", saved: "invalid", expected: "dark" },
  { system: "dark", saved: "blocked", expected: "dark" },
] as const) {
  test(`first paint: system ${scenario.system}, saved ${scenario.saved}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scenario.system });
    await page.addInitScript((saved) => {
      localStorage.clear();
      if (saved === "blocked") {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new DOMException("Storage blocked", "SecurityError");
          },
        });
      } else if (saved) localStorage.setItem("theme", saved);
    }, scenario.saved);
    // Exercise the real HTML with neither React nor its stylesheet available.
    await page.route("**/*", (route) =>
      route.request().resourceType() === "document"
        ? route.continue()
        : route.abort(),
    );
    await page.goto("/");
    await expect(page.locator("#root")).toBeEmpty();
    await expectTheme(page, scenario.expected);
    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      scenario.expected === "dark" ? "rgb(11, 16, 22)" : "rgb(255, 255, 255)",
    );
  });
}

test("browser chrome follows appearance, system changes and resume", async ({
  page,
}, info) => {
  await page.addInitScript(() => localStorage.clear());
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expectTheme(page, "light");
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expectTheme(page, "dark");

  for (const event of ["pageshow", "visibilitychange"]) {
    await page.evaluate((event) => {
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", "#ffffff");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", "light");
      document.documentElement.style.colorScheme = "light";
      if (event === "pageshow")
        window.dispatchEvent(
          new PageTransitionEvent(event, { persisted: true }),
        );
      else document.dispatchEvent(new Event(event));
    }, event);
    await expectTheme(page, "dark");
  }
  if (process.env.PR_SCREENSHOTS) {
    if (info.project.name === "desktop-chromium") {
      await page.emulateMedia({ colorScheme: "light" });
      await expectTheme(page, "light");
    }
    await expect(page.locator(".MuiTouchRipple-ripple")).toHaveCount(0);
    await page.screenshot({
      path: `.tmp/pr-theme-${info.project.name}.png`,
      animations: "disabled",
    });
  }
});
