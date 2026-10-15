const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  SteamAchievements,
  validateIntent,
  TUTORIAL_IDS,
  OFFICIAL_IDS,
  STATS,
} = require("./steam-achievements.cjs");
const catalog = require("./achievement-catalog.cjs");

function fixture(
  t,
  platform = "win32",
  cache = { achievements: new Set(), stats: new Map() },
) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-achievements-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "achievements.json");
  const listeners = new Map();
  const calls = [];
  const api = {
    stats: () => 7,
    requestStats: () => {
      calls.push(["request"]);
      return true;
    },
    getAchievement: (_stats, id, result) => {
      result[0] = cache.achievements.has(id) ? 1 : 0;
      return true;
    },
    setAchievement: (_stats, id) => {
      cache.achievements.add(id);
      calls.push(["award", id]);
      return true;
    },
    getStat: (_stats, name, result) => {
      result.writeInt32LE(cache.stats.get(name) || 0);
      return true;
    },
    setStat: (_stats, name, value) => {
      cache.stats.set(name, value);
      calls.push(["stat", name, value]);
      return true;
    },
    storeStats: () => {
      calls.push(["store"]);
      return true;
    },
  };
  const dispatcher = {
    onCallback: (id, listener) => {
      listeners.set(id, listener);
      return () => listeners.delete(id);
    },
  };
  const make = () =>
    new SteamAchievements(
      filename,
      api,
      dispatcher,
      123,
      "76561198000000001",
      platform,
    );
  const received = (result = 1, appId = 123n, steamId = 76561198000000001n) => {
    const payload = Buffer.alloc(platform === "win32" ? 24 : 20);
    payload.writeBigUInt64LE(appId);
    payload.writeInt32LE(result, 8);
    payload.writeBigUInt64LE(steamId, platform === "win32" ? 16 : 12);
    listeners.get(1101)?.(payload);
  };
  const stored = (result = 1, appId = 123n) => {
    const payload = Buffer.alloc(platform === "win32" ? 16 : 12);
    payload.writeBigUInt64LE(appId);
    payload.writeInt32LE(result, 8);
    listeners.get(1102)?.(payload);
  };
  return { api, calls, filename, listeners, make, received, stored, cache };
}

test("native catalog matches the renderer", () => {
  assert.deepEqual(
    catalog,
    require("../src/achievements/AchievementCatalog.json"),
  );
});
test("IPC accepts only catalog IDs and official/tutorial completions on known difficulties", () => {
  for (const input of [
    null,
    [],
    {},
    { earned: ["UNKNOWN"] },
    { earned: ["FIRST_SPARK", "FIRST_SPARK"] },
    { earned: [], completion: { scenarioId: 999, difficulty: "CEO" } },
    { earned: [], completion: { scenarioId: 100, difficulty: "Easy" } },
    { earned: [], file: "arbitrary" },
  ])
    assert.throws(() => validateIntent(input));
  assert.deepEqual(validateIntent({ earned: ["FIRST_SPARK"] }).earned, [
    "FIRST_SPARK",
  ]);
});
test("bankruptcy journals offline, survives relaunch and never records a successful completion", (t) => {
  const f = fixture(t);
  let service = new SteamAchievements(f.filename);
  service.add({ earned: ["OUT_OF_JUICE"] });
  service.add({ earned: ["OUT_OF_JUICE"] });
  service.dispose();
  service = f.make();
  assert.deepEqual(service.data.earned, ["OUT_OF_JUICE"]);
  assert.deepEqual(service.data.wins, []);
  assert.deepEqual(service.data.tutorials, []);
  f.received();
  assert.deepEqual(
    f.calls.filter(([kind]) => kind === "award"),
    [["award", "OUT_OF_JUICE"]],
  );
  assert.equal(f.calls.filter(([kind]) => kind === "stat").length, 0);
  f.stored();
  service.add({ earned: ["OUT_OF_JUICE"] });
  assert.equal(service.pending(), false);
  assert.equal(f.calls.filter(([kind]) => kind === "award").length, 1);
  service.dispose();
});
for (const platform of ["win32", "linux", "darwin"]) {
  test(`${platform} waits for matching stats load and StoreStats receipt, including offline cache`, (t) => {
    const f = fixture(t, platform);
    let service = f.make();
    service.add({ earned: ["LIGHTS_ON"] });
    assert.equal(service.pending(), true);
    assert.equal(f.calls.filter(([kind]) => kind === "award").length, 0);
    f.received(1, 999n);
    f.received(1, 123n, 5n);
    assert.equal(service.ready, undefined);
    f.received();
    assert.equal(f.calls.filter(([kind]) => kind === "award").length, 1);
    assert.equal(
      service.pending(),
      true,
      "StoreStats returning true is not confirmation",
    );
    f.stored(2);
    assert.equal(
      service.pending(),
      true,
      "Failed storage cannot lose an earned intent",
    );
    service.dispose();
    service = f.make();
    service.refresh();
    f.received();
    assert.equal(
      f.calls.filter(([kind]) => kind === "award").length,
      1,
      "Relaunch uses Steam's cached achievement",
    );
    f.stored(1, 999n);
    assert.equal(service.pending(), true);
    f.stored();
    assert.equal(service.pending(), false);
    const stores = f.calls.filter(([kind]) => kind === "store").length;
    service.add({ earned: ["LIGHTS_ON"] });
    service.refresh(Date.now() + 120000);
    assert.equal(f.calls.filter(([kind]) => kind === "store").length, stores);
    service.dispose();
    service = f.make();
    assert.equal(
      service.pending(),
      false,
      "Confirmed intents stay confirmed after relaunch",
    );
    service.dispose();
  });
}
test("a confirmation acknowledges its captured batch, never a later earned achievement", (t) => {
  const f = fixture(t);
  const service = f.make();
  service.add({ earned: ["LIGHTS_ON"] });
  f.received();
  service.add({ earned: ["GOOD_NEIGHBOR"] });
  f.stored();
  assert.deepEqual(service.data.confirmed, ["LIGHTS_ON"]);
  assert.equal(service.pending(), true);
  service.refresh(Date.now() + 120000);
  f.received();
  f.stored();
  assert.equal(service.pending(), false);
});
test("failed SetAchievement or StoreStats preserves the durable journal and retries", (t) => {
  const f = fixture(t);
  const service = f.make();
  f.api.setAchievement = () => false;
  service.add({ earned: ["LIGHTS_ON"] });
  f.received();
  assert.equal(service.inFlight, undefined);
  assert.equal(service.pending(), true);
  f.api.setAchievement = (_stats, id) => {
    f.cache.achievements.add(id);
    return true;
  };
  f.api.storeStats = () => false;
  service.refresh(Date.now() + 120000);
  f.received();
  service.refresh(Date.now() + 120000);
  assert.equal(service.inFlight, null);
  assert.equal(service.pending(), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.filename)).confirmed, []);
  f.api.storeStats = () => true;
  service.refresh(Date.now() + 240000);
  f.stored();
  assert.equal(service.pending(), false);
});
test("offline without Steam persists distinct tutorial and scenario/difficulty completions across launches", (t) => {
  const f = fixture(t);
  let service = new SteamAchievements(f.filename);
  for (const id of TUTORIAL_IDS.slice(0, -1))
    service.add({
      earned: [],
      completion: { scenarioId: id, difficulty: "Intern" },
    });
  assert(!service.data.earned.includes("GRID_GRADUATE"));
  service.dispose();
  service = new SteamAchievements(f.filename);
  service.add({
    earned: [],
    completion: { scenarioId: 112, difficulty: "Intern" },
  });
  assert(service.data.earned.includes("GRID_GRADUATE"));
  for (const id of OFFICIAL_IDS)
    service.add({
      earned: [],
      completion: { scenarioId: id, difficulty: "Intern" },
    });
  assert(!service.data.earned.includes("MASTER_OF_THE_GRID"));
  for (const id of OFFICIAL_IDS.slice(0, -1))
    service.add({
      earned: [],
      completion: { scenarioId: id, difficulty: "CEO" },
    });
  for (let i = 0; i < 20; i++)
    service.add({
      earned: [],
      completion: { scenarioId: OFFICIAL_IDS[0], difficulty: "CEO" },
    });
  assert(!service.data.earned.includes("MASTER_OF_THE_GRID"));
  service.add({
    earned: [],
    completion: { scenarioId: OFFICIAL_IDS.at(-1), difficulty: "CEO" },
  });
  assert(service.data.earned.includes("MASTER_OF_THE_GRID"));
  assert.equal(service.data.wins.length, OFFICIAL_IDS.length * 2);
  service.dispose();
  service = f.make();
  service.refresh();
  f.received();
  f.stored();
  assert.equal(service.pending(), false);
  for (const id of TUTORIAL_IDS)
    assert.equal(f.cache.stats.get(`ELECTRIFY_TUTORIAL_${id}`), 1);
  for (const id of OFFICIAL_IDS)
    assert.equal(f.cache.stats.get(`ELECTRIFY_WIN_${id}_CEO`), 1);
});
test("Steam completion stats merge into distinct local progress on a second device", (t) => {
  const f = fixture(t);
  for (const stat of STATS)
    if (stat.tutorial !== undefined || stat.win?.endsWith(":CEO"))
      f.cache.stats.set(stat.name, 1);
  const service = f.make();
  service.refresh();
  f.received();
  assert(service.data.earned.includes("GRID_GRADUATE"));
  assert(service.data.earned.includes("MASTER_OF_THE_GRID"));
  assert.equal(service.data.wins.length, OFFICIAL_IDS.length);
  f.stored();
  assert.equal(service.pending(), false);
});
test("corrupt current journal recovers the previous atomic copy and preserves evidence", (t) => {
  const f = fixture(t);
  let service = new SteamAchievements(f.filename);
  service.add({ earned: ["LIGHTS_ON"] });
  service.add({ earned: ["GOOD_NEIGHBOR"] });
  fs.writeFileSync(f.filename, "corrupt");
  service.dispose();
  service = new SteamAchievements(f.filename);
  assert(service.data.earned.includes("LIGHTS_ON"));
  assert(
    fs
      .readdirSync(path.dirname(f.filename))
      .some((name) => name.includes(".invalid-")),
  );
});
test("shutdown ignores late callbacks and never calls native stats again", (t) => {
  const f = fixture(t);
  const service = f.make();
  service.add({ earned: ["LIGHTS_ON"] });
  f.received();
  service.dispose();
  const count = f.calls.length;
  f.stored();
  f.received();
  service.refresh();
  assert.equal(f.calls.length, count);
  assert.equal(f.listeners.size, 0);
});
