const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  couchLayout,
  validSeats,
  seatMessage,
  CouchViews,
} = require("./couch.cjs");
const seats = [
  { id: "local-p1", name: "One" },
  { id: "local-p2", name: "Two" },
];

test("couch layout fills the outer edges while retaining a center gutter and readable zoom", () => {
  const layout = couchLayout(1920, 1080, 2);
  assert.equal(layout.fits, true);
  assert.equal(layout.cssWidth, 956 / 1.5);
  for (const [width, height, count] of [
    [1920, 1080, 2],
    [1921, 1081, 2],
    [1921, 1081, 3],
    [1921, 1081, 4],
    [3840, 2160, 2],
  ]) {
    const edgeToEdge = couchLayout(width, height, count);
    const last = edgeToEdge.bounds.at(-1);
    assert.equal(edgeToEdge.bounds[0].x, 0);
    assert.equal(last.x + last.width, width);
    for (const bounds of edgeToEdge.bounds)
      assert.equal(bounds.y + bounds.height, height);
    for (let i = 1; i < edgeToEdge.bounds.length; i++)
      assert.equal(
        edgeToEdge.bounds[i].x -
          (edgeToEdge.bounds[i - 1].x + edgeToEdge.bounds[i - 1].width),
        edgeToEdge.gutter,
      );
  }
  const four = couchLayout(1920, 1080, 4, {
    inset: 24,
    gutter: 8,
    zoom: 4 / 3,
  });
  assert.equal(four.cssWidth, 346.5);
  assert.equal(four.fits, false);
  assert.equal(
    couchLayout(1920, 1080, 2).cssWidth,
    couchLayout(3840, 2160, 2, {
      zoom: 3,
      inset: 0,
      gutter: 16,
      bandHeight: 192,
    }).cssWidth,
  );
  assert.equal(couchLayout(800, 600, 2).fits, false);
  assert.throws(() => couchLayout(1920, 1080, 2, { zoom: 0.5 }));
});

test("logical roster rejects hardware identities and seat ports cannot claim a sender or worker controls", () => {
  assert.deepEqual(validSeats(seats), seats);
  assert.throws(() =>
    validSeats([{ id: "76561198000000000", name: "One" }, seats[1]]),
  );
  const command = {
    kind: "command",
    sequence: 1,
    epoch: "epoch",
    matchId: "match",
    command: { kind: "speed", speed: "NORMAL" },
  };
  assert.equal(seatMessage(command), true);
  assert.equal(seatMessage({ ...command, sender: "local-p2" }), false);
  assert.equal(seatMessage({ kind: "restore", world: {} }), false);
  assert.equal(seatMessage({ ...command, sequence: NaN }), false);
  assert.equal(seatMessage({ kind: "ack", delivery: 2 }), true);
  assert.equal(
    seatMessage({ kind: "global-settings", requestId: "settings-1" }),
    true,
  );
  assert.equal(seatMessage({ kind: "global-menu", requestId: "menu-1" }), true);
  assert.equal(
    seatMessage({
      kind: "global-menu",
      requestId: "menu-1",
      sender: "local-p2",
    }),
    false,
  );
  assert.equal(
    seatMessage({
      kind: "global-settings",
      requestId: "settings-1",
      sender: "local-p2",
    }),
    false,
  );
});

function fixture() {
  const views = [],
    events = [],
    partitions = [],
    ports = [];
  class View {
    constructor(options) {
      this.options = options;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: "electrify://app/index.html" },
        isDestroyed: () => false,
        setWindowOpenHandler: (callback) => {
          this.open = callback;
        },
        setZoomMode: (mode) => {
          this.zoomMode = mode;
        },
        setZoomFactor: (factor) => {
          this.zoom = factor;
        },
        loadURL: async () => {
          this.webContents.emit("did-finish-load");
        },
        reload: () => {
          this.webContents.emit("did-start-loading");
          this.webContents.emit("did-finish-load");
        },
        postMessage: (_channel, identity) => {
          this.identity = identity;
        },
        send: () => {},
        focus: () => {},
        capturePage: async () => ({
          isEmpty: () => false,
          getSize: () => ({ width: 960, height: 984 }),
          toPNG: () => Buffer.from("snapshot"),
        }),
        close: () => {
          this.closed = true;
        },
      });
      views.push(this);
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
    setVisible(visible) {
      this.visible = visible;
    }
  }
  class Channel {
    constructor() {
      this.port1 = Object.assign(new EventEmitter(), {
        start() {},
        close() {},
        postMessage(message) {
          this.message = message;
        },
      });
      this.port2 = {};
      ports.push(this.port1);
    }
  }
  const size = [1920, 1080];
  const host = {
    getContentSize: () => size,
    contentView: { addChildView() {}, removeChildView() {} },
    webContents: { focus() {} },
  };
  const manager = new CouchViews({
    window: host,
    WebContentsView: View,
    MessageChannelMain: Channel,
    prepareSession: async (partition) => {
      partitions.push(partition);
      return { partition };
    },
    input: () => undefined,
    publish: (event) => events.push(event),
    preload: "/preload",
    url: "electrify://app/index.html",
  });
  return { manager, views, events, partitions, ports, size };
}

test("exact top-frame bindings, authenticated ports, generations, isolated views and teardown", async () => {
  const { manager, views, events, partitions, ports } = fixture();
  await manager.open({ seats });
  assert.equal(new Set(partitions).size, 2);
  assert.ok(partitions.every((partition) => !partition.startsWith("persist:")));
  assert.ok(
    views.every((view) => view.zoomMode === "isolated" && view.zoom === 1.5),
  );
  assert.equal(
    manager.identify({
      sender: views[0].webContents,
      senderFrame: views[0].webContents.mainFrame,
    }).id,
    "local-p1",
  );
  assert.equal(
    manager.identify({
      sender: views[0].webContents,
      senderFrame: { url: "electrify://app/index.html" },
    }),
    undefined,
  );
  assert.equal(
    manager.identify({
      sender: {},
      senderFrame: views[0].webContents.mainFrame,
    }),
    undefined,
  );
  const command = {
    kind: "command",
    sequence: 1,
    epoch: "e",
    matchId: "m",
    command: {},
  };
  ports[0].emit("message", { data: command });
  ports[1].emit("message", { data: command });
  assert.deepEqual(
    events
      .filter((event) => event.kind === "seat-message")
      .map((event) => event.seatId),
    ["local-p1", "local-p2"],
  );
  const before = events.length;
  ports[0].emit("message", { data: { ...command, sender: "local-p2" } });
  assert.equal(events.length, before);
  const generation = views[0].identity.generation;
  manager.lost(manager.seats.get("local-p1"), "crash");
  assert.equal(
    manager.send({ seatId: "local-p1", generation, message: {} }),
    false,
  );
  manager.close();
  assert.ok(views.every((view) => view.closed));
  assert.equal(manager.seats.size, 0);
});

test("overlays retain paused screens until their captured backdrop is ready; invalid resize exposes shell recovery", async () => {
  const { manager, views, size, events } = fixture();
  await manager.open({ seats });
  manager.overlay("local-p2");
  assert.ok(views.every((view) => view.visible));
  await new Promise(setImmediate);
  const backdrop = events.findLast(
    (event) => event.kind === "overlay-backdrop",
  );
  assert.equal(backdrop.snapshots.length, 2);
  assert.equal(
    manager.overlayReady(backdrop.version, backdrop.captureId),
    true,
  );
  assert.ok(views.every((view) => !view.visible));
  manager.relayout();
  assert.ok(views.every((view) => !view.visible));
  manager.overlay(null);
  assert.ok(views.every((view) => view.visible));
  size[0] = 800;
  assert.equal(manager.relayout().layout.fits, false);
  assert.ok(views.every((view) => !view.visible));
  assert.equal(events.at(-1).kind, "layout");
  manager.close();
});

test("preload handshake publishes its current generation and retains a baseline through liveness pulses", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const exposed = {},
    listeners = new Map();
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "couch-preload.cjs"), "utf8"),
    {
      require: () => ({
        contextBridge: {
          exposeInMainWorld: (name, bridge) => {
            exposed[name] = bridge;
          },
        },
        ipcRenderer: {
          on: (channel, callback) => listeners.set(channel, callback),
          removeListener() {},
          invoke() {},
        },
      }),
      process: {
        argv: [
          "--electrify-couch-seat=local-p1",
          "--electrify-couch-generation=1",
        ],
      },
    },
  );
  let ready = false;
  void exposed.electrifyCouch.ready().then(() => {
    ready = true;
  });
  await Promise.resolve();
  assert.equal(ready, false);
  const port = { start() {}, postMessage() {}, close() {} };
  listeners.get("couch:port")(
    { ports: [port] },
    { seatId: "local-p1", generation: 3 },
  );
  await exposed.electrifyCouch.ready();
  assert.equal(exposed.electrifyCouch.getGeneration(), 3);
  const baseline = {
    kind: "view",
    delivery: 1,
    generation: 3,
    view: { revision: 2 },
  };
  port.onmessage({ data: baseline });
  for (let i = 0; i < 20; i++)
    port.onmessage({ data: { kind: "pulse", generation: 3 } });
  const received = [];
  exposed.electrifyCouch.onMessage((message) => received.push(message));
  assert.equal(received.length, 1);
  assert.equal(received[0], baseline);
});

test("explicit controller replacement revokes the old port generation without swapping companies", async () => {
  const { manager, views, ports, events } = fixture();
  manager.inputFrame([
    { id: "1", connected: true, actions: [], glyphs: {} },
    { id: "2", connected: true, actions: [], glyphs: {} },
  ]);
  manager.bind("local-p1", "1");
  manager.bind("local-p2", "2");
  assert.throws(() => manager.bind("local-p1", "2"), /already owns/);
  await manager.open({ seats });
  const oldGeneration = views[0].identity.generation;
  manager.bind("local-p1", "1");
  assert.ok(views[0].identity.generation > oldGeneration);
  assert.equal(manager.bindings.get("local-p1"), "1");
  assert.equal(manager.bindings.get("local-p2"), "2");
  const before = events.length;
  ports[0].emit("message", { data: { kind: "heartbeat" } });
  assert.equal(events.length, before);
  ports.at(-1).emit("message", { data: { kind: "heartbeat" } });
  assert.equal(events.at(-1).seatId, "local-p1");
  assert.equal(events.at(-1).generation, views[0].identity.generation);
  manager.close();
});

test("setup readiness confirmation remains seat-owned and cannot click a shell control", () => {
  const { manager } = fixture();
  manager.setup = true;
  manager.confirmOnly = true;
  manager.inputFrame([{ id: "1", connected: true, actions: [], glyphs: {} }]);
  manager.bind("local-p1", "1");
  const devices = [
    { id: "1", connected: true, actions: ["confirm", "right"], glyphs: {} },
  ];
  assert.deepEqual(manager.shellFrame(devices).actions, ["right"]);
  assert.deepEqual(devices[0].actions, ["confirm", "right"]);
  manager.confirmOnly = false;
  assert.deepEqual(manager.shellFrame(devices).actions, ["confirm", "right"]);
  manager.close();
});

test("closing a global overlay restores each seat's own action context", async () => {
  const { manager } = fixture();
  await manager.open({ seats });
  const contexts = new Map();
  manager.input = () => ({
    setDeviceContext: (id, context) => {
      contexts.set(id, context);
      return {};
    },
    releaseDevice() {},
    setDeviceMode() {},
    deviceContexts: new Map(),
    setContext() {},
  });
  manager.bindings.set("local-p1", "1");
  manager.bindings.set("local-p2", "2");
  const p1 = manager.seats.get("local-p1"),
    p2 = manager.seats.get("local-p2");
  manager.setContext(p1, "Gameplay");
  manager.setContext(p2, "Menu");
  manager.overlay("local-p1");
  assert.equal(contexts.get("1"), "Menu");
  assert.equal(contexts.get("2"), "Menu");
  manager.overlay(null);
  assert.equal(contexts.get("1"), "Gameplay");
  assert.equal(contexts.get("2"), "Menu");
  assert.throws(() => manager.setContext(p1, "forged"));
  assert.equal(p1.context, "Gameplay");
  manager.close();
});

test("a resumed campaign with retired P1 can use its explicitly assigned active P2 controller for setup", () => {
  const { manager } = fixture();
  manager.setup = true;
  manager.inputFrame([{ id: "2", connected: true, actions: [], glyphs: {} }]);
  manager.bind("local-p2", "2");
  const devices = [
    { id: "2", connected: true, actions: ["right"], glyphs: {} },
  ];
  assert.equal(manager.shellOwner(), "local-p2");
  assert.deepEqual(manager.shellFrame(devices).actions, ["right"]);
  assert.equal(manager.bindings.has("local-p1"), false);
  manager.close();
});

test("closing while a partition is preparing cannot create orphaned seats or close a newer session", async () => {
  const { manager, views } = fixture();
  const prepared = Promise.withResolvers();
  manager.prepareSession = () => prepared.promise;
  const opening = manager.open({ seats });
  manager.close();
  manager.prepareSession = async () => ({});
  await manager.open({ seats });
  assert.equal(views.length, 2);
  prepared.resolve({});
  await assert.rejects(opening, /closed while starting/);
  assert.equal(manager.seats.size, 2);
  assert.ok(views.every((view) => !view.closed));
  manager.close();
});

test("a later-loading seat stays hidden beneath an already acknowledged global overlay", async () => {
  const { manager, views, events } = fixture();
  const secondPartition = Promise.withResolvers();
  const preparingSecond = Promise.withResolvers();
  let count = 0;
  manager.prepareSession = async () => {
    if (++count === 1) return {};
    preparingSecond.resolve();
    return secondPartition.promise;
  };
  const opening = manager.open({ seats });
  await preparingSecond.promise;
  manager.overlay("local-p1");
  assert.equal(views.length, 1);
  await new Promise(setImmediate);
  const first = events.findLast((event) => event.kind === "overlay-backdrop");
  assert.equal(manager.overlayReady(first.version, first.captureId), true);
  assert.equal(views[0].visible, false);
  secondPartition.resolve({});
  await opening;
  assert.equal(views.length, 2);
  assert.ok(views.every((view) => !view.visible));
  await new Promise(setImmediate);
  const latest = events.findLast((event) => event.kind === "overlay-backdrop");
  assert.equal(latest.snapshots.length, 2);
  assert.equal(manager.overlayReady(first.version, first.captureId), false);
  assert.equal(manager.overlayReady(latest.version, latest.captureId), true);
  manager.overlay(null);
  assert.ok(views.every((view) => view.visible));
  manager.close();
});

test("pending and committed backdrops gate native keyboard, pointer and both controllers", async () => {
  const { manager, views, events } = fixture();
  await manager.open({ seats });
  const delivered = [];
  let focused = 0;
  manager.window.webContents.focus = () => focused++;
  manager.bindings.set("local-p1", "1");
  manager.bindings.set("local-p2", "2");
  for (const view of views)
    view.webContents.send = (channel) => delivered.push(channel);
  const frames = [
    { id: "1", connected: true, actions: ["confirm"], glyphs: {} },
    { id: "2", connected: true, actions: ["menu"], glyphs: {} },
  ];
  const nativeBlocked = () =>
    views.every((view) =>
      ["before-input-event", "before-mouse-event"].every((name) => {
        let blocked = false;
        view.webContents.emit(name, {
          preventDefault: () => (blocked = true),
        });
        return blocked;
      }),
    );
  assert.equal(nativeBlocked(), false);
  const status = manager.overlay("local-p2");
  assert.equal(status.overlay.owner, "local-p2");
  assert.equal(nativeBlocked(), true);
  assert.equal(
    manager.overlayReady(status.overlay.version, status.overlay.captureId),
    false,
  );
  manager.inputFrame(frames);
  assert.deepEqual(delivered, []);
  assert.equal(manager.shellFrame(frames).id, "2");
  views[0].webContents.emit("focus");
  assert.equal(focused, 2);
  await new Promise(setImmediate);
  const backdrop = events.findLast(
    (event) => event.kind === "overlay-backdrop",
  );
  assert.deepEqual(backdrop.viewport, { width: 1920, height: 1080 });
  assert.deepEqual(
    backdrop.snapshots.map(({ seatId, generation, bounds, image }) => ({
      seatId,
      generation,
      bounds,
      image,
    })),
    seats.map((seat, i) => ({
      seatId: seat.id,
      generation: views[i].identity.generation,
      bounds: manager.layout.bounds[i],
      image: `data:image/png;base64,${Buffer.from("snapshot").toString("base64")}`,
    })),
  );
  assert.equal(
    manager.overlayReady(backdrop.version, backdrop.captureId),
    true,
  );
  assert.equal(nativeBlocked(), true);
  manager.overlay(null);
  assert.equal(nativeBlocked(), false);
  assert.equal(manager.status().overlay, null);
  assert.equal(events.at(-1).owner, null);
  assert.equal(
    manager.overlayReady(backdrop.version, backdrop.captureId),
    false,
  );
  manager.inputFrame(frames);
  assert.equal(delivered.length, 2);
  assert.throws(
    () => manager.overlay("local-p4"),
    /Invalid global dialog owner/,
  );
  manager.close();
});

test("late captures and ready acknowledgements cannot cross close, reopen, layout or generation changes", async () => {
  const { manager, views, events } = fixture();
  await manager.open({ seats });
  const pending = Promise.withResolvers();
  const original = views[0].webContents.capturePage;
  views[0].webContents.capturePage = () => pending.promise;
  const first = manager.overlay("local-p1").overlay;
  manager.overlay(null);
  views[0].webContents.capturePage = original;
  const reopened = manager.overlay("local-p1").overlay;
  manager.relayout({ bandHeight: 120 });
  const afterLayout = manager.status().overlay;
  manager.lost(manager.seats.get("local-p2"), "renderer-crash");
  const afterGeneration = manager.status().overlay;
  pending.resolve(await original());
  await new Promise(setImmediate);
  const published = events.filter(
    (event) => event.kind === "overlay-backdrop" && event.owner,
  );
  assert.equal(published.length, 1);
  assert.equal(published[0].captureId, afterGeneration.captureId);
  assert.equal(
    published[0].snapshots[1].generation,
    manager.seats.get("local-p2").generation,
  );
  for (const stale of [first, reopened, afterLayout])
    assert.equal(manager.overlayReady(stale.version, stale.captureId), false);
  assert.ok(views.every((view) => view.visible));
  assert.equal(
    manager.overlayReady(afterGeneration.version, afterGeneration.captureId),
    true,
  );
  assert.ok(views.every((view) => !view.visible));
  manager.close();
  assert.equal(
    manager.overlayReady(afterGeneration.version, afterGeneration.captureId),
    false,
  );
});

test("hidden refreshes bound images and capture failures still allow the shared menu to recover", async () => {
  const { manager, views, events } = fixture();
  await manager.open({ seats });
  let resized;
  const options = [];
  views[0].webContents.capturePage = async (rect, opts) => {
    options.push({ rect, opts });
    return {
      isEmpty: () => false,
      getSize: () => ({ width: 4000, height: 2000 }),
      resize: (size) => {
        resized = size;
        return { toPNG: () => Buffer.from("bounded") };
      },
    };
  };
  views[1].webContents.capturePage = async () => {
    throw new Error("Renderer failed");
  };
  manager.overlay("local-p1");
  await new Promise(setImmediate);
  let backdrop = events.findLast((event) => event.kind === "overlay-backdrop");
  assert.deepEqual(resized, { width: 2048, height: 1024, quality: "good" });
  assert.equal(backdrop.snapshots.length, 1);
  assert.equal(
    manager.overlayReady(backdrop.version, backdrop.captureId),
    true,
  );
  const version = manager.overlayVersion;
  views[0].webContents.capturePage = async () => ({
    isEmpty: () => false,
    getSize: () => ({ width: 960, height: 984 }),
    toPNG: () => Buffer.alloc(4 * 1024 * 1024 + 1),
  });
  manager.refreshOverlay();
  assert.ok(views.every((view) => !view.visible));
  await new Promise(setImmediate);
  backdrop = events.findLast((event) => event.kind === "overlay-backdrop");
  assert.deepEqual(backdrop.snapshots, []);
  assert.equal(manager.overlayVersion, version);
  assert.equal(
    manager.overlayReady(backdrop.version, backdrop.captureId),
    true,
  );
  assert.deepEqual(options, [{ rect: undefined, opts: { stayHidden: true } }]);
  manager.close();
});

test("a nonresponsive capture reaches a bounded fallback instead of trapping the shared menu", async (t) => {
  const { manager, views, events } = fixture();
  await manager.open({ seats });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  views[0].webContents.capturePage = () => new Promise(() => {});
  manager.overlay("local-p1");
  t.mock.timers.tick(1500);
  await new Promise(setImmediate);
  const backdrop = events.findLast(
    (event) => event.kind === "overlay-backdrop",
  );
  assert.equal(backdrop.snapshots.length, 1);
  assert.equal(backdrop.snapshots[0].seatId, "local-p2");
  assert.equal(
    manager.overlayReady(backdrop.version, backdrop.captureId),
    true,
  );
  manager.close();
});

test("every bound player can navigate a shared overlay while text overlays retain exclusive input", async () => {
  const { manager, events } = fixture();
  await manager.open({ seats });
  manager.bindings.set("local-p1", "1");
  manager.bindings.set("local-p2", "2");
  manager.overlay("local-p2", true);
  const frames = [
    { id: "1", connected: true, actions: ["down"], glyphs: {} },
    { id: "2", connected: true, actions: [], glyphs: {} },
    { id: "3", connected: true, actions: ["menu"], glyphs: {} },
  ];
  assert.equal(manager.shellFrame(frames).id, "1");
  assert.deepEqual(events.at(-1), {
    kind: "shell-controller",
    seatId: "local-p1",
    controllerId: "1",
    generation: manager.seats.get("local-p1").generation,
  });
  frames[1].actions = ["confirm"];
  assert.equal(manager.shellFrame(frames).id, "2");
  frames[0].actions = ["confirm"];
  assert.equal(manager.shellFrame(frames).id, "1");
  frames[0].actions = ["speedUp", "build"];
  frames[1].actions = [];
  assert.deepEqual(manager.shellFrame(frames).actions, []);
  assert.equal(manager.shellFrame(frames).id, "1");
  frames[0].connected = false;
  frames[0].actions = ["menu"];
  assert.equal(manager.shellFrame(frames).id, "2");
  manager.overlay("local-p2");
  frames[0].connected = true;
  frames[0].actions = ["confirm"];
  assert.equal(manager.shellFrame(frames).id, "2");
  assert.deepEqual(manager.shellFrame(frames).actions, []);
  assert.equal(manager.overlayOwner, "local-p2");
  manager.close();
});

test("shared shell and late seat contexts remain Menu until the overlay closes", async () => {
  const { manager } = fixture();
  await manager.open({ seats });
  const contexts = new Map();
  manager.input = () => ({
    setDeviceContext: (id, context) => {
      contexts.set(id, context);
      return { connected: true, actions: [], glyphs: {} };
    },
    releaseDevice() {},
    setDeviceMode() {},
    deviceContexts: new Map(),
    setContext() {},
  });
  manager.bindings.set("local-p1", "1");
  manager.bindings.set("local-p2", "2");
  const p1 = manager.seats.get("local-p1"),
    p2 = manager.seats.get("local-p2");
  manager.setContext(p1, "Gameplay");
  manager.setContext(p2, "Gameplay");
  manager.overlay("local-p2", true);
  assert.equal(contexts.get("1"), "Menu");
  assert.equal(contexts.get("2"), "Menu");
  manager.setContext(p1, "Gameplay");
  manager.shellContext("Gameplay");
  assert.equal(contexts.get("1"), "Menu");
  assert.equal(contexts.get("2"), "Menu");
  manager.overlay(null);
  assert.equal(contexts.get("1"), "Gameplay");
  assert.equal(contexts.get("2"), "Gameplay");
  assert.throws(() => manager.overlay("local-p1", "shared"), /Invalid/);
  manager.close();
});

test("closing after native window destruction still disposes every seat and port", async () => {
  const { manager, views, ports, events } = fixture();
  await manager.open({ seats });
  let closed = 0;
  const closePort = () => closed++;
  for (const port of ports) port.close = closePort;
  manager.window.isDestroyed = () => true;
  Object.defineProperty(manager.window, "contentView", {
    get() {
      throw new Error("Destroyed window access");
    },
  });
  const before = events.length;
  manager.close();
  assert.equal(closed, 2);
  assert.ok(views.every((view) => view.closed));
  assert.equal(manager.seats.size, 0);
  assert.equal(events.length, before);
});

test("late renderer exits cannot revoke a replacement or publish after teardown", async () => {
  const { manager, views, events } = fixture();
  await manager.open({ seats });
  const oldView = views[0];
  manager.close();
  const closedEvents = events.length;
  oldView.webContents.emit("render-process-gone");
  assert.equal(events.length, closedEvents);
  await manager.open({ seats });
  const current = manager.seats.get("local-p1");
  const generation = current.generation;
  const before = events.length;
  oldView.webContents.emit("render-process-gone");
  assert.equal(events.length, before);
  assert.equal(manager.seats.get("local-p1"), current);
  assert.equal(current.generation, generation);
  current.view.webContents.emit("render-process-gone");
  assert.equal(events.at(-1).kind, "seat-lost");
  assert.equal(events.at(-1).generation, generation);
  assert.equal(events.at(-1).reason, "renderer-crash");
  assert.ok(current.generation > generation);
  manager.close();
});

test("intentional teardown retires seat routes before synchronous native exit callbacks", async () => {
  const { manager, views, events } = fixture();
  await manager.open({ seats });
  for (const view of views) {
    const close = view.webContents.close;
    view.webContents.close = () => {
      view.webContents.emit("render-process-gone");
      close();
    };
  }
  manager.close();
  assert.ok(views.every((view) => view.closed));
  assert.equal(events.filter((event) => event.kind === "seat-lost").length, 0);
});
