const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DesktopSaveStore, atomicWrite } = require("./storage.cjs");
const { SteamService } = require("./steam.cjs");

function directory(t) {
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryRoot, "electrify-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function steam(id = undefined, status = "ready") {
  const files = new Map();
  return {
    state: () => ({ steamId: id }),
    cloudState: () => status,
    readCloudLibraries: () => [...files.values()],
    writeCloudLibrary: (name, content) => {
      files.set(name, content);
      return true;
    },
    files,
  };
}

test("local checkpoints are durable without network and cloud writes are explicit", async (t) => {
  const cloud = steam("76561198000000001");
  const store = new DesktopSaveStore(directory(t), cloud);
  const library = { version: 1, records: [{ id: "a", deleted: true }] };
  await store.write(library);
  assert.equal(cloud.files.size, 0);
  assert.deepEqual((await store.read()).local, library);
  await store.write(library, true);
  assert.equal(cloud.files.size, 1);
  assert.deepEqual((await store.read()).cloudCopies, [library]);
  assert.equal(
    fs.readdirSync(store.directory).filter((name) => name.endsWith(".tmp"))
      .length,
    0,
  );
});

test("different machines never overwrite each other's cloud history or deletion tombstones", async (t) => {
  const cloud = steam("76561198000000001");
  const left = new DesktopSaveStore(directory(t), cloud);
  const right = new DesktopSaveStore(directory(t), cloud);
  const first = { version: 1, records: [{ id: "a", revision: 1 }] };
  const second = { version: 1, records: [{ id: "a", deleted: true }] };
  await left.write(first, true);
  await right.write(second, true);
  assert.notEqual(left.cloudName, right.cloudName);
  assert.deepEqual((await left.read()).cloudCopies, [first, second]);
  assert.equal(
    new DesktopSaveStore(path.dirname(path.dirname(left.directory)), cloud)
      .cloudName,
    left.cloudName,
  );
});

test("Steam account paths and offline profile remain isolated", async (t) => {
  const root = directory(t);
  const first = new DesktopSaveStore(
    root,
    steam("76561198000000001", "offline"),
  );
  const second = new DesktopSaveStore(
    root,
    steam("76561198000000002", "offline"),
  );
  const offline = new DesktopSaveStore(root, steam(undefined, "disabled"));
  await first.write({ version: 1, records: ["first"] }, true);
  assert.equal((await second.read()).local, null);
  assert.equal((await offline.read()).local, null);
  assert.equal((await first.read()).cloudState, "offline");
});

test("corrupt current save recovers previous checkpoint and keeps corrupt evidence", async (t) => {
  const store = new DesktopSaveStore(
    directory(t),
    steam(undefined, "disabled"),
  );
  const first = { version: 1, records: ["first"] };
  await store.write(first);
  await store.write({ version: 1, records: ["second"] });
  fs.writeFileSync(store.filename, "{broken");
  assert.deepEqual((await store.read()).local, first);
  assert.equal(fs.readFileSync(store.filename, "utf8"), "{broken");
});

test("cloud failure preserves local checkpoint and untrusted remote bytes", async (t) => {
  const cloud = steam();
  cloud.files.set("corrupt.json", "{broken");
  const store = new DesktopSaveStore(directory(t), cloud);
  const local = { version: 1, records: ["safe"] };
  await store.write(local);
  assert.deepEqual(await store.read(), {
    local,
    cloud: null,
    cloudCopies: [],
    cloudState: "failed",
  });
  cloud.writeCloudLibrary = () => {
    throw new Error("quota");
  };
  assert.equal((await store.write(local, true)).cloudState, "failed");
  assert.equal(cloud.files.get("corrupt.json"), "{broken");
});

test("corrupt device and score queue files do not stop offline startup", async (t) => {
  const root = directory(t);
  const store = new DesktopSaveStore(root, steam());
  const oldName = store.cloudName;
  fs.writeFileSync(path.join(store.directory, "device.json"), "{broken");
  const recovered = new DesktopSaveStore(root, steam());
  assert.notEqual(recovered.cloudName, oldName);
  const service = new SteamService();
  atomicWrite(path.join(store.directory, "pending-scores.json"), "{broken");
  service.configureScoreQueue(store.directory);
  assert.deepEqual(service.pending, []);
  assert(
    fs.readdirSync(store.directory).some((name) => name.includes(".invalid-")),
  );
});

test("offline score queue keeps best scores and retries through the real board adapter", async (t) => {
  const service = new SteamService();
  const root = directory(t);
  service.configureScoreQueue(root);
  const input = {
    scenarioId: 101,
    difficulty: "CEO",
    challengeId: "rules-a",
    score: 500,
  };
  await service.submitScore(input);
  await service.submitScore({ ...input, score: 100 });
  assert.equal(service.pending.length, 1);
  const uploaded = [];
  service.state = () => ({ online: true });
  service.leaderboards = { upload: async (entry) => uploaded.push(entry) };
  await service.flushScores();
  assert.deepEqual(uploaded, [input]);
  assert.deepEqual(JSON.parse(fs.readFileSync(service.queueFile, "utf8")), []);
});

test("overlapping library writes commit in request order without blocking", async (t) => {
  const store = new DesktopSaveStore(directory(t), steam());
  const writes = [1, 2, 3].map((revision) =>
    store.write({ version: 1, records: [{ revision }] }),
  );
  await Promise.all(writes);
  assert.deepEqual((await store.read()).local.records, [{ revision: 3 }]);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(`${store.filename}.previous`, "utf8")).records,
    [{ revision: 2 }],
  );
  await assert.rejects(store.write({ version: 2, records: [] }), /Invalid/);
  assert.deepEqual((await store.read()).local.records, [{ revision: 3 }]);
  assert.equal(
    fs.readdirSync(store.directory).filter((name) => name.endsWith(".tmp"))
      .length,
    0,
  );
});
