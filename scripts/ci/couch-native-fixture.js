const { EventEmitter } = require("node:events");
const { CouchViews } = require("../../electron/couch.cjs");

// Shared windowless view/port transport; binding, status and generation logic stay native.
function createCouchNativeFixture(configuration = {}) {
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
    input: configuration.input || (() => undefined),
    publish: (event) => {
      events.push(event);
      configuration.publish?.(event);
    },
    preload: "/preload",
    url: "electrify://app/index.html",
  });
  return { manager, views, events, partitions, ports, size };
}

module.exports = { createCouchNativeFixture };
