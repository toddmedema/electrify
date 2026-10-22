const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SteamWorkshop,
  itemId,
  INVALID_UPDATE_HANDLE,
} = require("./steam-workshop.cjs");
function fakeApi(overrides = {}) {
  const visibility = [];
  return {
    visibility,
    api: {
      ugc: () => 1,
      create: () => 2n,
      start: () => 3n,
      title: () => true,
      content: () => true,
      visibility: (_ugc, _handle, value) => {
        visibility.push(value);
        return true;
      },
      submit: () => 4n,
      subscribe: () => 5n,
      unsubscribe: () => 6n,
      ...overrides,
    },
  };
}
const online = (callResult) => ({
  state: () => ({ online: true }),
  dispatcher: { callResult },
});
for (const platform of ["win32", "linux", "darwin"])
  test(`Workshop callback packing and first public upload on ${platform}`, async () => {
    const calls = [];
    const steam = online(async (handle, layout, options) => {
      calls.push({ ...layout, ...options });
      const b = Buffer.alloc(layout.size);
      b.writeInt32LE(1);
      if (layout.callback === 3403) {
        b.writeBigUInt64LE(123n, platform === "win32" ? 8 : 4);
        b[platform === "win32" ? 16 : 12] = 1;
      }
      // The legal-agreement flag follows the 4-byte EResult in SubmitItemUpdateResult_t.
      if (layout.callback === 3404) b[4] = 1;
      return b;
    });
    const { api, visibility } = fakeApi();
    const workshop = new SteamWorkshop(steam, 480, api, platform);
    assert.deepEqual(await workshop.create(), { id: "123", agreement: true });
    assert.deepEqual(
      await workshop.publish(
        "123",
        { title: "Test", version: "1", description: "A community scenario." },
        "/tmp/stage",
        { setVisibility: true },
      ),
      { id: "123", agreement: true },
    );
    await workshop.publish(
      "123",
      {
        title: "Test",
        version: "2",
        description: "An updated community scenario.",
      },
      "/tmp/stage",
    );
    // Public only on the first upload; later updates keep the creator's Steam setting.
    assert.deepEqual(visibility, [0]);
    await workshop.subscription("123", true);
    await workshop.subscription("123", false);
    assert.deepEqual(
      calls.map((c) => c.callback),
      [3403, 3404, 3404, 1313, 1315],
    );
    assert.deepEqual(
      calls.map((c) => c.size),
      platform === "win32" ? [24, 16, 16, 16, 16] : [16, 16, 16, 12, 12],
    );
    assert.deepEqual(
      calls.map((c) => c.timeoutMs),
      [120000, 600000, 600000, undefined, undefined],
    );
  });

test("Steam result codes become player-facing messages without raw numbers", async () => {
  const steam = online(async (_handle, layout) => {
    const b = Buffer.alloc(layout.size);
    b.writeInt32LE(layout.callback === 1313 ? 15 : 9999);
    return b;
  });
  const workshop = new SteamWorkshop(steam, 480, fakeApi().api);
  await assert.rejects(
    workshop.subscription("123", true),
    /^Error: Steam denied access\. You can only update Workshop items you own\.$/,
  );
  await assert.rejects(workshop.subscription("123", false), (error) => {
    assert.equal(
      error.message,
      "Steam Workshop couldn't complete the request. Try again later.",
    );
    return true;
  });
});

test("a create timeout tells the player to check Steam before retrying", async () => {
  const steam = online(async () => {
    throw new Error("Steam request timed out");
  });
  const workshop = new SteamWorkshop(steam, 480, fakeApi().api);
  await assert.rejects(
    workshop.create(),
    /Check your Workshop items on Steam before publishing again/,
  );
});

test("an invalid update handle never starts an upload", async () => {
  for (const handle of [0n, INVALID_UPDATE_HANDLE]) {
    const workshop = new SteamWorkshop(
      online(() => assert.fail("must not submit")),
      480,
      fakeApi({ start: () => handle }).api,
    );
    await assert.rejects(
      workshop.publish(
        "123",
        { title: "T", version: "1", description: "A community scenario." },
        "/tmp/stage",
      ),
      /could not start/,
    );
  }
});

test("Workshop IDs reject path strings, truncation and uint64 overflow", () => {
  assert.equal(itemId("123"), 123n);
  for (const value of ["0", "../file", "1.5", "18446744073709551616", 123])
    assert.throws(() => itemId(value));
});

test("download in progress never exposes partially written content", () => {
  let downloaded = false;
  const steam = {
    client: {
      workshop: {
        state: () => 4 | 16,
        download: () => {
          downloaded = true;
        },
        installInfo: () => {
          throw new Error("must not read");
        },
      },
    },
  };
  const workshop = new SteamWorkshop(steam, 480, { ugc: () => 1 });
  assert.equal(workshop.installedOrQueueDownload("123"), null);
  assert.equal(downloaded, true);
});
