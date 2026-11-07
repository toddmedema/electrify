const { isAppUrl } = require("./runtime.cjs");
const { validateInputContext } = require("./steam-input.cjs");

const SEAT_IDS = ["local-p1", "local-p2", "local-p3", "local-p4"];

/** Coordinates are DIPs; CSS dimensions are computed only after zoom. */
function couchLayout(width, height, count, options = {}) {
  const zoom = options.zoom ?? Math.max(1.5, height / 720);
  const inset = options.inset ?? 16;
  const gutter = options.gutter ?? 8;
  const bandHeight = options.bandHeight ?? 96;
  if (
    !Number.isInteger(count) ||
    count < 2 ||
    count > 4 ||
    ![width, height, zoom, inset, gutter, bandHeight].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    zoom < 1 ||
    zoom > 4 ||
    inset < 0 ||
    inset > 200 ||
    gutter < 0 ||
    gutter > 100 ||
    bandHeight < 48 ||
    bandHeight > 600
  )
    throw new Error("Invalid couch layout");
  const seatWidth = Math.floor(
    (width - inset * 2 - gutter * (count - 1)) / count,
  );
  const seatHeight = Math.floor(height - bandHeight - inset);
  const fits = seatWidth / zoom >= 360 && seatHeight / zoom >= 360;
  return {
    fits,
    zoom,
    inset,
    gutter,
    bandHeight,
    cssWidth: seatWidth / zoom,
    cssHeight: seatHeight / zoom,
    bounds: Array.from({ length: count }, (_, i) => ({
      x: Math.round(inset + i * (seatWidth + gutter)),
      y: Math.round(bandHeight),
      width: Math.max(0, seatWidth),
      height: Math.max(0, seatHeight),
    })),
  };
}

function validSeats(seats) {
  if (
    !Array.isArray(seats) ||
    seats.length < 2 ||
    seats.length > 4 ||
    seats.some(
      (seat, i) =>
        seat?.id !== SEAT_IDS[i] ||
        typeof seat.name !== "string" ||
        !seat.name.trim() ||
        seat.name.length > 80,
    )
  )
    throw new Error("Invalid local company roster");
  return seats.map(({ id, name }) => ({ id, name }));
}

function seatMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return false;
  const keys = Object.keys(message);
  if (message.kind === "heartbeat" || message.kind === "ack")
    return keys.every((key) =>
      ["kind", "revision", "sequence", "delivery"].includes(key),
    );
  if (message.kind === "global-settings")
    return (
      keys.every((key) => ["kind", "requestId"].includes(key)) &&
      typeof message.requestId === "string" &&
      message.requestId.length > 0 &&
      message.requestId.length <= 100
    );
  if (message.kind === "leave")
    return (
      keys.every((key) => ["kind", "requestId", "skipSave"].includes(key)) &&
      typeof message.requestId === "string" &&
      message.requestId.length <= 100
    );
  if (message.kind !== "command") return false;
  // Main authenticates the route. Domain payload validation belongs to Commands/World.
  return (
    keys.every((key) =>
      ["kind", "command", "sequence", "matchId", "epoch"].includes(key),
    ) &&
    Number.isSafeInteger(message.sequence) &&
    message.sequence > 0 &&
    typeof message.matchId === "string" &&
    message.matchId.length <= 100 &&
    typeof message.epoch === "string" &&
    message.epoch.length > 0 &&
    message.epoch.length <= 100 &&
    !!message.command &&
    typeof message.command === "object"
  );
}

/** Native role bindings never derive company authority from renderer-provided labels. */
class CouchViews {
  constructor({
    window,
    WebContentsView,
    MessageChannelMain,
    prepareSession,
    preload,
    url,
    publish,
    input,
  }) {
    Object.assign(this, {
      window,
      WebContentsView,
      MessageChannelMain,
      prepareSession,
      preload,
      url,
      publish,
      input,
    });
    this.seats = new Map();
    this.bindings = new Map();
    this.generation = 0;
    this.lifecycle = 0;
    this.setup = false;
    this.devices = [];
  }
  active() {
    return this.setup || this.seats.size > 0;
  }
  status() {
    return {
      available: !!this.input()?.initialized,
      devices: this.devices,
      active: this.active(),
      haptics: {
        supported: false,
        reason:
          "Assigned-controller vibration is unavailable with this Steam Input adapter.",
      },
      layout: this.layout,
    };
  }
  identify(event) {
    return [...this.seats.values()].find(
      ({ view }) =>
        !view.webContents.isDestroyed() &&
        event.sender === view.webContents &&
        event.senderFrame === view.webContents.mainFrame &&
        isAppUrl(event.senderFrame.url),
    );
  }
  setContext(seat, context) {
    validateInputContext(context);
    seat.context = context;
    const controller = this.bindings.get(seat.id);
    return (
      this.input()?.setDeviceContext(
        controller,
        this.overlayOwner === seat.id ? "Menu" : context,
      ) ?? {
        connected: false,
        actions: [],
        glyphs: {},
      }
    );
  }
  inputFrame(devices) {
    this.devices = devices.map((frame) => ({ ...frame, actions: [] }));
    if (!this.active()) return;
    this.publish({ kind: "devices", devices });
    for (const seat of this.seats.values()) {
      if (this.overlayOwner) continue;
      const controller = this.bindings.get(seat.id);
      const frame = devices.find((device) => device.id === controller);
      if (frame) seat.view.webContents.send("desktop:input-event", frame);
    }
  }
  shellOwner() {
    if (this.overlayOwner) return this.overlayOwner;
    const connected = (seatId) =>
      this.devices.some(
        (device) => device.connected && device.id === this.bindings.get(seatId),
      );
    return connected("local-p1")
      ? "local-p1"
      : ([...this.bindings.keys()].find(connected) ?? "local-p1");
  }
  shellFrame(devices) {
    if (!this.setup && !this.overlayOwner) return;
    const owner = this.bindings.get(this.shellOwner());
    const frame = devices.find((device) => device.id === owner);
    if (!frame) return;
    return this.setup && this.confirmOnly
      ? {
          ...frame,
          actions: frame.actions.filter((action) => action !== "confirm"),
        }
      : frame;
  }
  bind(seatId, controllerId) {
    if (
      !SEAT_IDS.includes(seatId) ||
      typeof controllerId !== "string" ||
      !this.devices.some(
        (device) => device.id === controllerId && device.connected,
      )
    )
      throw new Error("Choose a connected controller");
    if (
      [...this.bindings].some(
        ([id, device]) => id !== seatId && device === controllerId,
      )
    )
      throw new Error("That controller already owns another company");
    this.input()?.releaseDevice(this.bindings.get(seatId));
    this.input()?.releaseDevice(controllerId);
    this.bindings.set(seatId, controllerId);
    const seat = this.seats.get(seatId);
    if (seat) {
      this.lost(seat, "controller-reassigned");
      seat.view.webContents.reload();
    }
    return { seatId, controllerId };
  }
  async open(input) {
    const seats = validSeats(input.seats);
    if (seats.length > 2)
      throw new Error(
        "Three and four players require hardware acceptance before release",
      );
    if (this.seats.size || this.opening)
      throw new Error("A local session is already open");
    const [width, height] = this.window.getContentSize();
    this.options = {
      zoom: input.zoom,
      inset: input.inset,
      gutter: input.gutter,
      bandHeight: input.bandHeight,
    };
    this.layout = couchLayout(width, height, seats.length, this.options);
    if (!this.layout.fits)
      throw new Error(
        "This display cannot fit two readable companies. Increase the display area or restore TV scale.",
      );
    const lifecycle = ++this.lifecycle;
    this.opening = true;
    this.count = seats.length;
    this.input()?.setDeviceMode(true);
    try {
      for (const [index, company] of seats.entries()) {
        const generation = ++this.generation;
        const partition = `electrify-couch-${generation}-${Date.now()}`;
        const isolatedSession = await this.prepareSession(partition);
        if (lifecycle !== this.lifecycle)
          throw new Error("The local session closed while starting");
        const [currentWidth, currentHeight] = this.window.getContentSize();
        this.layout = couchLayout(
          currentWidth,
          currentHeight,
          seats.length,
          this.options,
        );
        if (!this.layout.fits)
          throw new Error("The display no longer fits readable companies");
        const view = new this.WebContentsView({
          webPreferences: {
            preload: this.preload,
            session: isolatedSession,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            webviewTag: false,
            backgroundThrottling: false,
            additionalArguments: [
              `--electrify-couch-seat=${company.id}`,
              `--electrify-couch-generation=${generation}`,
            ],
          },
        });
        const seat = { ...company, generation, view };
        this.seats.set(company.id, seat);
        const wc = view.webContents;
        wc.setWindowOpenHandler(() => ({ action: "deny" }));
        wc.on("will-navigate", (event, url) => {
          if (url !== this.url) event.preventDefault();
        });
        wc.on("will-frame-navigate", (event) => {
          if (!isAppUrl(event.url)) event.preventDefault();
        });
        wc.on("will-attach-webview", (event) => event.preventDefault());
        wc.on("render-process-gone", () => this.lost(seat, "renderer-crash"));
        wc.on("did-start-loading", () => {
          if (seat.port) this.lost(seat, "renderer-reload");
        });
        wc.on("did-finish-load", () => {
          if (this.seats.get(seat.id) !== seat) return;
          wc.setZoomMode("isolated");
          wc.setZoomFactor(this.layout.zoom);
          const portGeneration = seat.generation;
          const { port1, port2 } = new this.MessageChannelMain();
          seat.port?.close();
          seat.port = port1;
          port1.on("message", ({ data }) => {
            if (
              this.seats.get(seat.id) !== seat ||
              seat.generation !== portGeneration ||
              !seat.port ||
              !seatMessage(data)
            )
              return;
            this.publish({
              kind: "seat-message",
              seatId: seat.id,
              generation: seat.generation,
              message: data,
            });
          });
          port1.on("close", () => {
            if (
              this.seats.get(seat.id) === seat &&
              seat.port === port1 &&
              seat.generation === portGeneration
            )
              this.lost(seat, "port-closed");
          });
          port1.start();
          wc.postMessage(
            "couch:port",
            { seatId: seat.id, generation: seat.generation },
            [port2],
          );
          this.publish({
            kind: "seat-attached",
            seatId: seat.id,
            generation: seat.generation,
          });
        });
        this.window.contentView.addChildView(view);
        view.setBounds(this.layout.bounds[index]);
        view.setVisible(!this.overlayOwner && this.layout.fits);
        await wc.loadURL(this.url);
        if (lifecycle !== this.lifecycle)
          throw new Error("The local session closed while starting");
      }
      this.opening = false;
      this.setup = false;
      this.confirmOnly = false;
      return this.status();
    } catch (error) {
      if (lifecycle === this.lifecycle) this.close();
      throw error;
    }
  }
  lost(seat, reason) {
    seat.port?.close();
    seat.port = undefined;
    // The old generation can never send another accepted command after reload/crash.
    const oldGeneration = seat.generation;
    seat.generation = ++this.generation;
    this.publish({
      kind: "seat-lost",
      seatId: seat.id,
      generation: oldGeneration,
      reason,
    });
  }
  send({ seatId, generation, message }) {
    const seat = this.seats.get(seatId);
    if (!seat?.port || seat.generation !== generation) return false;
    seat.port.postMessage(message);
    return true;
  }
  relayout(options = {}) {
    if (!this.seats.size) return this.status();
    this.options = {
      ...this.options,
      ...Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
      ),
    };
    const [width, height] = this.window.getContentSize();
    this.layout = couchLayout(
      width,
      height,
      this.count ?? this.seats.size,
      this.options,
    );
    [...this.seats.values()].forEach((seat, i) => {
      seat.view.setVisible(this.layout.fits && !this.overlayOwner);
      if (this.layout.fits) {
        seat.view.setBounds(this.layout.bounds[i]);
        seat.view.webContents.setZoomFactor(this.layout.zoom);
      }
    });
    this.publish({ kind: "layout", layout: this.layout });
    return this.status();
  }
  overlay(seatId) {
    if (seatId !== null && !SEAT_IDS.includes(seatId))
      throw new Error("Invalid global dialog owner");
    this.overlayOwner = seatId;
    this.overlayVersion = (this.overlayVersion ?? 0) + 1;
    for (const device of this.devices) this.input()?.releaseDevice(device.id);
    for (const seat of this.seats.values()) {
      seat.view.setVisible(!seatId && this.layout.fits);
      const controller = this.bindings.get(seat.id);
      if (controller)
        this.input()?.setDeviceContext(
          controller,
          seatId === seat.id ? "Menu" : (seat.context ?? "Menu"),
        );
    }
    return this.status();
  }
  reload(seatId) {
    const seat = this.seats.get(seatId);
    if (!seat) throw new Error("Unknown local company");
    seat.view.webContents.reload();
  }
  foreground(value) {
    for (const { view } of this.seats.values())
      view.webContents.send("desktop:focus-changed", value);
  }
  close() {
    this.lifecycle++;
    this.opening = false;
    this.count = undefined;
    for (const seat of this.seats.values()) {
      seat.port?.close();
      this.window.contentView.removeChildView(seat.view);
      if (!seat.view.webContents.isDestroyed()) seat.view.webContents.close();
    }
    this.seats.clear();
    this.bindings.clear();
    this.setup = false;
    this.confirmOnly = false;
    this.overlayOwner = undefined;
    this.input()?.setDeviceMode(false);
    this.input()?.deviceContexts.clear();
    this.input()?.setContext("Menu");
  }
}
module.exports = { SEAT_IDS, couchLayout, validSeats, seatMessage, CouchViews };
