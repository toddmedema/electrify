const { contextBridge, ipcRenderer } = require("electron");
const seatId = process.argv
  .find((arg) => arg.startsWith("--electrify-couch-seat="))
  ?.split("=")[1];
let generation = Number(
  process.argv
    .find((arg) => arg.startsWith("--electrify-couch-generation="))
    ?.split("=")[1],
);
let port;
let resolveReady;
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});
const callbacks = new Set();
const queued = [];
ipcRenderer.on("couch:port", (event, identity) => {
  port?.close();
  generation = identity.generation;
  port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (!callbacks.size) {
      // Liveness pulses must never evict the unacknowledged initial baseline.
      if (data?.kind === "pulse") return;
      const previous = queued.findIndex(
        (message) => message?.kind === data?.kind,
      );
      if (previous >= 0) queued.splice(previous, 1);
      if (queued.length >= 8) queued.shift();
      queued.push(data);
    } else for (const callback of callbacks) callback(data);
  };
  port.start();
  resolveReady();
});
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld(
  "electrifyCouch",
  Object.freeze({
    role: "seat",
    ready: () => ready,
    seatId,
    getGeneration: () => generation,
    onMessage(callback) {
      callbacks.add(callback);
      for (const message of queued.splice(0)) callback(message);
      return () => callbacks.delete(callback);
    },
    post: (message) => port?.postMessage(message),
  }),
);
contextBridge.exposeInMainWorld(
  "electrifyDesktop",
  Object.freeze({
    apiVersion: 1,
    getState: () => ipcRenderer.invoke("couch:state"),
    setInputContext: (context) =>
      ipcRenderer.invoke("couch:input-context", context),
    onInput: (callback) => subscribe("desktop:input-event", callback),
    onGameFocusChanged: (callback) =>
      subscribe("desktop:focus-changed", callback),
    onBeforeQuit: () => () => {},
    showTextInput: (input) => ipcRenderer.invoke("couch:text-input", input),
    onPowerStateChanged: (callback) =>
      subscribe("desktop:power-changed", callback),
  }),
);
