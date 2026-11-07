import { expect, test, Page } from "@playwright/test";
import {
  closeDesktop,
  createDesktopProfile,
  DesktopSession,
  launchDesktop,
  removeDesktopProfile,
} from "./desktop-fixture";

// Selected by desktop.playwright.config.ts's desktop*.spec.ts pattern. Like the
// other native specs, this runs in CI or with an explicit --headed local opt-in.
let desktop: DesktopSession;
let profile: string;

async function seatPage(seatId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of desktop.app.context().pages()) {
        const id = await page
          .evaluate(() => window.electrifyCouch?.seatId)
          .catch(() => undefined);
        if (id === seatId) found = page;
      }
      return !!found;
    })
    .toBe(true);
  return found!;
}

test.beforeEach(async () => {
  profile = await createDesktopProfile();
  desktop = await launchDesktop(profile, { couchPreview: true });
});

test.afterEach(async ({}, info) => {
  try {
    if (desktop)
      await closeDesktop(desktop, {
        force: info.status !== info.expectedStatus,
      });
  } finally {
    if (profile) await removeDesktopProfile(profile);
  }
});

test("native couch views isolate roles, storage, ports and zoom and dispose on exit", async () => {
  await desktop.app.evaluate(async ({ app, BrowserWindow }) => {
    const nativeRequire = process
      .getBuiltinModule("module")
      .createRequire(`${app.getAppPath()}/package.json`);
    const { setFullscreen } = nativeRequire(
      `${app.getAppPath()}/electron/display.cjs`,
    );
    const window = BrowserWindow.getAllWindows()[0];
    await setFullscreen(window, false);
    window.setContentSize(1920, 1080);
  });
  await desktop.page.evaluate(() => {
    const audit = globalThis as unknown as { couchAudit: unknown[] };
    audit.couchAudit = [];
    window.electrifyDesktop!.onCouchEvent!((event) => {
      audit.couchAudit.push(event);
    });
  });
  await desktop.page.evaluate(() =>
    window.electrifyDesktop!.couchRequest!({
      kind: "open",
      seats: [
        { id: "local-p1", name: "North Power" },
        { id: "local-p2", name: "South Power" },
      ],
      zoom: 1.5,
      inset: 16,
      gutter: 8,
      bandHeight: 96,
    }),
  );
  const p1 = await seatPage("local-p1");
  const p2 = await seatPage("local-p2");
  await expect(p1.locator("html")).toHaveAttribute(
    "data-couch-seat",
    "local-p1",
  );
  await expect(p2.locator("html")).toHaveAttribute(
    "data-couch-seat",
    "local-p2",
  );
  for (const page of [p1, p2]) {
    expect(
      await page.evaluate(() => ({
        role: window.electrifyCouch?.role,
        shellControl: typeof window.electrifyDesktop?.couchRequest,
        accountSaves: typeof window.electrifyDesktop?.readSaveLibrary,
        require: typeof (globalThis as unknown as { require?: unknown })
          .require,
      })),
    ).toEqual({
      role: "seat",
      shellControl: "undefined",
      accountSaves: "undefined",
      require: "undefined",
    });
  }
  await p1.evaluate(() => localStorage.setItem("couch-isolation-probe", "P1"));
  expect(
    await p2.evaluate(() => localStorage.getItem("couch-isolation-probe")),
  ).toBeNull();
  expect(
    await desktop.page.evaluate(() =>
      localStorage.getItem("couch-isolation-probe"),
    ),
  ).toBeNull();

  const native = await desktop.app.evaluate(
    ({ BrowserWindow, WebContentsView }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const views = window.contentView.children.filter(
        (view): view is Electron.WebContentsView =>
          view instanceof WebContentsView &&
          view.webContents !== window.webContents,
      );
      return {
        shellZoom: window.webContents.getZoomFactor(),
        separateSessions:
          views[0].webContents.session !== views[1].webContents.session &&
          views.every(
            (view) => view.webContents.session !== window.webContents.session,
          ),
        seats: views.map((view) => ({
          id: view.webContents.id,
          persistent: view.webContents.session.isPersistent(),
          zoom: view.webContents.getZoomFactor(),
          mode: view.webContents.getZoomMode(),
          bounds: view.getBounds(),
          protocol: new URL(view.webContents.getURL()).protocol,
        })),
      };
    },
  );
  expect(native.separateSessions).toBe(true);
  expect(native.seats).toHaveLength(2);
  for (const seat of native.seats) {
    expect(seat.persistent).toBe(false);
    expect(seat.zoom).toBe(1.5);
    expect(seat.mode).toBe("isolated");
    expect(seat.protocol).toBe("electrify:");
    expect(seat.bounds.width / seat.zoom).toBeGreaterThanOrEqual(360);
    expect(seat.bounds.y).toBe(96);
  }
  expect(native.seats[0].bounds.x + native.seats[0].bounds.width).toBeLessThan(
    native.seats[1].bounds.x,
  );
  await p1.evaluate(() => window.electrifyCouch!.post({ kind: "heartbeat" }));
  await expect
    .poll(() =>
      desktop.page.evaluate(() => {
        const events = (
          globalThis as unknown as {
            couchAudit: { kind: string; seatId?: string }[];
          }
        ).couchAudit;
        return events.some(
          (event) =>
            event.kind === "seat-message" && event.seatId === "local-p1",
        );
      }),
    )
    .toBe(true);
  // Unknown worker controls and caller-provided authority are never forwarded.
  await desktop.page.evaluate(() => {
    (globalThis as unknown as { couchAudit: unknown[] }).couchAudit = [];
  });
  await p1.evaluate(() => {
    window.electrifyCouch!.post({ kind: "restore", world: {} });
    window.electrifyCouch!.post({
      kind: "ack",
      delivery: 100001,
      sender: "local-p2",
    });
    window.electrifyCouch!.post({ kind: "ack", delivery: 100001 });
  });
  await expect
    .poll(() =>
      desktop.page.evaluate(() => {
        const events = (
          globalThis as unknown as {
            couchAudit: {
              kind: string;
              seatId?: string;
              message?: { kind: string; delivery?: number };
            }[];
          }
        ).couchAudit;
        return events.filter(
          (event) =>
            event.kind === "seat-message" &&
            event.message?.kind === "ack" &&
            event.message.delivery === 100001,
        ).length;
      }),
    )
    .toBe(1);
  // Changing just one view's isolated zoom must not alter its sibling or shell.
  await desktop.app.evaluate(({ BrowserWindow, WebContentsView }, targetId) => {
    const window = BrowserWindow.getAllWindows()[0];
    const view = window.contentView.children.find(
      (child): child is Electron.WebContentsView =>
        child instanceof WebContentsView && child.webContents.id === targetId,
    )!;
    view.webContents.setZoomFactor(1.75);
  }, native.seats[0].id);
  const changedZoom = await desktop.app.evaluate(
    ({ BrowserWindow, WebContentsView }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return {
        shell: window.webContents.getZoomFactor(),
        seats: window.contentView.children
          .filter(
            (view): view is Electron.WebContentsView =>
              view instanceof WebContentsView &&
              view.webContents !== window.webContents,
          )
          .map((view) => view.webContents.getZoomFactor()),
      };
    },
  );
  // Chromium stores zoom as a level; converting back can differ by one floating-point bit.
  expect(changedZoom.seats[0]).toBeCloseTo(1.75, 12);
  expect(changedZoom.shell).toBe(native.shellZoom);
  expect(changedZoom.seats[1]).toBe(native.seats[1].zoom);
  const oldGeneration = await p1.evaluate(() =>
    window.electrifyCouch!.getGeneration(),
  );
  await p1.reload();
  await expect(p1.locator("html")).toHaveAttribute(
    "data-couch-seat",
    "local-p1",
  );
  await expect
    .poll(() => p1.evaluate(() => window.electrifyCouch!.getGeneration()))
    .toBeGreaterThan(oldGeneration);
  expect(
    await desktop.page.evaluate(
      (generation) =>
        window.electrifyDesktop!.couchRequest!({
          kind: "send",
          seatId: "local-p1",
          generation,
          message: { kind: "pulse", generation },
        }),
      oldGeneration,
    ),
  ).toBe(false);
  expect(
    await p1.evaluate(() => localStorage.getItem("couch-isolation-probe")),
  ).toBe("P1");
  expect(
    await desktop.app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return window.contentView.children
        .filter(
          (view): view is Electron.WebContentsView =>
            view instanceof WebContentsView &&
            view.webContents !== window.webContents,
        )
        .map((view) => view.webContents.getZoomFactor());
    }),
  ).toEqual([1.5, 1.5]);
  await desktop.page.evaluate(() =>
    window.electrifyDesktop!.couchRequest!({ kind: "close" }),
  );
  await expect
    .poll(() =>
      desktop.app.evaluate(
        ({ webContents }, ids) => ids.every((id) => !webContents.fromId(id)),
        native.seats.map((seat) => seat.id),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      desktop.app.evaluate(
        ({ BrowserWindow, WebContentsView }) =>
          BrowserWindow.getAllWindows()[0].contentView.children.filter(
            (view) =>
              view instanceof WebContentsView &&
              view.webContents !== BrowserWindow.getAllWindows()[0].webContents,
          ).length,
      ),
    )
    .toBe(0);
});
