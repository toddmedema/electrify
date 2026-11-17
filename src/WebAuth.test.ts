import type { Auth, User } from "firebase/auth";
import "fake-indexeddb/auto";
import { deferredWebAuth, hasStoredWebAccount } from "./WebAuth";

beforeAll(() => {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it("keeps new visitors anonymous without constructing Auth, then wires consumers once on sign-in", () => {
  const stop = jest.fn();
  const subscribe = jest.fn().mockReturnValue(stop);
  const user = { uid: "player" } as User;
  const create = jest.fn(
    () =>
      ({ currentUser: user, onAuthStateChanged: subscribe }) as unknown as Auth,
  );
  const deferred = deferredWebAuth(create);
  const next = jest.fn();
  const unsubscribe = deferred.onAuthStateChanged(next);
  const abandoned = jest.fn();
  deferred.onAuthStateChanged(abandoned)();
  expect(deferred.currentUser).toBeNull();
  expect(create).not.toHaveBeenCalled();
  expect(deferred.initialize()).toBe(deferred.initialize());
  expect(create).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledTimes(1);
  subscribe.mock.calls[0][0](user);
  expect(next).toHaveBeenCalledWith(user);
  expect(abandoned).not.toHaveBeenCalled();
  expect(deferred.currentUser).toBe(user);
  unsubscribe();
  expect(stop).toHaveBeenCalledTimes(1);
});

it("recognizes local and session accounts but ignores signed-out persistence", async () => {
  expect(await hasStoredWebAccount()).toBe(false);
  localStorage.setItem("firebase:authUser:key:[DEFAULT]", "null");
  expect(await hasStoredWebAccount()).toBe(false);
  sessionStorage.setItem("firebase:authUser:key:[DEFAULT]", '{"uid":"player"}');
  expect(await hasStoredWebAccount()).toBe(true);
  sessionStorage.clear();
  localStorage.setItem("firebase:authUser:key:[DEFAULT]", '{"uid":"player"}');
  expect(await hasStoredWebAccount()).toBe(true);
});

it("restores existing Firebase IndexedDB accounts", async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("firebaseLocalStorageDb", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("firebaseLocalStorage", {
        keyPath: "fbase_key",
      });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve) => {
    const transaction = db.transaction("firebaseLocalStorage", "readwrite");
    transaction.objectStore("firebaseLocalStorage").put({
      fbase_key: "firebase:authUser:key:[DEFAULT]",
      value: { uid: "player" },
    });
    transaction.oncomplete = () => resolve();
  });
  db.close();
  expect(await hasStoredWebAccount()).toBe(true);
});

it("reports a confirmed anonymous session to early and late subscribers without starting Auth", async () => {
  const create = jest.fn();
  const deferred = deferredWebAuth(create);
  const early = jest.fn();
  deferred.onAuthStateChanged(early);
  deferred.confirmSignedOut();
  expect(early).toHaveBeenCalledWith(null);
  const late = jest.fn();
  deferred.onAuthStateChanged(late);
  await Promise.resolve();
  expect(late).toHaveBeenCalledWith(null);
  deferred.confirmSignedOut();
  expect(early).toHaveBeenCalledTimes(1);
  expect(create).not.toHaveBeenCalled();
});
