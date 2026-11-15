import type * as Diagnostics from "./FirestoreReads";

function load(enabled: boolean): typeof Diagnostics {
  window.history.replaceState({}, "", enabled ? "/?firestoreReads=1" : "/");
  delete window.electrifyFirestoreReads;
  let diagnostics!: typeof Diagnostics;
  jest.isolateModules(() => {
    diagnostics = require("./FirestoreReads");
  });
  return diagnostics;
}
afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.electrifyFirestoreReads;
});

it("leaves diagnostics disabled during normal play and preserves results", async () => {
  const { measureFirestoreRead } = load(false);
  const result = { uid: "private", payload: "private save" };
  expect(await measureFirestoreRead("profile.load", async () => result)).toBe(
    result,
  );
  expect(window.electrifyFirestoreReads).toBeUndefined();
});

it("records only fixed source counters, including failed attempts and listener deliveries", async () => {
  const { measureFirestoreRead, recordFirestoreRead } = load(true);
  const result = { docs: [{ uid: "private", payload: "private save" }] };
  expect(
    await measureFirestoreRead(
      "leaderboard.rows",
      async () => result,
      (r) => r.docs.length,
    ),
  ).toBe(result);
  const failure = new Error("sensitive error details");
  await expect(
    measureFirestoreRead("profile.load", () => Promise.reject(failure)),
  ).rejects.toBe(failure);
  recordFirestoreRead("save.listener", "starts");
  recordFirestoreRead("save.listener", "snapshots");
  recordFirestoreRead("save.listener", "documents", 3);
  const api = window.electrifyFirestoreReads!;
  const snapshot = api.snapshot();
  expect(snapshot).toEqual({
    "leaderboard.rows": {
      requests: 1,
      failures: 0,
      documents: 1,
      starts: 0,
      snapshots: 0,
    },
    "profile.load": {
      requests: 1,
      failures: 1,
      documents: 0,
      starts: 0,
      snapshots: 0,
    },
    "save.listener": {
      requests: 0,
      failures: 0,
      documents: 3,
      starts: 1,
      snapshots: 1,
    },
  });
  expect(JSON.stringify(snapshot)).not.toMatch(/private|sensitive|uid|payload/);
  snapshot["leaderboard.rows"]!.requests = 100;
  expect(api.snapshot()["leaderboard.rows"]!.requests).toBe(1);
  api.reset();
  expect(api.snapshot()).toEqual({});
});
