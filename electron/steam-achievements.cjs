const fs = require("node:fs");
const { atomicWrite, readJson } = require("./storage.cjs");
const catalog = require("./achievement-catalog.cjs");

const TUTORIAL_IDS = [0, 1, 2, 4, 3, 5, 112];
const OFFICIAL_IDS = catalog
  .filter((entry) => entry.scenarioId >= 100)
  .map((entry) => entry.scenarioId);
const DIFFICULTIES = ["Intern", "Employee", "Manager", "VP", "CEO"];
const IDS = new Set(catalog.map(({ id }) => id));
const wins = new Set(
  OFFICIAL_IDS.flatMap((id) =>
    DIFFICULTIES.map((difficulty) => `${id}:${difficulty}`),
  ),
);
const STATS = [
  ...TUTORIAL_IDS.map((id) => ({
    name: `ELECTRIFY_TUTORIAL_${id}`,
    tutorial: id,
  })),
  ...OFFICIAL_IDS.flatMap((id) =>
    DIFFICULTIES.map((difficulty) => ({
      name: `ELECTRIFY_WIN_${id}_${difficulty.toUpperCase()}`,
      win: `${id}:${difficulty}`,
    })),
  ),
];
const empty = () => ({
  version: 1,
  earned: [],
  confirmed: [],
  tutorials: [],
  wins: [],
  storedTutorials: [],
  storedWins: [],
});
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const distinct = (value, allowed) =>
  Array.isArray(value) &&
  value.length <= allowed.size &&
  new Set(value).size === value.length &&
  value.every((entry) => allowed.has(entry));

function validateIntent(input) {
  if (
    !object(input) ||
    Object.keys(input).some((key) => !["earned", "completion"].includes(key)) ||
    !distinct(input.earned, IDS)
  )
    throw new Error("Invalid achievement intent");
  const completion = input.completion;
  if (
    completion !== undefined &&
    (!object(completion) ||
      Object.keys(completion).some(
        (key) => !["scenarioId", "difficulty"].includes(key),
      ) ||
      ![...TUTORIAL_IDS, ...OFFICIAL_IDS].includes(completion.scenarioId) ||
      !DIFFICULTIES.includes(completion.difficulty))
  )
    throw new Error("Invalid achievement completion");
  return { earned: [...input.earned], completion };
}

function validJournal(value) {
  return (
    object(value) &&
    value.version === 1 &&
    distinct(value.earned, IDS) &&
    distinct(value.confirmed, new Set(value.earned)) &&
    distinct(value.tutorials, new Set(TUTORIAL_IDS)) &&
    distinct(value.wins, wins) &&
    distinct(value.storedTutorials, new Set(value.tutorials)) &&
    distinct(value.storedWins, new Set(value.wins))
  );
}
const union = (a, b) => [...new Set([...a, ...b])];

/** Durable earned intents supplement Steam's offline cache; only a StoreStats receipt
 * removes a pending intent. This journal never clears an achievement or resets Steam stats. */
class SteamAchievements {
  constructor(
    filename,
    api,
    dispatcher,
    appId,
    steamId,
    platform = process.platform,
  ) {
    this.filename = filename;
    this.api = api;
    this.appId = BigInt(appId || 0);
    this.steamId = BigInt(steamId || 0);
    this.platform = platform;
    this.data = empty();
    for (const candidate of [filename, `${filename}.previous`]) {
      try {
        const value = readJson(candidate, null);
        if (value && validJournal(value)) {
          this.data = value;
          break;
        }
        if (value) throw new Error("Invalid achievement journal");
      } catch {
        // Keep recovery evidence and try the atomic writer's previous version.
        try {
          if (fs.existsSync(candidate))
            fs.copyFileSync(candidate, `${candidate}.invalid-${Date.now()}`);
        } catch {
          /* Achievement recovery must not prevent local play. */
        }
      }
    }
    this.stats = api?.stats();
    this.unsubscribe = [];
    if (this.stats && dispatcher) {
      this.unsubscribe.push(
        dispatcher.onCallback(1101, (payload) => this.received(payload)),
        dispatcher.onCallback(1102, (payload) => this.stored(payload)),
      );
    }
  }

  persist() {
    atomicWrite(this.filename, JSON.stringify(this.data));
  }
  add(input) {
    const { earned, completion } = validateIntent(input);
    const before = JSON.stringify(this.data);
    this.data.earned = union(this.data.earned, earned);
    if (completion) {
      if (TUTORIAL_IDS.includes(completion.scenarioId))
        this.data.tutorials = union(this.data.tutorials, [
          completion.scenarioId,
        ]);
      else
        this.data.wins = union(this.data.wins, [
          `${completion.scenarioId}:${completion.difficulty}`,
        ]);
    }
    this.aggregate();
    if (JSON.stringify(this.data) !== before) {
      try {
        this.persist();
      } catch (error) {
        this.data = JSON.parse(before);
        throw error;
      }
    }
    this.refresh();
  }
  aggregate() {
    for (const win of this.data.wins) {
      const [scenarioId, difficulty] = win.split(":");
      const entry = catalog.find(
        (item) => item.scenarioId === Number(scenarioId),
      );
      this.data.earned = union(this.data.earned, [entry.id, "STAYING_POWER"]);
      if (difficulty === "CEO")
        this.data.earned = union(this.data.earned, [
          "CHIEF_ELECTRICITY_OFFICER",
        ]);
    }
    if (this.data.tutorials.includes(0))
      this.data.earned = union(this.data.earned, ["FIRST_SPARK"]);
    if (TUTORIAL_IDS.every((id) => this.data.tutorials.includes(id)))
      this.data.earned = union(this.data.earned, ["GRID_GRADUATE"]);
    if (OFFICIAL_IDS.every((id) => this.data.wins.includes(`${id}:CEO`)))
      this.data.earned = union(this.data.earned, ["MASTER_OF_THE_GRID"]);
  }
  pending() {
    return (
      this.data.earned.some((id) => !this.data.confirmed.includes(id)) ||
      this.data.tutorials.some(
        (id) => !this.data.storedTutorials.includes(id),
      ) ||
      this.data.wins.some((id) => !this.data.storedWins.includes(id))
    );
  }
  refresh(now = Date.now()) {
    if (
      this.stopped ||
      !this.stats ||
      this.inFlight ||
      now < (this.retryAt || 0)
    )
      return;
    try {
      if (!this.ready) {
        if (now < (this.requestUntil || 0)) return;
        // The pinned SDK v012 requires RequestCurrentStats, including Offline Mode.
        this.requestUntil = now + 15000;
        this.api.requestStats(this.stats);
        return;
      }
      if (!this.pending()) return;
      const batch = JSON.parse(JSON.stringify(this.data));
      let accepted = true;
      for (const id of batch.earned.filter(
        (id) => !batch.confirmed.includes(id),
      )) {
        const unlocked = Buffer.alloc(1);
        if (!this.api.getAchievement(this.stats, id, unlocked))
          accepted = false;
        else if (!unlocked[0] && !this.api.setAchievement(this.stats, id))
          accepted = false;
      }
      // Independent monotonic flags survive Steam's "most progress" offline merge;
      // a bitmask's numeric maximum could erase distinct wins from another device.
      for (const stat of STATS) {
        const completed =
          stat.tutorial !== undefined
            ? batch.tutorials.includes(stat.tutorial)
            : batch.wins.includes(stat.win);
        if (completed && !this.api.setStat(this.stats, stat.name, 1))
          accepted = false;
      }
      if (!accepted) {
        this.ready = false;
        this.retryAt = now + 60000;
        return;
      }
      // Snapshot before StoreStats: a callback confirms only this batch, never awards
      // earned while it was outstanding. Its boolean return alone is not a receipt.
      this.inFlight = batch;
      if (!this.api.storeStats(this.stats)) {
        this.inFlight = null;
        this.retryAt = now + 60000;
      }
    } catch {
      this.inFlight = null;
      this.ready = false;
      this.retryAt = now + 60000;
    }
  }
  received(payload) {
    const size = this.platform === "win32" ? 24 : 20;
    if (
      this.stopped ||
      payload.length !== size ||
      payload.readBigUInt64LE(0) !== this.appId ||
      payload.readBigUInt64LE(this.platform === "win32" ? 16 : 12) !==
        this.steamId
    )
      return;
    this.ready = payload.readInt32LE(8) === 1;
    if (!this.ready) return;
    for (const stat of STATS) {
      const value = Buffer.alloc(4);
      if (
        !this.api.getStat(this.stats, stat.name, value) ||
        value.readInt32LE(0) !== 1
      )
        continue;
      if (stat.tutorial !== undefined)
        this.data.tutorials = union(this.data.tutorials, [stat.tutorial]);
      else this.data.wins = union(this.data.wins, [stat.win]);
    }
    // Existing Steam achievements are authoritative. Pending local intents still need
    // a storage confirmation, even if SetAchievement survived in Steam's offline cache.
    for (const { id } of catalog) {
      const unlocked = Buffer.alloc(1);
      if (
        this.api.getAchievement(this.stats, id, unlocked) &&
        unlocked[0] &&
        !this.data.earned.includes(id)
      ) {
        this.data.earned.push(id);
        this.data.confirmed.push(id);
      }
    }
    this.aggregate();
    this.persist();
    this.refresh();
  }
  stored(payload) {
    const size = this.platform === "win32" ? 16 : 12;
    if (
      this.stopped ||
      !this.inFlight ||
      payload.length !== size ||
      payload.readBigUInt64LE(0) !== this.appId
    )
      return;
    const batch = this.inFlight;
    this.inFlight = null;
    this.retryAt = Date.now() + 60000;
    if (payload.readInt32LE(8) !== 1) {
      this.ready = false;
      return;
    }
    const next = {
      ...this.data,
      confirmed: union(this.data.confirmed, batch.earned),
      storedTutorials: union(this.data.storedTutorials, batch.tutorials),
      storedWins: union(this.data.storedWins, batch.wins),
    };
    atomicWrite(this.filename, JSON.stringify(next));
    this.data = next;
  }
  dispose() {
    this.stopped = true;
    this.unsubscribe.forEach((stop) => stop());
  }
}

module.exports = {
  SteamAchievements,
  validateIntent,
  validJournal,
  TUTORIAL_IDS,
  OFFICIAL_IDS,
  STATS,
};
