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
type Backdrop = {
  kind: "overlay-backdrop";
  owner: string;
  version: number;
  captureId: number;
  viewport: { width: number; height: number };
  snapshots: {
    seatId: string;
    generation: number;
    bounds: { x: number; y: number; width: number; height: number };
    image: string;
  }[];
};

type InputPhase =
  "baseline" | "overlayVisible" | "overlayHidden" | "afterClear";
type InputProbe = Record<InputPhase, { keyboard: number; mouse: number }>;
const inputMarkers = {
  baseline: { keyCode: "K", mouseModifier: undefined },
  overlayVisible: { keyCode: "O", mouseModifier: "alt" },
  overlayHidden: { keyCode: "L", mouseModifier: "control" },
  afterClear: { keyCode: "Z", mouseModifier: "shift" },
} as const;

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
      inset: 0,
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
        contentSize: window.getContentSize(),
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
    expect(seat.bounds.y + seat.bounds.height).toBe(native.contentSize[1]);
  }
  expect(native.seats[0].bounds.x).toBe(0);
  expect(native.seats[1].bounds.x + native.seats[1].bounds.width).toBe(
    native.contentSize[0],
  );
  expect(native.seats[0].bounds.x + native.seats[0].bounds.width).toBeLessThan(
    native.seats[1].bounds.x,
  );
  // The shell cannot paint over native child views. Its menu backdrop must be
  // captured from the actual paused pages and painted before those views hide.
  for (const page of [p1, p2])
    await page.evaluate((markers) => {
      const probe = globalThis as unknown as { couchInputProbe: InputProbe };
      probe.couchInputProbe = {
        baseline: { keyboard: 0, mouse: 0 },
        overlayVisible: { keyboard: 0, mouse: 0 },
        overlayHidden: { keyboard: 0, mouse: 0 },
        afterClear: { keyboard: 0, mouse: 0 },
      };
      window.addEventListener(
        "keydown",
        (event) => {
          const phase = Object.entries(markers).find(
            ([, marker]) => marker.keyCode === event.key.toUpperCase(),
          )?.[0] as InputPhase | undefined;
          if (phase) probe.couchInputProbe[phase].keyboard++;
        },
        true,
      );
      window.addEventListener(
        "mousedown",
        (event) => {
          const modifier = event.altKey
            ? "alt"
            : event.ctrlKey
              ? "control"
              : event.shiftKey
                ? "shift"
                : undefined;
          const phase = Object.entries(markers).find(
            ([, marker]) => marker.mouseModifier === modifier,
          )?.[0] as InputPhase | undefined;
          if (phase) probe.couchInputProbe[phase].mouse++;
        },
        true,
      );
    }, inputMarkers);
  const sendNativeInput = (id: number, phase: InputPhase) =>
    desktop.app.evaluate(
      ({ webContents }, { targetId, marker }) => {
        const contents = webContents.fromId(targetId)!;
        const modifiers = marker.mouseModifier ? [marker.mouseModifier] : [];
        contents.focus();
        contents.sendInputEvent({ type: "keyDown", keyCode: marker.keyCode });
        contents.sendInputEvent({ type: "keyUp", keyCode: marker.keyCode });
        contents.sendInputEvent({
          type: "mouseDown",
          x: 24,
          y: 24,
          button: "left",
          clickCount: 1,
          modifiers,
        });
        contents.sendInputEvent({
          type: "mouseUp",
          x: 24,
          y: 24,
          button: "left",
          clickCount: 1,
          modifiers,
        });
      },
      { targetId: id, marker: inputMarkers[phase] },
    );
  const inputProbe = (page: Page) =>
    page.evaluate(
      () =>
        (globalThis as unknown as { couchInputProbe: InputProbe })
          .couchInputProbe,
    );
  await sendNativeInput(native.seats[0].id, "baseline");
  await expect
    .poll(async () => (await inputProbe(p1)).baseline)
    .toEqual({ keyboard: 1, mouse: 1 });
  const initialOverlay = await desktop.page.evaluate(
    async () =>
      (await window.electrifyDesktop!.couchRequest!({
        kind: "overlay",
        seatId: "local-p2",
      })) as {
        overlay: { owner: string; version: number; captureId: number };
      },
  );
  const latestBackdrop = () =>
    desktop.page.evaluate(() =>
      (globalThis as unknown as { couchAudit: Backdrop[] }).couchAudit.findLast(
        (event) => event.kind === "overlay-backdrop" && !!event.owner,
      ),
    );
  await expect
    .poll(async () => (await latestBackdrop())?.captureId)
    .toBe(initialOverlay.overlay.captureId);
  const backdrop = (await latestBackdrop())!;
  expect(backdrop.snapshots).toHaveLength(2);
  expect(backdrop.snapshots.map((snapshot) => snapshot.bounds)).toEqual(
    native.seats.map((seat) => seat.bounds),
  );
  expect(backdrop.viewport).toEqual({
    width: native.contentSize[0],
    height: native.contentSize[1],
  });
  const inspectNativeImages = (snapshot: Backdrop) =>
    desktop.app.evaluate(
      ({ nativeImage }, images) =>
        images.map(({ image }) => {
          const decoded = nativeImage.createFromDataURL(image);
          return {
            empty: decoded.isEmpty(),
            size: decoded.getSize(),
            bytes: decoded.toPNG().length,
          };
        }),
      snapshot.snapshots,
    );
  for (const image of await inspectNativeImages(backdrop)) {
    expect(image.empty).toBe(false);
    expect(image.size.width).toBeGreaterThan(0);
    expect(image.size.height).toBeGreaterThan(0);
    expect(Math.max(image.size.width, image.size.height)).toBeLessThanOrEqual(
      2048,
    );
    expect(image.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  }
  const nativeVisibility = () =>
    desktop.app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return window.contentView.children
        .filter(
          (view): view is Electron.WebContentsView =>
            view instanceof WebContentsView,
        )
        .map((view) => view.getVisible());
    });
  expect(await nativeVisibility()).toEqual([true, true]);
  // Keep the visible-view attempt distinct from later hidden-view input and
  // post-clear receipts, so delayed leaks cannot count as successful sentinels.
  for (const seat of native.seats)
    await sendNativeInput(seat.id, "overlayVisible");
  expect(
    await desktop.page.evaluate(
      ({ version, captureId }) =>
        window.electrifyDesktop!.couchRequest!({
          kind: "overlay-ready",
          version,
          captureId,
        }),
      { version: backdrop.version, captureId: backdrop.captureId - 1 },
    ),
  ).toBe(false);
  expect(await nativeVisibility()).toEqual([true, true]);
  expect(
    await desktop.page.evaluate(
      ({ version, captureId }) =>
        window.electrifyDesktop!.couchRequest!({
          kind: "overlay-ready",
          version,
          captureId,
        }),
      backdrop,
    ),
  ).toBe(true);
  expect(await nativeVisibility()).toEqual([false, false]);
  for (const seat of native.seats)
    await sendNativeInput(seat.id, "overlayHidden");
  await desktop.page.evaluate(() =>
    window.electrifyDesktop!.couchRequest!({ kind: "refresh-overlay" }),
  );
  await expect
    .poll(async () => (await latestBackdrop())?.captureId)
    .toBeGreaterThan(backdrop.captureId);
  const refreshed = (await latestBackdrop())!;
  expect(refreshed.snapshots).toHaveLength(2);
  expect(
    (await inspectNativeImages(refreshed)).every((image) => !image.empty),
  ).toBe(true);
  expect(await nativeVisibility()).toEqual([false, false]);
  await desktop.page.evaluate(() =>
    window.electrifyDesktop!.couchRequest!({ kind: "overlay", seatId: null }),
  );
  expect(await nativeVisibility()).toEqual([true, true]);
  // Both event pipelines on both seats must deliver a later marker before any
  // negative assertion. Wait for each focused seat before focusing its sibling.
  for (const [index, page] of [p1, p2].entries()) {
    await sendNativeInput(native.seats[index].id, "afterClear");
    await expect
      .poll(async () => (await inputProbe(page)).afterClear)
      .toEqual({ keyboard: 1, mouse: 1 });
  }
  for (const page of [p1, p2]) {
    const probe = await inputProbe(page);
    expect(probe.overlayVisible).toEqual({ keyboard: 0, mouse: 0 });
    expect(probe.overlayHidden).toEqual({ keyboard: 0, mouse: 0 });
  }
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
