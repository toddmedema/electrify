const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { libraryJson, parseLibrary } = require("./runtime.cjs");

function atomicWrite(filename, data) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, data, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    if (fs.existsSync(filename))
      fs.copyFileSync(filename, `${filename}.previous`);
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** The same atomic replacement without blocking Electron's main thread on large files. */
async function atomicWriteAsync(
  filename,
  data,
  { preservePrevious = false } = {},
) {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  const handle = await fs.promises.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (!preservePrevious)
      await fs.promises
        .copyFile(filename, `${filename}.previous`)
        .catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    await fs.promises.rename(temporary, filename);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
}

function readJson(filename, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

class DesktopSaveStore {
  constructor(root, steam) {
    this.steam = steam;
    const id = steam.state().steamId || "offline";
    if (!/^(offline|[0-9]{17})$/.test(id))
      throw new Error("Invalid Steam identity");
    this.directory = path.join(root, "players", id);
    this.filename = path.join(this.directory, "library.json");
    const deviceFile = path.join(this.directory, "device.json");
    let device;
    try {
      device = readJson(deviceFile, null);
    } catch {
      // Keep the damaged identifier for diagnosis; a new device library cannot overwrite it.
      device = null;
    }
    if (!device || !/^[a-f0-9]{32}$/.test(device.id)) {
      device = { id: crypto.randomBytes(16).toString("hex") };
      atomicWrite(deviceFile, JSON.stringify(device));
    }
    this.cloudName = `electrify/device-${device.id}.json`;
  }

  readLocal() {
    try {
      return parseLibrary(fs.readFileSync(this.filename, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      // Preserve both files. A torn/corrupt current file can recover the last completed write.
      try {
        return parseLibrary(
          fs.readFileSync(`${this.filename}.previous`, "utf8"),
        );
      } catch {
        throw new Error(
          "The local save backup could not be read. Your files have been preserved.",
        );
      }
    }
  }

  async read() {
    const local = this.readLocal();
    const cloudState = this.steam.cloudState();
    if (cloudState !== "ready")
      return { local, cloud: null, cloudCopies: [], cloudState };
    try {
      const cloudCopies = this.steam.readCloudLibraries().map(parseLibrary);
      return { local, cloud: cloudCopies[0] || null, cloudCopies, cloudState };
    } catch {
      return { local, cloud: null, cloudCopies: [], cloudState: "failed" };
    }
  }

  write(library, syncCloud = false) {
    // Backups, cloud sync and quit can overlap; commit them in request order.
    const task = (this.writing || Promise.resolve())
      .catch(() => undefined)
      .then(() => this.commit(library, syncCloud));
    this.writing = task;
    return task;
  }

  async commit(library, syncCloud) {
    if (typeof syncCloud !== "boolean")
      throw new Error("Invalid cloud sync flag");
    const json = libraryJson(library);
    await atomicWriteAsync(this.filename, json);
    let cloudState = this.steam.cloudState();
    if (syncCloud && cloudState === "ready") {
      try {
        if (!this.steam.writeCloudLibrary(this.cloudName, json))
          cloudState = "failed";
      } catch {
        cloudState = "failed";
      }
    }
    return { cloudState };
  }
}

module.exports = { atomicWrite, atomicWriteAsync, readJson, DesktopSaveStore };
