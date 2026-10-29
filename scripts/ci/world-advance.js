const { spawn } = require("node:child_process");
const path = require("node:path");

// One CRA/Jest runtime per Playwright worker. Each request still restores its own save,
// reloads simulation data, and executes every assertion in WorldAdvanceCli.
class WorldAdvanceWorker {
  constructor({
    root = path.resolve(__dirname, "../.."),
    command = process.execPath,
    args = [
      // The bin launcher spawns another Node process without forwarding IPC.
      require.resolve("react-scripts/scripts/test"),
      "--watchAll=false",
      "--runInBand",
      "--testMatch=**/src/testing/WorldAdvanceCli.tsx",
      "--cacheDirectory=.tmp/jest-world-advance",
    ],
    timeoutMs = 150000,
  } = {}) {
    Object.assign(this, { root, command, args, timeoutMs });
    this.sequence = 0;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  start() {
    if (this.ready) return this.ready;
    this.output = "";
    const child = spawn(this.command, this.args, {
      cwd: this.root,
      env: { ...process.env, CI: "true", E2E_WORLD_SERVICE: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    });
    this.child = child;
    this.exited = new Promise((resolve) => child.once("exit", resolve));
    const capture = (data) => {
      this.output = (this.output + data).slice(-65536);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    this.ready = new Promise((resolve, reject) => {
      const fail = (error) => {
        clearTimeout(startup);
        const diagnostic = new Error(`${error.message}\n${this.output}`);
        reject(diagnostic);
        this.pending?.reject(diagnostic);
        this.pending = undefined;
      };
      const startup = setTimeout(() => {
        fail(new Error("World advance worker startup timed out"));
        child.kill("SIGKILL");
      }, this.timeoutMs);
      child.on("error", fail);
      child.on("exit", (code, signal) => {
        fail(new Error(`World advance worker exited (${signal || code})`));
      });
      child.on("message", (message) => {
        if (message.type === "ready") {
          clearTimeout(startup);
          resolve();
        } else if (
          message.type === "result" &&
          message.id === this.pending?.id
        ) {
          const { resolve, reject } = this.pending;
          this.pending = undefined;
          if (message.error) reject(new Error(message.error));
          else resolve();
        }
      });
    });
    return this.ready;
  }

  advance(file, month) {
    const result = this.queue.then(async () => {
      if (this.closed) throw new Error("World advance worker is closed");
      await this.start();
      await new Promise((resolve, reject) => {
        const id = ++this.sequence;
        const timer = setTimeout(() => {
          this.pending = undefined;
          reject(
            new Error(`World advance request ${id} timed out\n${this.output}`),
          );
          this.child.kill("SIGKILL");
        }, this.timeoutMs);
        this.pending = {
          id,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
        this.child.send({ type: "advance", id, file, month }, (error) => {
          if (error && this.pending?.id === id) {
            this.pending.reject(error);
            this.pending = undefined;
          }
        });
      });
    });
    // A failed assertion is returned to its caller; it must not poison later requests.
    this.queue = result.catch(() => {});
    return result;
  }

  async close() {
    this.closed = true;
    this.pending?.reject(new Error("World advance worker is closed"));
    this.pending = undefined;
    if (!this.child) return;
    if (this.child.exitCode === null && !this.child.signalCode) {
      if (this.child.connected) this.child.disconnect();
      const timeout = setTimeout(() => this.child.kill("SIGKILL"), 5000);
      try {
        await this.exited;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (this.child.exitCode !== 0)
      throw new Error(
        `World advance worker failed (${this.child.signalCode || this.child.exitCode})\n${this.output}`,
      );
  }
}

module.exports = { WorldAdvanceWorker };
