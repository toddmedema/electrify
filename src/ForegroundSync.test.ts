import { ForegroundSync } from "./ForegroundSync";
const valid = (value: unknown): value is { id: string } =>
  !!value &&
  typeof value === "object" &&
  "id" in value &&
  typeof value.id === "string";
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});
afterEach(() => {
  jest.useRealTimers();
});
it("keeps one foreground lease owner without Web Locks or BroadcastChannel and takes over after disposal", async () => {
  const ownedA = jest.fn(),
    ownedB = jest.fn(),
    signal = jest.fn();
  const a = new ForegroundSync<{ id: string }>("test", ownedA, signal, valid);
  const b = new ForegroundSync<{ id: string }>("test", ownedB, signal, valid);
  a.setAccount("alice");
  b.setAccount("alice");
  await flush();
  expect([a.isOwner(), b.isOwner()]).toEqual([true, false]);
  b.request({ id: "manual" });
  expect([...a.pending().values()]).toEqual([{ id: "manual" }]);
  a.acknowledge(a.pending().keys());
  expect(b.pending().size).toBe(0);
  b.request({ id: "survives-owner" });
  a.stop();
  jest.advanceTimersByTime(8_000);
  await flush();
  expect(b.isOwner()).toBe(true);
  expect([...b.pending().values()]).toEqual([{ id: "survives-owner" }]);
  b.setAccount("bob");
  await flush();
  expect(b.pending().size).toBe(0);
  b.stop();
});
it("releases foreground ownership while hidden and retains manual intent for resumption", async () => {
  const changed = jest.fn();
  const owner = new ForegroundSync<{ id: string }>(
    "test",
    changed,
    () => {},
    valid,
  );
  owner.setAccount("alice");
  await flush();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(owner.isOwner()).toBe(false);
  owner.request({ id: "hidden" });
  await flush();
  expect(changed).toHaveBeenLastCalledWith(false);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(owner.isOwner()).toBe(true);
  expect([...owner.pending().values()]).toEqual([{ id: "hidden" }]);
  owner.stop();
});
it("holds a Web Lock for the tenure so followers do not run serialized duplicate syncs", async () => {
  const held = new Set<string>();
  const request = jest.fn(
    async (
      name: string,
      _options: unknown,
      callback: (lock: unknown) => Promise<void>,
    ) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      await callback({});
      held.delete(name);
    },
  );
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request },
  });
  const a = new ForegroundSync("test", jest.fn(), jest.fn(), valid);
  const b = new ForegroundSync("test", jest.fn(), jest.fn(), valid);
  a.setAccount("alice");
  b.setAccount("alice");
  await flush();
  jest.advanceTimersByTime(24_000);
  await flush();
  expect(a.isOwner()).toBe(true);
  expect(b.isOwner()).toBe(false);
  a.stop();
  await flush();
  jest.advanceTimersByTime(8_000);
  await flush();
  expect(b.isOwner()).toBe(true);
  b.stop();
  await flush();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
});

it("ignores malformed queued values without skipping a neighboring manual request", async () => {
  const owner = new ForegroundSync("test", jest.fn(), jest.fn(), valid);
  owner.setAccount("alice");
  await flush();
  localStorage.setItem("electrify-sync:test:alice:request:bad", "null");
  localStorage.setItem(
    "electrify-sync:test:alice:request:good",
    JSON.stringify({ id: "manual" }),
  );
  expect([...owner.pending().values()]).toEqual([{ id: "manual" }]);
  owner.stop();
});
it("keeps local foreground sync and manual intent usable if storage is disabled", async () => {
  const read = jest
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("disabled");
    });
  const write = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("disabled");
    });
  const owner = new ForegroundSync("test", jest.fn(), jest.fn(), valid);
  owner.setAccount("alice");
  await flush();
  expect(owner.isOwner()).toBe(true);
  owner.request({ id: "manual" });
  expect([...owner.pending().values()]).toEqual([{ id: "manual" }]);
  owner.stop();
  read.mockRestore();
  write.mockRestore();
});
