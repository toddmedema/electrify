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

test("resuming and writing in two tabs cannot overwrite the first resumed checkpoint", async () => {
  const one = browserCheckpoints();
  const two = browserCheckpoints();
  const original = checkpoint();
  await one.write(original);
  await Promise.all([one.read(original.matchId), two.read(original.matchId)]);
  const first = { ...original, epoch: "continued-a", revision: 2 };
  await one.write(first);
  await expect(
    two.write({ ...original, epoch: "continued-b", revision: 2 }),
  ).rejects.toThrow(/newer save/);
  await one.write({ ...first, revision: 1 });
  expect(await two.read(original.matchId)).toEqual(first);
});
