// Valve's steam_api.h manual loop is the sole callback consumer. Never combine it with
// steamworks.js index.init's Rust pump, SteamAPI_RunCallbacks, or CCallback registration.
// CallbackMsg_t has int32 user/id, pointer at8, int32 bytes at16 (24 Windows /20 POSIX).
// SteamAPICallCompleted_t callback703 has uint64 handle, int32 callback, uint32 bytes.
const OVERLAY_CALLBACK_ID = 331;
const CALL_COMPLETED_ID = 703;

class SteamDispatcher {
  constructor(
    api,
    onOverlay,
    onError = () => {},
    platform = process.platform,
    koffi = require("koffi"),
  ) {
    this.api = api;
    this.onOverlay = onOverlay;
    this.onError = onError;
    this.koffi = koffi;
    this.messageBytes = platform === "win32" ? 24 : 20;
    this.pipe = api.pipe();
    if (!this.pipe) throw new Error("Steam callback pipe is unavailable");
    this.pending = new Map();
    this.listeners = new Map();
    this.requestTimeoutMs = 15000;
  }

  start() {
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.pump();
      } catch (error) {
        this.dispose(error);
        this.onError(error);
      }
    }, 1000 / 30);
    this.timer.unref();
  }

  onCallback(id, listener) {
    const listeners = this.listeners.get(id) || new Set();
    this.listeners.set(id, listeners);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  callResult(handle, layout) {
    if (this.stopped)
      return Promise.reject(new Error("Steam is shutting down"));
    if (!handle || BigInt(handle) === 0n)
      return Promise.reject(new Error("Steam request could not start"));
    const key = BigInt(handle).toString();
    if (this.pending.has(key))
      return Promise.reject(new Error("Duplicate Steam request"));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error("Steam request timed out"));
      }, this.requestTimeoutMs);
      this.pending.set(key, { layout, resolve, reject, timeout });
    });
  }

  payload(message) {
    const bytes = message.readInt32LE(16);
    const pointer = message.readBigUInt64LE(8);
    if (bytes < 0 || bytes > 1024 * 1024 || (bytes && !pointer))
      throw new Error("Invalid Steam callback payload");
    return bytes
      ? Buffer.from(this.koffi.decode(pointer, "uint8_t", bytes))
      : Buffer.alloc(0);
  }

  complete(payload) {
    if (payload.length !== 16)
      throw new Error("Invalid Steam completion payload");
    const handle = payload.readBigUInt64LE(0);
    const key = handle.toString();
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    clearTimeout(pending.timeout);
    const callback = payload.readInt32LE(8);
    const bytes = payload.readUInt32LE(12);
    if (callback !== pending.layout.callback || bytes !== pending.layout.size) {
      pending.reject(new Error("Invalid Steam request result"));
      return;
    }
    const result = Buffer.alloc(bytes);
    const failed = Buffer.alloc(1);
    try {
      if (
        !this.api.callResult(
          this.pipe,
          handle,
          result,
          bytes,
          callback,
          failed,
        ) ||
        failed[0]
      )
        pending.reject(new Error("Steam request failed"));
      else pending.resolve(result);
    } catch (error) {
      pending.reject(error);
    }
  }

  pump() {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      this.api.runFrame(this.pipe);
      const message = Buffer.alloc(this.messageBytes);
      // Bound work per frame without dropping events; remaining callbacks wait for next frame.
      for (
        let count = 0;
        count < 1000 &&
        !this.stopped &&
        this.api.nextCallback(this.pipe, message);
        count++
      ) {
        let overlay;
        let notification;
        try {
          const id = message.readInt32LE(4);
          if (id === OVERLAY_CALLBACK_ID) {
            const payload = this.payload(message);
            if (payload.length !== 12)
              throw new Error("Invalid Steam overlay payload");
            overlay = payload[0] !== 0;
          } else if (id === CALL_COMPLETED_ID)
            this.complete(this.payload(message));
          else if (this.listeners.has(id))
            notification = { id, payload: this.payload(message) };
        } finally {
          // Copy all payloads before freeing the SDK memory, including failure paths.
          this.api.freeCallback(this.pipe);
        }
        if (overlay !== undefined) this.onOverlay(overlay);
        if (notification)
          for (const listener of this.listeners.get(notification.id) || []) {
            try {
              listener(notification.payload);
            } catch (error) {
              this.onError(error);
            }
          }
      }
    } finally {
      this.pumping = false;
    }
  }

  dispose(error = new Error("Steam is shutting down")) {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.listeners.clear();
  }
}

module.exports = { SteamDispatcher, OVERLAY_CALLBACK_ID, CALL_COMPLETED_ID };
