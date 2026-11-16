import type * as Diagnostics from "./FirestoreReads";

function load(search: string): typeof Diagnostics {
  window.history.replaceState({}, "", `/${search}`);
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

it.each(["", "?firestoreReads=0"])(
  "leaves diagnostics disabled with flag %s and preserves results and errors",
  async (flag) => {
    const { measureFirestoreRead, recordFirestoreRead } = load(flag);
    const result = { uid: "private", payload: "private save" };
    const documents = jest.fn(() => 1);
    expect(
      await measureFirestoreRead("profile.load", async () => result, documents),
    ).toBe(result);
    const failure = new Error("sensitive error details");
    await expect(
      measureFirestoreRead("profile.load", () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    recordFirestoreRead("save.listener", "starts");
    expect(documents).not.toHaveBeenCalled();
    expect(window.electrifyFirestoreReads).toBeUndefined();
  },
);

it("records only fixed source counters, including failed attempts and listener deliveries", async () => {
  const { measureFirestoreRead, recordFirestoreRead } =
    load("?firestoreReads=1");
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
