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
    this.storeAttempts = 0;
    this.storeReceipts = 0;
    this.storeSuccesses = 0;
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
    try {
      this.stats = api?.stats();
    } catch {
      // Steam may disappear during startup; the durable journal still works.
    }
    this.unsubscribe = [];
    if (api && dispatcher) {
      this.unsubscribe.push(
        dispatcher.onCallback(1101, (payload) => this.received(payload)),
        dispatcher.onCallback(1102, (payload) => this.stored(payload)),
      );
    }
  }

  persist(data = this.data) {
    atomicWrite(this.filename, JSON.stringify(data));
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
  aggregate(data = this.data) {
    for (const win of data.wins) {
      const [scenarioId, difficulty] = win.split(":");
      const entry = catalog.find(
        (item) => item.scenarioId === Number(scenarioId),
      );
      data.earned = union(data.earned, [entry.id, "STAYING_POWER"]);
      if (difficulty === "CEO")
        data.earned = union(data.earned, ["CHIEF_ELECTRICITY_OFFICER"]);
    }
    if (data.tutorials.includes(0))
      data.earned = union(data.earned, ["FIRST_SPARK"]);
    if (TUTORIAL_IDS.every((id) => data.tutorials.includes(id)))
      data.earned = union(data.earned, ["GRID_GRADUATE"]);
    if (OFFICIAL_IDS.every((id) => data.wins.includes(`${id}:CEO`)))
      data.earned = union(data.earned, ["MASTER_OF_THE_GRID"]);
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
      !this.api ||
      now < (this.retryAt || 0) ||
      (this.inFlight && now < this.storeUntil)
    )
      return;
    try {
      this.stats ||= this.api.stats();
      if (!this.stats) {
        this.retryAt = now + 60000;
        return;
      }
      if (!this.ready) {
        if (now < (this.requestUntil || 0)) return;
        // The pinned SDK v012 requires RequestCurrentStats, including Offline Mode.
        this.requestUntil = now + 15000;
        this.api.requestStats(this.stats);
        return;
      }
      if (!this.pending()) return;
      const batch = this.inFlight || JSON.parse(JSON.stringify(this.data));
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
      // Retry a missing receipt at most once a minute, keeping the same frozen
      // batch. UserStatsStored has no request ID and old receipts may arrive late.
      const previous = this.inFlight;
      if (!previous) this.confirmAfter = this.storeAttempts + 1;
      this.inFlight = batch;
      this.storeUntil = now + 60000;
      if (this.api.storeStats(this.stats)) this.storeAttempts++;
      else {
        this.inFlight = previous || null;
        this.retryAt = now + 60000;
      }
    } catch {
      this.ready = false;
      this.retryAt = now + 60000;
    }
  }
  received(payload) {
    const size = this.platform === "win32" ? 24 : 20;
    if (
      this.stopped ||
      !this.stats ||
      payload.length !== size ||
      payload.readBigUInt64LE(0) !== this.appId ||
      payload.readBigUInt64LE(this.platform === "win32" ? 16 : 12) !==
        this.steamId
    )
      return;
    this.ready = false;
    if (payload.readInt32LE(8) !== 1) return;
    try {
      const next = JSON.parse(JSON.stringify(this.data));
      for (const stat of STATS) {
        const value = Buffer.alloc(4);
        if (
          !this.api.getStat(this.stats, stat.name, value) ||
          value.readInt32LE(0) !== 1
        )
          continue;
        if (stat.tutorial !== undefined)
          next.tutorials = union(next.tutorials, [stat.tutorial]);
        else next.wins = union(next.wins, [stat.win]);
      }
      // A cached unlock can still be awaiting upload. Import it as earned and let
      // StoreStats acknowledge it, without repeating SetAchievement or clearing it.
      for (const { id } of catalog) {
        const unlocked = Buffer.alloc(1);
        if (this.api.getAchievement(this.stats, id, unlocked) && unlocked[0])
          next.earned = union(next.earned, [id]);
      }
      this.aggregate(next);
      if (JSON.stringify(next) !== JSON.stringify(this.data))
        this.persist(next);
      this.data = next;
      this.ready = true;
      this.refresh();
    } catch {
      // Publish imported history only after it is durable. A later stats request
      // can recover from a disk error or disappearing Steam client.
      this.retryAt = Date.now() + 60000;
    }
  }

  stored(payload) {
    const size = this.platform === "win32" ? 16 : 12;
    if (
      this.stopped ||
      this.storeReceipts >= this.storeAttempts ||
      payload.length !== size ||
      payload.readBigUInt64LE(0) !== this.appId
    )
      return;
    this.storeReceipts++;
    this.retryAt = Date.now() + 60000;
    const success = payload.readInt32LE(8) === 1;
    if (success) this.storeSuccesses++;
    else this.ready = false;
    // At most confirmAfter-1 successful receipts can belong to older batches.
    // Reaching this threshold proves a store containing the frozen batch succeeded,
    // even if responses arrive out of order or an earlier receipt never arrives.
    if (this.inFlight && success && this.storeSuccesses >= this.confirmAfter) {
      const batch = this.inFlight;
      this.inFlight = null;
      const next = {
        ...this.data,
        confirmed: union(this.data.confirmed, batch.earned),
        storedTutorials: union(this.data.storedTutorials, batch.tutorials),
        storedWins: union(this.data.storedWins, batch.wins),
      };
      try {
        this.persist(next);
        this.data = next;
      } catch {
        // The receipt must also be durable; retry this still-pending batch later.
      }
    }
    if (this.storeReceipts === this.storeAttempts) {
      // Every accepted request has replied, so no older receipt can acknowledge
      // the next batch. Failed or non-durable confirmations remain in the journal.
      this.storeAttempts = 0;
      this.storeReceipts = 0;
      this.storeSuccesses = 0;
      this.inFlight = null;
    }
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
