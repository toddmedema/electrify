const { isAppUrl } = require("./runtime.cjs");
const { validateInputContext, ACTION_SETS } = require("./steam-input.cjs");
const MENU_ACTIONS = new Set(ACTION_SETS.Menu);
const DIRECTIONS = new Set(["up", "down", "left", "right"]);

/** One shared focus accepts assigned players; fresh button intent wins over a held direction. */
function sharedMenuFrame(seatIds, bindings, devices, preferredSeatId) {
  const candidates = Array.from(seatIds, (seatId) => {
    const frame = devices.find(
      (device) => device.id === bindings.get(seatId) && device.connected,
    );
    return (
      frame && {
        seatId,
        frame: {
          ...frame,
          actions: frame.actions.filter((action) => MENU_ACTIONS.has(action)),
        },
      }
    );
  }).filter(Boolean);
  return (
    candidates.find(({ frame }) =>
      frame.actions.some((action) => !DIRECTIONS.has(action)),
    ) ??
    candidates.find(({ frame }) => frame.actions.length) ??
    candidates.find(({ seatId }) => seatId === preferredSeatId) ??
    candidates[0]
  );
}

const SEAT_IDS = ["local-p1", "local-p2", "local-p3", "local-p4"];
const BACKDROP_MAX_EDGE = 2048;
const BACKDROP_MAX_BYTES = 4 * 1024 * 1024;
const BACKDROP_TIMEOUT_MS = 1500;

/**
 * Capture a bounded PNG without exposing a hidden company. Stale, empty, oversized
 * or timed-out results are omitted so capture failure cannot trap the shared UI.
 */
async function captureSeat(seat, bounds, current) {
  let timer;
  try {
    const image = await Promise.race([
      seat.view.webContents.capturePage(undefined, { stayHidden: true }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Local screen capture timed out")),
          BACKDROP_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
    if (!current() || image.isEmpty()) return;
    const size = image.getSize();
    if (
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      size.width <= 0 ||
      size.height <= 0
    )
      return;
    const scale = Math.min(
      1,
      BACKDROP_MAX_EDGE / size.width,
      BACKDROP_MAX_EDGE / size.height,
    );
    const bounded =
      scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: "good",
          })
        : image;
    const png = bounded.toPNG();
    if (!png.length || png.length > BACKDROP_MAX_BYTES) return;
    return { bounds, image: `data:image/png;base64,${png.toString("base64")}` };
  } catch {
    // A crashed or unpainted company must not trap the shared recovery/menu UI.
    return;
  } finally {
    clearTimeout(timer);
  }
}

/** Coordinates are DIPs; CSS dimensions are computed only after zoom. */
function couchLayout(width, height, count, options = {}) {
  const zoom = options.zoom ?? Math.max(1.5, height / 720);
  const inset = options.inset ?? 0;
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
  const availableWidth = width - inset * 2 - gutter * (count - 1);
  const seatWidth = Math.floor(availableWidth / count);
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
    bounds: Array.from({ length: count }, (_, i) => {
      // Partition the remainder too, so an odd window width leaves no strip at
      // the right edge and the center separator keeps its requested width.
      const left = Math.round(
        inset + (i * availableWidth) / count + i * gutter,
      );
      const right = Math.round(
        inset + ((i + 1) * availableWidth) / count + i * gutter,
      );
      return {
        x: left,
        y: Math.round(bandHeight),
        width: Math.max(0, right - left),
        height: Math.max(0, seatHeight),
      };
    }),
  };
}

/**
 * Copy a bounded, ordered logical roster while rejecting hardware identities and empty names.
 * Caller-supplied extra fields never become native routing or ownership authority.
 */
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

/**
 * Admit only seat-to-shell message shapes. Native route identity is supplied
 * separately; payloads cannot choose a sender or invoke worker lifecycle controls.
 */
function seatMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return false;
  const keys = Object.keys(message);
  if (message.kind === "heartbeat" || message.kind === "ack")
    return keys.every((key) =>
      ["kind", "revision", "sequence", "delivery"].includes(key),
    );
  if (message.kind === "global-settings" || message.kind === "global-menu")
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
      overlay: this.overlayOwner
        ? {
            owner: this.overlayOwner,
            shared: !!this.overlayShared,
            version: this.overlayVersion,
            captureId: this.overlayCapture?.captureId,
          }
        : null,
    };
  }
  /** Match the exact live top frame; a matching URL alone never grants seat authority. */
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
        this.overlayShared || this.overlayOwner === seat.id ? "Menu" : context,
      ) ?? {
        connected: false,
        actions: [],
        glyphs: {},
      }
    );
  }
  /** Publish device presence while suppressing all seat input during global UI ownership. */
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
    if (this.overlayOwner)
      return this.overlayShared
        ? (this.sharedInputSeat ?? this.overlayOwner)
        : this.overlayOwner;
    const connected = (seatId) =>
      this.devices.some(
        (device) => device.connected && device.id === this.bindings.get(seatId),
      );
    return connected("local-p1")
      ? "local-p1"
      : ([...this.bindings.keys()].find(connected) ?? "local-p1");
  }
  /** Keep every shared-menu controller in Menu without replacing each seat's stored gameplay context. */
  shellContext(context) {
    validateInputContext(context);
    if (this.overlayShared)
      for (const seatId of this.seats.keys())
        this.input()?.setDeviceContext(this.bindings.get(seatId), "Menu");
    return (
      this.input()?.setDeviceContext(
        this.bindings.get(this.shellOwner()),
        this.overlayOwner ? "Menu" : context,
      ) ?? { connected: false, actions: [], glyphs: {} }
    );
  }
  selectSharedController(seatId, controllerId) {
    if (
      this.sharedInputSeat === seatId &&
      this.sharedControllerId === controllerId
    )
      return;
    this.sharedInputSeat = seatId;
    this.sharedControllerId = controllerId;
    if (controllerId)
      this.publish({
        kind: "shell-controller",
        seatId,
        controllerId,
        generation: this.seats.get(seatId).generation,
      });
  }
  /**
   * Select one frame for shared focus, retaining exclusive routing for text entry.
   * Setup confirmation stays seat-owned so readiness cannot also activate a shell control.
   */
  shellFrame(devices) {
    if (!this.setup && !this.overlayOwner) return;
    if (this.overlayShared) {
      const selected = sharedMenuFrame(
        this.seats.keys(),
        this.bindings,
        devices,
        this.sharedInputSeat ?? this.overlayOwner,
      );
      if (!selected) return;
      this.selectSharedController(selected.seatId, selected.frame.id);
      return selected.frame;
    }
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
  /** A replacement explicitly revokes the previous renderer generation; hardware never swaps companies. */
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
  /**
   * Create isolated company documents and authenticated ports. The lifecycle token
   * prevents delayed session preparation from attaching views after close or reopen.
   */
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
        // Capturing keeps the paused surfaces visible briefly. Gate native input
        // before that asynchronous work, including explicitly focused seat pages.
        for (const name of ["before-input-event", "before-mouse-event"])
          wc.on(name, (event) => {
            if (this.overlayOwner) event.preventDefault();
          });
        wc.on("focus", () => {
          if (this.overlayOwner) this.window.webContents.focus();
        });
        wc.on("render-process-gone", () => {
          if (this.seats.get(seat.id) !== seat) return;
          this.lost(seat, "renderer-crash");
        });
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
          if (this.overlayOwner) this.refreshOverlay();
        });
        this.window.contentView.addChildView(view);
        view.setBounds(this.layout.bounds[index]);
        view.setVisible(!this.overlayHidden && this.layout.fits);
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
  /**
   * Revoke only the current seat generation. Removed views can still emit native
   * exit callbacks after teardown or replacement and must not affect a new route.
   */
  lost(seat, reason) {
    if (this.seats.get(seat.id) !== seat) return;
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
    if (this.overlayOwner) this.refreshOverlay();
  }
  send({ seatId, generation, message }) {
    const seat = this.seats.get(seatId);
    if (!seat?.port || seat.generation !== generation) return false;
    seat.port.postMessage(message);
    return true;
  }
  /**
   * Validate candidate DIP bounds before committing options or touching native views.
   * Rejected requests preserve recovery through later partial updates; unreadable
   * valid layouts expose shell recovery and invalidate any pending backdrop.
   */
  relayout(options = {}) {
    if (!this.seats.size) return this.status();
    const nextOptions = {
      ...this.options,
      ...Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
      ),
    };
    const [width, height] = this.window.getContentSize();
    const nextLayout = couchLayout(
      width,
      height,
      this.count ?? this.seats.size,
      nextOptions,
    );
    this.options = nextOptions;
    this.layout = nextLayout;
    [...this.seats.values()].forEach((seat, i) => {
      seat.view.setVisible(this.layout.fits && !this.overlayHidden);
      if (this.layout.fits) {
        seat.view.setBounds(this.layout.bounds[i]);
        seat.view.webContents.setZoomFactor(this.layout.zoom);
      }
    });
    this.publish({ kind: "layout", layout: this.layout });
    if (this.overlayOwner) this.refreshOverlay();
    return this.status();
  }
  /**
   * Transfer native input ownership and disarm held controls; the shell separately
   * pauses the worker. Text entry remains exclusive unless sharing is explicitly granted.
   */
  overlay(seatId, shared = false) {
    if (typeof shared !== "boolean")
      throw new Error("Invalid shared dialog mode");
    const previousOwner = this.overlayOwner;
    const wasShared = this.overlayShared;
    if (seatId !== null && !this.seats.has(seatId))
      throw new Error("Invalid global dialog owner");
    this.overlayOwner = seatId;
    this.overlayShared = !!seatId && shared;
    if (this.overlayShared) {
      if (!wasShared || previousOwner !== seatId)
        this.selectSharedController(seatId, this.bindings.get(seatId));
    } else {
      this.sharedInputSeat = undefined;
      this.sharedControllerId = undefined;
    }
    this.overlayVersion = (this.overlayVersion ?? 0) + 1;
    for (const device of this.devices) this.input()?.releaseDevice(device.id);
    if (!seatId) this.overlayHidden = false;
    for (const seat of this.seats.values()) {
      seat.view.setVisible(!this.overlayHidden && this.layout.fits);
      const controller = this.bindings.get(seat.id);
      if (controller)
        this.input()?.setDeviceContext(
          controller,
          this.overlayShared || seatId === seat.id
            ? "Menu"
            : (seat.context ?? "Menu"),
        );
    }
    if (seatId) {
      this.window.webContents.focus();
      this.refreshOverlay();
    } else this.clearOverlay();
    return this.status();
  }
  /** Invalidate pending captures; suppress notification when teardown has already destroyed the shell. */
  clearOverlay(publish = true) {
    this.overlayCapture = undefined;
    this.captureId = (this.captureId ?? 0) + 1;
    if (publish)
      this.publish({
        kind: "overlay-backdrop",
        owner: null,
        version: this.overlayVersion ?? 0,
        captureId: this.captureId,
        snapshots: [],
      });
  }
  /** A capture is valid only for the same overlay, lifecycle, layout and complete seat generations. */
  currentCapture(capture) {
    return (
      this.overlayCapture === capture &&
      this.overlayOwner === capture.owner &&
      this.overlayVersion === capture.version &&
      this.lifecycle === capture.lifecycle &&
      this.layout === capture.layout &&
      this.seats.size === capture.seats.length &&
      capture.seats.every(
        ({ seat, generation }) =>
          this.seats.get(seat.id) === seat && seat.generation === generation,
      )
    );
  }
  /**
   * Return status immediately and publish captures asynchronously. Refreshes leave
   * committed native views hidden; the renderer must acknowledge the new capture before hiding others.
   */
  refreshOverlay() {
    if (!this.overlayOwner) return this.status();
    const [width, height] = this.window.getContentSize();
    const capture = {
      owner: this.overlayOwner,
      version: this.overlayVersion,
      captureId: (this.captureId = (this.captureId ?? 0) + 1),
      lifecycle: this.lifecycle,
      layout: this.layout,
      viewport: { width, height },
      seats: [...this.seats.values()].map((seat, i) => ({
        seat,
        generation: seat.generation,
        bounds: this.layout.bounds[i],
      })),
      published: false,
    };
    this.overlayCapture = capture;
    // Start while the first overlay's company views are still visible. Refreshes
    // use Electron's stayHidden option and never expose those native views again.
    void Promise.all(
      capture.seats.map(async ({ seat, generation, bounds }) => {
        const snapshot =
          capture.layout.fits &&
          (await captureSeat(seat, bounds, () => this.currentCapture(capture)));
        return snapshot
          ? { seatId: seat.id, generation, ...snapshot }
          : undefined;
      }),
    ).then((snapshots) => {
      if (!this.currentCapture(capture)) return;
      capture.published = true;
      this.publish({
        kind: "overlay-backdrop",
        owner: capture.owner,
        version: capture.version,
        captureId: capture.captureId,
        layout: capture.layout,
        viewport: capture.viewport,
        snapshots: snapshots.filter(Boolean),
      });
    });
    return this.status();
  }
  /** Hide native views only after the shell acknowledges painting this exact, still-current capture. */
  overlayReady(version, captureId) {
    const capture = this.overlayCapture;
    if (
      !capture?.published ||
      version !== capture.version ||
      captureId !== capture.captureId ||
      !this.currentCapture(capture)
    )
      return false;
    this.overlayHidden = true;
    for (const { view } of this.seats.values()) view.setVisible(false);
    return true;
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
  /**
   * Revoke asynchronous work and dispose ports and company web contents even after
   * native window destruction, when accessing contentView or publishing would throw.
   */
  close() {
    this.lifecycle++;
    this.opening = false;
    this.count = undefined;
    const windowAlive = !this.window.isDestroyed?.();
    const closingSeats = [...this.seats.values()];
    // Closing native resources can synchronously emit exit and port callbacks.
    this.seats.clear();
    for (const seat of closingSeats) {
      seat.port?.close();
      if (windowAlive) this.window.contentView.removeChildView(seat.view);
      if (!seat.view.webContents.isDestroyed()) seat.view.webContents.close();
    }
    this.bindings.clear();
    this.setup = false;
    this.confirmOnly = false;
    this.overlayOwner = undefined;
    this.overlayShared = false;
    this.sharedInputSeat = undefined;
    this.sharedControllerId = undefined;
    this.overlayHidden = false;
    this.clearOverlay(windowAlive);
    this.input()?.setDeviceMode(false);
    this.input()?.deviceContexts.clear();
    this.input()?.setContext("Menu");
  }
}
module.exports = {
  SEAT_IDS,
  couchLayout,
  validSeats,
  seatMessage,
  sharedMenuFrame,
  CouchViews,
};
