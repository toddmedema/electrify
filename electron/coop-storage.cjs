const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomicWriteAsync, readJson } = require("./storage.cjs");

const MAX_WORLD_BYTES = 16 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;
const MAX_SLOTS = 32;
const hash = (json) => crypto.createHash("sha256").update(json).digest("hex");
const validId = (id) => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);
const validName = (name) =>
  typeof name === "string" && !!name.trim() && name.trim().length <= 80;
const validKey = (key) =>
  typeof key === "string" &&
  /^[a-f0-9]{32}:[a-f0-9]{32}:[a-f0-9]{64}$/.test(key);

/** Each device owns its Cloud file. Differing checkpoints are offered as separate copies. */
class CoopSaveStore {
  constructor(directory, steam, codec) {
    this.directory = directory;
    this.steam = steam;
    this.codec = codec;
    this.filename = path.join(directory, "co-op-library.json");
    this.legacy = path.join(directory, "co-op.json");
    this.deviceFile = path.join(directory, "co-op-device.json");
    let device;
    try {
      device = readJson(this.deviceFile, null);
    } catch {
      device = null;
    }
    this.device = validId(device?.id)
      ? device.id
      : crypto.randomBytes(16).toString("hex");
    this.cloudName = `electrify/co-op-device-${this.device}.json`;
    this.queue = Promise.resolve();
    this.cloudState = this.steam.cloudState?.() || "disabled";
  }
  decode(json) {
    if (Buffer.byteLength(json) > MAX_LIBRARY_BYTES)
      throw new Error("Shared save library is too large");
    const library = this.codec.parse(json);
    if (library?.schema > 1)
      throw new Error(
        "This shared save library needs a newer game. Your files are preserved.",
      );
    if (
      library?.schema !== 1 ||
      !Array.isArray(library.slots) ||
      library.slots.length > MAX_SLOTS ||
      !Array.isArray(library.deleted)
    )
      throw new Error(
        "This shared save library cannot be read. Your files are preserved.",
      );
    const ids = new Set();
    for (const slot of library.slots) {
      if (
        !validId(slot?.id) ||
        ids.has(slot.id) ||
        !validName(slot.name) ||
        !/^[a-f0-9]{32}:[a-f0-9]{32}$/.test(slot.source) ||
        !/^[a-f0-9]{64}$/.test(slot.digest) ||
        !Number.isFinite(slot.updatedAt)
      )
        throw new Error(
          "Invalid shared save library. Your files are preserved.",
        );
      this.worldJson(slot.world);
      if (hash(this.codec.stringify(slot.world)) !== slot.digest)
        throw new Error("Shared save checksum failed");
      ids.add(slot.id);
    }
    library.seen ??= [];
    if (
      library.deleted.length > 4096 ||
      library.deleted.some((key) => !validKey(key)) ||
      !Array.isArray(library.seen) ||
      library.seen.length > 4096 ||
      library.seen.some((key) => !validKey(key))
    )
      throw new Error("Invalid shared save deletion history");
    return library;
  }
  worldJson(world) {
    // Structural/simulation validation belongs to restoreWorld in the worker. Preserve newer formats.
    if (
      !world ||
      !Number.isInteger(world.schema) ||
      world.schema < 2 ||
      typeof world.matchId !== "string" ||
      !world.matchId ||
      world.matchId.length > 200 ||
      !Array.isArray(world.seats) ||
      world.seats.length < 2 ||
      world.seats.length > 4 ||
      !world.seats.every(
        (seat) =>
          seat &&
          typeof seat.id === "string" &&
          /^[0-9]{17}$/.test(seat.id) &&
          (seat.name === undefined ||
            (typeof seat.name === "string" && seat.name.length <= 200)),
      ) ||
      new Set(world.seats.map((seat) => seat.id)).size !== world.seats.length ||
      !world.seats.some((s) => s?.id === this.steam.identity.steamId)
    )
      throw new Error(
        "Invalid shared save or this account is not one of its players",
      );
    const json = this.codec.stringify(world);
    if (Buffer.byteLength(json) > MAX_WORLD_BYTES)
      throw new Error("Shared save is too large");
    return json;
  }
  read() {
    this.recovered = false;
    let library;
    try {
      library = this.decode(fs.readFileSync(this.filename, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        if (/newer game/.test(error.message)) throw error;
        try {
          const recovered = this.decode(
            fs.readFileSync(`${this.filename}.previous`, "utf8"),
          );
          this.recovered = true;
          return recovered;
        } catch {
          throw new Error(
            "The local shared save backup could not be read. Your files are preserved.",
          );
        }
      }
      library = { schema: 1, slots: [], deleted: [], seen: [] };
      if (fs.existsSync(this.legacy)) {
        try {
          const world = this.codec.parse(fs.readFileSync(this.legacy, "utf8"));
          const slot = this.add(library, world, "Last shared save");
          slot.id = hash(this.codec.stringify(world)).slice(0, 32);
          slot.source = `${this.device}:${slot.id}`;
        } catch {
          this.warning =
            "The old shared checkpoint could not be read. Its file is preserved; other campaigns are available.";
        }
      }
    }
    return library;
  }
  add(library, world, name, source) {
    const json = this.worldJson(world);
    const digest = hash(json);
    if (library.slots.length >= MAX_SLOTS)
      throw new Error(
        "Your shared save library is full. Export or delete a campaign first.",
      );
    const id = crypto.randomBytes(16).toString("hex");
    const slot = {
      id,
      source: source || `${this.device}:${id}`,
      name,
      updatedAt: Date.now(),
      digest,
      world,
    };
    library.slots.push(slot);
    return slot;
  }
  transact(action) {
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const library = this.read();
        const preservePrevious = this.recovered;
        const result = await action(library);
        library.seen = [...new Set(library.seen)].slice(-4096);
        library.deleted = [...new Set(library.deleted)];
        const json = this.codec.stringify(library);
        this.decode(json);
        if (Buffer.byteLength(json) > MAX_LIBRARY_BYTES)
          throw new Error(
            "Shared save library is too large. Export or delete a campaign first.",
          );
        await atomicWriteAsync(
          this.deviceFile,
          JSON.stringify({ id: this.device }),
        );
        // A recovered library's current file is damaged; it must never replace its good backup.
        await atomicWriteAsync(this.filename, json, { preservePrevious });
        this.cloudState = this.steam.cloudState?.() || "disabled";
        if (this.cloudState === "ready") {
          try {
            if (!this.steam.writeCloudLibrary(this.cloudName, json, "coop"))
              this.cloudState = "failed";
          } catch {
            this.cloudState = "failed";
          }
        }
        return result;
      });
    this.queue = operation;
    return operation;
  }
  async list(sync = false) {
    await this.queue.catch(() => {});
    if (sync) this.warning = undefined;
    if (sync && this.steam.cloudState?.() === "ready") {
      let copies;
      try {
        copies = this.steam
          .readCloudLibraries("coop")
          .map((json) => this.decode(json));
      } catch {
        this.cloudState = "failed";
        copies = null;
      }
      if (copies)
        await this.transact((library) => {
          const deleted = new Set([
            ...library.deleted,
            ...copies.flatMap((copy) => copy.deleted),
          ]);
          for (const copy of copies)
            for (const slot of copy.slots) {
              const key = `${slot.source}:${slot.digest}`;
              if (
                deleted.has(key) ||
                library.seen.includes(key) ||
                library.slots.some(
                  (local) =>
                    local.source === slot.source &&
                    local.digest === slot.digest,
                )
              )
                continue;
              this.add(
                library,
                slot.world,
                `${slot.name.slice(0, 65)} (Cloud copy)`,
                slot.source,
              );
              library.seen.push(key);
            }
          library.deleted = [...deleted];
        }).catch((error) => {
          this.cloudState = "failed";
          this.warning = `Steam Cloud copies could not be added: ${error.message}`;
        });
    }
    const library = this.read();
    return {
      slots: library.slots.map(({ id, name, updatedAt, world }) => ({
        id,
        name,
        updatedAt,
        matchId: world.matchId,
        schema: world.schema,
        players: world.seats.map((s) => s.name || s.id),
      })),
      cloudState: this.cloudState,
      warning: this.warning,
    };
  }
  async save(world) {
    const json = this.worldJson(world);
    return this.transact(async (library) => {
      let slot = library.slots.find(
        (s) => s.id === this.activeId && s.world.matchId === world.matchId,
      );
      if (!slot)
        slot = library.slots.find(
          (s) =>
            s.world.matchId === world.matchId &&
            s.source.startsWith(`${this.device}:`),
        );
      if (!slot)
        slot = this.add(library, world, `Campaign ${library.slots.length + 1}`);
      if (
        slot.world.schema > world.schema ||
        (slot.world.gameSchema ?? 0) > (world.gameSchema ?? 0)
      )
        throw new Error(
          "This campaign needs a newer game. Your original save is preserved.",
        );
      if (
        slot.world.rules !== world.rules ||
        slot.world.schema !== world.schema ||
        slot.world.gameSchema !== world.gameSchema
      ) {
        // Immutable pre-upgrade copy, independent of the rotating .previous backup.
        const backup = path.join(
          this.directory,
          `co-op-original-${slot.digest}.json`,
        );
        await fs.promises
          .writeFile(backup, this.codec.stringify(slot.world), {
            flag: "wx",
            mode: 0o600,
          })
          .catch((error) => {
            if (error.code !== "EEXIST") throw error;
          });
      }
      slot.world = world;
      slot.digest = hash(json);
      slot.updatedAt = Date.now();
      this.activeId = slot.id;
      return slot.digest;
    });
  }
  async select(id) {
    await this.queue.catch(() => {});
    const library = this.read();
    const slot = id
      ? library.slots.find((s) => s.id === id)
      : library.slots.reduce(
          (latest, s) =>
            !latest || s.updatedAt > latest.updatedAt ? s : latest,
          null,
        );
    if (!slot) return null;
    this.activeId = slot.id;
    return slot.world;
  }
  rename(id, name) {
    if (!validName(name))
      throw new Error("Use a campaign name of 1–80 characters");
    return this.transact((library) => {
      const slot = library.slots.find((s) => s.id === id);
      if (!slot) throw new Error("Shared save no longer exists");
      slot.name = name.trim();
    });
  }
  remove(id) {
    return this.transact((library) => {
      const slot = library.slots.find((s) => s.id === id);
      if (!slot) throw new Error("Shared save no longer exists");
      library.deleted.push(`${slot.source}:${slot.digest}`);
      library.slots = library.slots.filter((s) => s.id !== id);
      if (this.activeId === id) this.activeId = undefined;
    });
  }
  async importFile(filename) {
    if ((await fs.promises.stat(filename)).size > MAX_WORLD_BYTES)
      throw new Error("Shared save is too large");
    const json = await fs.promises.readFile(filename, "utf8");
    const world = this.codec.parse(json);
    this.worldJson(world);
    return this.transact((library) => {
      const digest = hash(this.codec.stringify(world));
      if (library.slots.some((s) => s.digest === digest)) return;
      this.add(library, world, "Imported campaign");
    });
  }
  async exportFile(id, filename) {
    await this.queue.catch(() => {});
    const slot = this.read().slots.find((s) => s.id === id);
    if (!slot) throw new Error("Shared save no longer exists");
    await atomicWriteAsync(filename, this.codec.stringify(slot.world));
  }
}
module.exports = { CoopSaveStore };
