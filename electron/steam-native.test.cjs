const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DECLARATIONS,
  loadFunctions,
  nativeBindingPath,
  initializeBinding,
  layouts,
  boardName,
  SteamLeaderboards,
} = require("./steam-native.cjs");

test("every flat Steam SDK symbol resolves against the actually bundled native library", () => {
  const functions = loadFunctions();
  assert.deepEqual(Object.keys(functions), Object.keys(DECLARATIONS));
  assert(
    Object.values(functions).every((entry) => typeof entry === "function"),
  );
});

test("pinned native binding initializes without creating the competing Rust callback timer", () => {
  const shipped = require(nativeBindingPath());
  for (const name of ["init", "runCallbacks", "restartAppIfNecessary"])
    assert.equal(typeof shipped[name], "function");
  const calls = [];
  const binding = {
    init: (id) => calls.push(id),
    runCallbacks: () => assert.fail("Competing callback pump started"),
  };
  assert.equal(initializeBinding(123456, binding), binding);
  assert.deepEqual(calls, [123456]);
});

function mockNative(platform) {
  const calls = [];
  const packing = layouts(platform);
  const api = {
    stats: () => "stats",
    utils: () => "utils",
    friends: () => "friends",
    user: () => "user",
    online: () => true,
    find: (...args) => {
      calls.push(["find", ...args]);
      return 101n;
    },
    download: (...args) => {
      calls.push(["download", ...args]);
      return 102n;
    },
    upload: (...args) => {
      calls.push(["upload", ...args]);
      return 103n;
    },
    result: (_self, _handle, target, size, callback, failed) => {
      failed[0] = 0;
      calls.push(["result", size, callback]);
      if (callback === 1104) {
        assert.equal(size, packing.find.size);
        target.writeBigUInt64LE(999n);
        target[8] = 1;
      } else if (callback === 1105) {
        assert.equal(size, packing.download.size);
        target.writeBigUInt64LE(999n);
        target.writeBigUInt64LE(888n, 8);
        target.writeInt32LE(2, 16);
      } else if (callback === 1106) {
        assert.equal(size, packing.upload.size);
        target[0] = 1;
      } else assert.fail(`Unknown callback: ${callback}`);
      return true;
    },
    entry: (_self, entries, index, target, details, count) => {
      assert.equal(entries, 888n);
      assert.equal(target.length, packing.entrySize);
      assert.equal(details, null);
      assert.equal(count, 0);
      target.writeBigUInt64LE(76561198000000001n + BigInt(index));
      target.writeInt32LE(index + 4, 8);
      target.writeInt32LE(1000 - index * 100, 12);
      return true;
    },
    requestPersona: (...args) => {
      calls.push(["persona-request", ...args]);
      return false;
    },
    persona: (_self, id) => `Player ${id}`,
  };
  const dispatcher = {
    callResult: async (handle, layout) => {
      if (!handle || BigInt(handle) === 0n)
        throw new Error("Steam request could not start");
      const result = Buffer.alloc(layout.size);
      const failed = Buffer.alloc(1);
      if (
        !api.result(
          null,
          handle,
          result,
          layout.size,
          layout.callback,
          failed,
        ) ||
        failed[0]
      )
        throw new Error("Steam request failed");
      return result;
    },
  };
  return { api, calls, dispatcher };
}

test("Steam uploads the full build version in integer score details", async () => {
  const { api, calls, dispatcher } = mockNative("win32");
  const boards = new SteamLeaderboards(api, dispatcher, "win32");
  const appVersion = "26sept26-1507";
  await boards.upload({
    scenarioId: 101,
    difficulty: "CEO",
    challengeId: "rules-a",
    score: 800,
    appVersion,
  });
  const upload = calls.find((entry) => entry[0] === "upload");
  const details = upload[5];
  assert.equal(upload[6], details.length / 4);
  assert.equal(details.toString("ascii").replace(/\0+$/, ""), appVersion);
});

for (const platform of ["win32", "linux", "darwin"]) {
  test(`SDK ${platform} packing reads friends with Steam identities and real rank`, async () => {
    const { api, calls, dispatcher } = mockNative(platform);
    const boards = new SteamLeaderboards(api, dispatcher, platform);
    const input = {
      scenarioId: 101,
      difficulty: "CEO",
      challengeId: "rules-a",
      scope: "friends",
    };
    const rows = await boards.read(input);
    assert.equal(rows[0].steamId, "76561198000000001");
    assert.equal(rows[0].rank, 4);
    assert.equal(rows[0].score, 1000);
    assert.equal(rows[1].difficulty, "CEO");
    assert.deepEqual(
      calls.find((entry) => entry[0] === "download"),
      ["download", "stats", 999n, 2, 0, 0],
    );
    await boards.upload({ ...input, score: 800 });
    assert.deepEqual(
      calls.find((entry) => entry[0] === "upload"),
      ["upload", "stats", 999n, 1, 800, null, 0],
    );
    assert.equal(
      calls.filter((entry) => entry[0] === "find").length,
      1,
      "Handles cached per board",
    );
  });
}

test("global and own-score reads use documented request enums and ranges", async () => {
  const { api, calls, dispatcher } = mockNative("win32");
  const boards = new SteamLeaderboards(api, dispatcher, "win32");
  const input = { scenarioId: 101, difficulty: "CEO", challengeId: "rules-a" };
  await boards.read({ ...input, scope: "global" });
  await boards.read({ ...input, scope: "player" });
  assert.deepEqual(
    calls.filter((entry) => entry[0] === "download"),
    [
      ["download", "stats", 999n, 0, 1, 100],
      ["download", "stats", 999n, 1, 0, 0],
    ],
  );
});

test("failed call results reject and do not fabricate successful score writes", async () => {
  const { api, dispatcher } = mockNative("win32");
  const boards = new SteamLeaderboards(api, dispatcher, "win32");
  api.result = () => false;
  await assert.rejects(
    boards.upload({
      scenarioId: 101,
      difficulty: "CEO",
      challengeId: "rules-a",
      score: 1,
    }),
    /failed/,
  );
  api.find = () => 0n;
  await assert.rejects(
    boards.read({
      scenarioId: 101,
      difficulty: "CEO",
      challengeId: "rules-a",
      scope: "global",
    }),
    /could not start/,
  );
});

test("rule and difficulty changes cannot mingle incompatible leaderboard scores", () => {
  const input = { scenarioId: 101, difficulty: "CEO", challengeId: "rules-a" };
  assert.notEqual(
    boardName(input),
    boardName({ ...input, challengeId: "rules-b" }),
  );
  assert.notEqual(
    boardName(input),
    boardName({ ...input, difficulty: "Intern" }),
  );
  assert.notEqual(boardName(input), boardName({ ...input, scoreVersion: 2 }));
  assert(boardName(input).length < 128);
});

test("yielded requests cannot use native pointers after SDK shutdown begins", async () => {
  const { api, calls, dispatcher } = mockNative("win32");
  let resume;
  const boards = new SteamLeaderboards(api, dispatcher, "win32");
  let completed = 0;
  dispatcher.callResult = () => {
    completed++;
    return new Promise((resolve) => {
      resume = () => resolve(Buffer.alloc(16));
    });
  };
  const request = boards.read({
    scenarioId: 101,
    difficulty: "CEO",
    challengeId: "rules-a",
    scope: "friends",
  });
  await new Promise((resolve) => setImmediate(resolve));
  boards.dispose();
  resume();
  await assert.rejects(request, /shutting down/);
  assert.equal(completed, 1);
  assert.equal(
    calls.some((entry) => entry[0] === "download"),
    false,
  );
});

for (const operation of ["read", "upload"]) {
  test(`shutdown after a cached handle resolves prevents native ${operation}`, async () => {
    const { api, calls, dispatcher } = mockNative("win32");
    const boards = new SteamLeaderboards(api, dispatcher, "win32");
    const input = {
      scenarioId: 101,
      difficulty: "CEO",
      challengeId: "rules-a",
      scope: "friends",
      score: 500,
    };
    boards.handles.set(boardName(input), 999n);
    const handle = boards.handle.bind(boards);
    boards.handle = async (selection) => {
      const cached = await handle(selection);
      // Quit can happen before the caller's awaited-handle continuation gets its turn.
      boards.dispose();
      return cached;
    };
    await assert.rejects(boards[operation](input), /shutting down/);
    assert.equal(
      calls.some((entry) => entry[0] === "download" || entry[0] === "upload"),
      false,
    );
  });
}

test("shutdown after download resolves prevents reading native entry and persona pointers", async () => {
  const { api, dispatcher } = mockNative("win32");
  const boards = new SteamLeaderboards(api, dispatcher, "win32");
  const callResult = boards.callResult.bind(boards);
  boards.callResult = async (handle, layout) => {
    const result = await callResult(handle, layout);
    if (layout.callback === 1105) boards.dispose();
    return result;
  };
  api.entry = () => assert.fail("Entry interface used after shutdown");
  api.persona = () => assert.fail("Friends interface used after shutdown");
  await assert.rejects(
    boards.read({
      scenarioId: 101,
      difficulty: "CEO",
      challengeId: "rules-a",
      scope: "friends",
    }),
    /shutting down/,
  );
});
