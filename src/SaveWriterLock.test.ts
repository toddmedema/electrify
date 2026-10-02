import { acquireSaveWriterLock } from "./SaveWriterLock";

const originalLocks = navigator.locks;
afterEach(() =>
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: originalLocks,
  }),
);

function installLocks() {
  const held = new Set<string>();
  const request = async <T>(
    name: string,
    _options: LockOptions,
    callback: (lock: Lock | null) => Promise<T>,
  ) => {
    if (held.has(name)) return callback(null);
    held.add(name);
    try {
      return await callback({ name, mode: "exclusive" } as Lock);
    } finally {
      held.delete(name);
    }
  };
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request },
  });
  return held;
}

test("a copied live writer token is rejected, but a fresh token remains independent", async () => {
  const held = installLocks();
  const original = await acquireSaveWriterLock("original-token");
  await expect(acquireSaveWriterLock("original-token")).rejects.toMatchObject({
    code: "conflict",
  });
  const fresh = await acquireSaveWriterLock("fresh-token");
  expect(held.size).toBe(2);
  await fresh.release();
  await original.release();
  expect(held.size).toBe(0);
});

test("release completes before a reload can reacquire the same token", async () => {
  installLocks();
  const original = await acquireSaveWriterLock("reload-token");
  await original.release();
  await original.release();
  const reloaded = await acquireSaveWriterLock("reload-token");
  await reloaded.release();
});

test("unsupported browsers continue to rely on IndexedDB leases", async () => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
  const lock = await acquireSaveWriterLock("fallback");
  await lock.release();
});
