import "fake-indexeddb/auto";
import { deserialize, serialize } from "node:v8";
import { browserCheckpoints } from "./BrowserCheckpoints";
import type { World } from "./Types";

if (typeof structuredClone === "undefined") {
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    value: (value: unknown) => deserialize(serialize(value)),
  });
}

let next = 0;
function checkpoint(): World {
  return {
    matchId: `browser-match-${++next}`,
    epoch: "original",
    revision: 1,
    spec: { scenarioId: 106, difficulty: "Employee" },
    seats: [
      { id: "host", name: "Host" },
      { id: "guest", name: "Guest" },
    ],
    schema: 3,
  } as World;
}

test("browser saves keep their checkpoint across storage instances and remove its listing with it", async () => {
  const world = checkpoint();
  await browserCheckpoints().write(world);
  const afterReload = browserCheckpoints();
  expect((await afterReload.list(false)).slots).toContainEqual(
    expect.objectContaining({ id: world.matchId, players: ["Host", "Guest"] }),
  );
  expect(await afterReload.read(world.matchId)).toEqual(world);
  expect((await afterReload.remove(world.matchId)).slots).not.toContainEqual(
    expect.objectContaining({ id: world.matchId }),
  );
  expect(await afterReload.read(world.matchId)).toBeNull();
});

test("a stale continuation cannot overwrite a newer revision of its source epoch", async () => {
  const host = browserCheckpoints();
  const resuming = browserCheckpoints();
  const original = checkpoint();
  await host.write(original);
  const source = (await resuming.read(original.matchId))!;
  const newer = { ...original, revision: 2 };
  await host.write(newer);

  const continuation = { ...source, epoch: "continued", revision: 3 };
  await expect(resuming.write(continuation, source)).rejects.toThrow(
    /newer save/,
  );
  const refreshed = (await resuming.read(original.matchId))!;
  expect(refreshed).toEqual(newer);
  const restarted = { ...refreshed, epoch: "restarted", revision: 3 };
  await resuming.write(restarted, refreshed);
  expect(await host.read(original.matchId)).toEqual(restarted);
});

test("reading another epoch cannot authorize a running continuation to replace it", async () => {
  const one = browserCheckpoints();
  const two = browserCheckpoints();
  const original = checkpoint();
  await one.write(original);
  const [sourceA, sourceB] = await Promise.all([
    one.read(original.matchId),
    two.read(original.matchId),
  ]);
  const first = { ...original, epoch: "continued-a", revision: 2 };
  await one.write(first, sourceA!);
  const second = { ...original, epoch: "continued-b", revision: 2 };
  await expect(two.write(second, sourceB!)).rejects.toThrow(/newer save/);
  const refreshed = (await two.read(original.matchId))!;
  expect(refreshed).toEqual(first);
  await expect(two.write(second, sourceB!)).rejects.toThrow(/newer save/);

  await one.write({ ...first, revision: 1 });
  expect(await two.read(original.matchId)).toEqual(first);
  const restarted = { ...refreshed, epoch: "restarted", revision: 3 };
  await two.write(restarted, refreshed);
  expect(await one.read(original.matchId)).toEqual(restarted);
});

test("retention keeps a newly saved campaign after the system clock goes back", async () => {
  const storage = browserCheckpoints();
  const start = Date.now() + 1000;
  const now = jest.spyOn(Date, "now");
  try {
    const oldest = checkpoint();
    now.mockReturnValue(start);
    await storage.write(oldest);
    for (let index = 1; index < 32; index++) {
      now.mockReturnValue(start + index);
      await storage.write(checkpoint());
    }

    const newSave = checkpoint();
    now.mockReturnValue(start - 1000);
    await storage.write(newSave);
    const { slots } = await storage.list(false);
    expect(slots).toHaveLength(32);
    expect(slots.map(({ id }) => id)).toContain(newSave.matchId);
    expect(slots.map(({ id }) => id)).not.toContain(oldest.matchId);
    expect(await storage.read(newSave.matchId)).toEqual(newSave);
    expect(await storage.read(oldest.matchId)).toBeNull();
  } finally {
    now.mockRestore();
  }
});
