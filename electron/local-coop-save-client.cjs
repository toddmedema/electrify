const path = require("node:path");

const REQUEST_TIMEOUT_MS = 30_000;

/** One native profile keeps a single save queue even when the TV shell reloads. */
class LocalCoopSaveClient {
  constructor(fork, directory, ownerId) {
    this.fork = fork;
    this.directory = directory;
    this.ownerId = ownerId;
    this.requests = new Map();
    this.sequence = 0;
  }

  getProcess() {
    if (this.retiring)
      throw new Error("The local couch save process is stopping");
    if (this.process) return this.process;
    const child = this.fork(
      path.join(__dirname, "local-coop-save-process.cjs"),
      [this.directory, this.ownerId],
      { serviceName: "Electrify couch saves" },
    );
    this.process = child;
    child.once("spawn", () => {
      // A prior timeout could not kill this child before Electron assigned its PID.
      if (this.process === child && this.retiring) child.kill();
    });
    child.on("message", ({ id, result, error }) => {
      if (this.process !== child) return;
      const request = this.requests.get(id);
      if (!request) return;
      this.requests.delete(id);
      clearTimeout(request.timer);
      if (error) request.reject(new Error(error));
      else request.resolve(result);
    });
    // Electron also emits V8 fatal reports as "error". Exit owns queue cleanup.
    child.on("error", () => {});
    child.once("exit", () => {
      this.process = undefined;
      this.retiring = false;
      this.rejectPending("The local couch save process stopped");
    });
    return child;
  }

  rejectPending(message) {
    // An in-flight write may already be durable. Never replay it implicitly.
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.requests.clear();
  }

  async request(kind, argument) {
    const child = this.getProcess();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Wait for exit before opening another queue for this profile.
        this.retiring = true;
        this.rejectPending("The local couch save process timed out");
        child.kill();
      }, REQUEST_TIMEOUT_MS);
      timer.unref();
      this.requests.set(id, { resolve, reject, timer });
      try {
        child.postMessage({ id, kind, argument });
      } catch (error) {
        clearTimeout(timer);
        this.requests.delete(id);
        reject(error);
      }
    });
  }
}

module.exports = { LocalCoopSaveClient };
