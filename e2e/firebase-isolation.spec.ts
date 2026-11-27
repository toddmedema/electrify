import { isolateFirebase } from "./firebase-isolation";
import { expect, test } from "./fixtures";

const firestore = "https://firestore.googleapis.com/";
const authProbe =
  "https://identitytoolkit.googleapis.com/firebase-isolation-probe";
const database = "projects/electrify-game/databases/(default)";
const listenPath = "/google.firestore.v1.Firestore/Listen/channel";

// If an isolation rule regresses, this spec must fail without dialing that host.
test.use({
  launchOptions: async ({ launchOptions }, use) => {
    const prefix = "--host-resolver-rules=";
    const args = launchOptions.args ?? [];
    const existing = args.find((arg) => arg.startsWith(prefix));
    const loopback = [firestore, authProbe]
      .map((probe) => `MAP ${new URL(probe).hostname} 127.0.0.1`)
      .join(",");
    await use({
      ...launchOptions,
      args: [
        ...args.filter(
          (arg) => !arg.startsWith(prefix) && arg !== "--no-proxy-server",
        ),
        "--no-proxy-server",
        `${existing ? existing + "," : prefix}${loopback}`,
      ],
    });
  },
});

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

test("a profile rename scores lookup needs an explicit fixture", async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const assertIsolated = await isolateFirebase(context);
    const page = await context.newPage();
    const url = new URL(listenPath, firestore);
    url.searchParams.set("database", database);
    const read = page.waitForEvent(
      "requestfailed",
      (request) => request.url() === url.href && request.method() === "POST",
    );
    await page.evaluate(
      async ({ url, database }) => {
        const message = {
          addTarget: {
            query: {
              parent: `${database}/documents`,
              structuredQuery: {
                from: [{ collectionId: "scores" }],
                where: {
                  fieldFilter: {
                    field: { fieldPath: "uid" },
                    op: "EQUAL",
                    value: { stringValue: "fixture-user" },
                  },
                },
                limit: 100,
              },
            },
            targetId: 2,
          },
        };
        await fetch(url, {
          method: "POST",
          mode: "no-cors",
          body: new URLSearchParams({
            count: "1",
            ofs: "0",
            req0___data__: JSON.stringify(message),
          }),
        }).catch(() => {});
      },
      { url: url.href, database },
    );
    expect((await read).failure()?.errorText).toMatch(
      /^net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/,
    );
    expect(assertIsolated).toThrow(`POST ${url.origin}${url.pathname}`);
  } finally {
    await context.close();
  }
});

test(
  "the shared fixture flags an unmocked Firebase request at teardown",
  {
    annotation: {
      type: "expected-error",
      description: `Error: Unexpected Firebase request blocked. Add a local Playwright mock or use an emulator.
GET ${authProbe}`,
    },
  },
  async ({ page }) => {
    await expect(page.goto(authProbe)).rejects.toThrow(
      "net::ERR_BLOCKED_BY_CLIENT",
    );
    test.fail(true, "The Firebase guard must fail fixture teardown");
  },
);

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
