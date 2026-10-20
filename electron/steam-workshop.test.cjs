const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SteamWorkshop, itemId } = require("./steam-workshop.cjs");
for (const platform of ["win32", "linux", "darwin"])
  test(`Workshop callback packing and public upload on ${platform}`, async () => {
    const calls = [];
    const steam = {
      state: () => ({ online: true }),
      dispatcher: {
        callResult: async (handle, layout) => {
          calls.push(layout);
          const b = Buffer.alloc(layout.size);
          b.writeInt32LE(1);
          if (layout.callback === 3403) {
            b.writeBigUInt64LE(123n, platform === "win32" ? 8 : 4);
            b[platform === "win32" ? 16 : 12] = 1;
          }
          return b;
        },
      },
    };
    const api = {
      ugc: () => 1,
      create: () => 2n,
      start: () => 3n,
      title: () => true,
      content: () => true,
      visibility: (_ugc, _handle, value) => {
        assert.equal(value, 0);
        return true;
      },
      submit: () => 4n,
      subscribe: () => 5n,
      unsubscribe: () => 6n,
    };
    const workshop = new SteamWorkshop(steam, 480, api, platform);
    assert.deepEqual(await workshop.create(), { id: "123", agreement: true });
    await workshop.publish(
      "123",
      { title: "Test", version: "1" },
      "/tmp/stage",
    );
    await workshop.subscription("123", true);
    await workshop.subscription("123", false);
    assert.deepEqual(
      calls.map((c) => c.callback),
      [3403, 3404, 1313, 1315],
    );
    assert.deepEqual(
      calls.map((c) => c.size),
      platform === "win32" ? [24, 16, 16, 16] : [16, 16, 12, 12],
    );
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
  assert.equal(workshop.installed("123"), null);
  assert.equal(downloaded, true);
});
