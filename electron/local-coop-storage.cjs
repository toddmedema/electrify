const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomicWriteAsync } = require("./storage.cjs");

const MAX_WORLD_BYTES = 16 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;
const MAX_SLOTS = 32;
const WORLD_KEYS = new Set([
  "commitments",
  "schema",
  "gameSchema",
  "rules",
  "spec",
  "outcomes",
  "matchId",
  "epoch",
  "revision",
  "seats",
  "grids",
  "edges",
  "selectedSpeeds",
  "activities",
  "speed",
  "readyRequired",
  "paused",
  "reason",
  "ready",
  "sequences",
  "receipts",
  "pricePerMWh",
]);
const record = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const hash = (json) => crypto.createHash("sha256").update(json).digest("hex");
const validId = (id) => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);
const validName = (name) =>
  typeof name === "string" && !!name.trim() && name.length <= 80;
const preserved =
  "The local couch save cannot be read. Your files are preserved.";

/** Local campaigns have an account owner, not Steam member seats. This deliberately does
 * not inherit CoopSaveStore: its online membership and Cloud boundary stay unchanged.
 * Only the authorized shell may submit worker checkpoints. restoreWorld remains the
 * whole-world simulation validator before a loaded checkpoint can start a session. */
class LocalCoopSaveStore {
  constructor(directory, ownerId, codec) {
    if (!/^(offline|[0-9]{17})$/.test(ownerId))
      throw new Error("Invalid local couch account owner");
    this.ownerId = ownerId;
    this.codec = codec;
    this.filename = path.join(directory, "local-coop-library.json");
    this.queue = Promise.resolve();
  }

  worldJson(world) {
    if (
      !record(world) ||
      Object.keys(world).some((key) => !WORLD_KEYS.has(key)) ||
      world.schema !== 3 ||
      !Number.isSafeInteger(world.gameSchema) ||
      world.gameSchema < 1 ||
      typeof world.rules !== "string" ||
      !world.rules ||
      typeof world.matchId !== "string" ||
      !world.matchId ||
      world.matchId.length > 200 ||
      typeof world.epoch !== "string" ||
      !world.epoch ||
      !Number.isSafeInteger(world.revision) ||
      world.revision < 0 ||
      !record(world.spec) ||
      !Array.isArray(world.seats) ||
      world.seats.length < 2 ||
      world.seats.length > 4 ||
      !world.seats.every(
        (seat, i) =>
          record(seat) &&
          seat.id === `local-p${i + 1}` &&
          validName(seat.name) &&
          Object.keys(seat).every((key) => ["id", "name"].includes(key)),
      ) ||
      !Array.isArray(world.grids) ||
      world.grids.length !== world.seats.length ||
      !world.grids.every(
        (grid, i) =>
          record(grid) && grid.multiplayer?.seat === world.seats[i].id,
      ) ||
      !Array.isArray(world.edges) ||
      world.edges.length !==
        (world.seats.length * (world.seats.length - 1)) / 2 ||
      ![
        "outcomes",
        "sequences",
        "receipts",
        "selectedSpeeds",
        "activities",
      ].every(
        (key) =>
          record(world[key]) &&
          Object.keys(world[key]).every((id) =>
            world.seats.some((seat) => seat.id === id),
          ),
      )
    )
      throw new Error(
        "Invalid local couch checkpoint or logical company roster",
      );
    const json = this.codec.stringify(world);
    if (Buffer.byteLength(json) > MAX_WORLD_BYTES)
      throw new Error("Local couch save is too large");
    return json;
  }

  decode(json) {
    if (Buffer.byteLength(json) > MAX_LIBRARY_BYTES)
      throw new Error("Local couch save library is too large");
    const library = this.codec.parse(json);
    if (library?.schema > 1)
      throw new Error(
        "This local couch library needs a newer game. Your files are preserved.",
      );
    if (
      !record(library) ||
      library.schema !== 1 ||
      library.kind !== "local" ||
      library.ownerId !== this.ownerId ||
      !Array.isArray(library.slots) ||
      library.slots.length > MAX_SLOTS
    )
      throw new Error(preserved);
    const ids = new Set();
    for (const slot of library.slots) {
      if (
        !record(slot) ||
        !validId(slot.id) ||
        ids.has(slot.id) ||
        !validName(slot.name) ||
        !Number.isSafeInteger(slot.updatedAt) ||
        slot.updatedAt < 0 ||
        typeof slot.digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(slot.digest) ||
        hash(this.worldJson(slot.world)) !== slot.digest
      )
        throw new Error(preserved);
      ids.add(slot.id);
    }
    return library;
  }

  read() {
    this.recovered = false;
    let originalError;
    try {
      return this.decode(fs.readFileSync(this.filename, "utf8"));
    } catch (error) {
      if (/newer game/.test(error.message)) throw error;
      originalError = error;
    }
    try {
      const library = this.decode(
        fs.readFileSync(`${this.filename}.previous`, "utf8"),
      );
      this.recovered = true;
      return library;
    } catch (error) {
      if (originalError.code === "ENOENT" && error.code === "ENOENT")
        return { schema: 1, kind: "local", ownerId: this.ownerId, slots: [] };
      throw new Error(preserved);
    }
  }

  transact(action) {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const library = this.read();
        const preservePrevious = this.recovered;
        const result = action(library);
        const json = this.codec.stringify(library);
        this.decode(json);
        if (preservePrevious) {
          // Keep unreadable current bytes for diagnosis while retaining the good backup.
          const unreadable = `${this.filename}.unreadable-${crypto.randomBytes(8).toString("hex")}`;
          await fs.promises
            .copyFile(this.filename, unreadable, fs.constants.COPYFILE_EXCL)
            .catch((error) => {
              if (error.code !== "ENOENT") throw error;
            });
        }
        await atomicWriteAsync(this.filename, json, { preservePrevious });
        return result;
      });
    this.queue = task;
    return task;
  }

  async save(world) {
    // Capture at submission time: queued I/O must not observe a later caller mutation.
    const json = this.worldJson(world);
    const checkpoint = this.codec.parse(json);
    const digest = hash(json);
    return this.transact((library) => {
      let slot = library.slots.find(
        (item) => item.world.matchId === checkpoint.matchId,
      );
      if (slot && checkpoint.revision < slot.world.revision)
        throw new Error("A newer local couch checkpoint is already saved");
      if (!slot) {
        if (library.slots.length >= MAX_SLOTS)
          throw new Error(
            "Your local couch library is full. Delete a save first.",
          );
        slot = {
          id: crypto.randomBytes(16).toString("hex"),
          name: `Local campaign ${library.slots.length + 1}`,
        };
        library.slots.push(slot);
      }
      Object.assign(slot, { world: checkpoint, digest, updatedAt: Date.now() });
      return { id: slot.id, updatedAt: slot.updatedAt, digest };
    });
  }

  async list() {
    await this.drain();
    return {
      kind: "local",
      storage: "local",
      slots: this.read().slots.map(({ id, name, updatedAt, world }) => ({
        id,
        name,
        updatedAt,
        matchId: world.matchId,
        players: world.seats.map((seat) => seat.name),
      })),
    };
  }

  async select(id) {
    if (!validId(id)) throw new Error("Invalid local couch save identifier");
    await this.drain();
    return this.read().slots.find((slot) => slot.id === id)?.world || null;
  }

  remove(id) {
    if (!validId(id))
      return Promise.reject(new Error("Invalid local couch save identifier"));
    return this.transact((library) => {
      if (!library.slots.some((slot) => slot.id === id))
        throw new Error("Local couch save no longer exists");
      library.slots = library.slots.filter((slot) => slot.id !== id);
    });
  }

  drain() {
    return this.queue.catch(() => {});
  }
}

module.exports = { LocalCoopSaveStore };
