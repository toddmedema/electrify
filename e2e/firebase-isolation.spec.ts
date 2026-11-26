import { isolateFirebase } from "./firebase-isolation";
import { expect, test } from "./fixtures";

const firestore = "https://firestore.googleapis.com/";
const authProbe =
  "https://identitytoolkit.googleapis.com/firebase-isolation-probe";

test("a game starts with the local unavailable leaderboard fixture", async ({
  page,
}) => {
  const read = page.waitForEvent("requestfailed", (request) =>
    request
      .url()
      .startsWith(`${firestore}google.firestore.v1.Firestore/Listen/channel?`),
  );
  await page.goto("/?scenario=111");
  expect((await read).failure()?.errorText).toBe(
    "net::ERR_INTERNET_DISCONNECTED",
  );
  await expect(
    page
      .getByRole("table")
      .getByText("Complete this mission to join the leaderboard"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator("#appbar:visible")).toBeVisible();
});

test("a page mock can answer a Firebase request", async ({ page }) => {
  await page.route(authProbe, (route) =>
    route.fulfill({ json: { fixture: true } }),
  );
  const response = await page.goto(authProbe);
  expect(await response?.json()).toEqual({ fixture: true });
});

test("the Firebase guard rejects an unmocked request and reports the endpoint", async ({
  browser,
}) => {
  // Own the isolated context here so the test can inspect the expected teardown error.
  const context = await browser.newContext();
  try {
    const assertIsolated = await isolateFirebase(context);
    const page = await context.newPage();
    await expect(page.goto(authProbe)).rejects.toThrow(
      "net::ERR_BLOCKED_BY_CLIENT",
    );
    expect(assertIsolated).toThrow(`GET ${authProbe}`);
  } finally {
    await context.close();
  }
});

test("Chromium blocks a Firebase request continued past the Playwright guard", async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const assertIsolated = await isolateFirebase(context);
    const page = await context.newPage();
    await page.route(authProbe, (route) => route.continue());
    await expect(page.goto(authProbe)).rejects.toThrow(
      "net::ERR_NAME_NOT_RESOLVED",
    );
    expect(assertIsolated).toThrow(`GET ${authProbe}`);
  } finally {
    await context.close();
  }
});
