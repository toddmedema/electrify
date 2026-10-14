import { doc, runTransaction } from "firebase/firestore";
import { FirebaseAchievementTransport } from "./FirebaseTransport";
import { emptyRecord, recordIntent } from "./Progress";
jest.mock("../Globals", () => ({ getDb: () => ({}) }));
jest.mock("firebase/firestore", () => ({
  doc: jest.fn((_db, ...parts: string[]) => parts.join("/")),
  runTransaction: jest.fn(),
}));

function transaction(remote: unknown) {
  return {
    get: jest.fn(async () => ({ exists: () => !!remote, data: () => remote })),
    set: jest.fn(),
  };
}
beforeEach(() => {
  (doc as jest.Mock).mockImplementation((_db, ...parts: string[]) =>
    parts.join("/"),
  );
});
test("transaction retries merge against the newest remote history rather than replacing it", async () => {
  const otherDevice = recordIntent({ earned: ["LIGHTS_ON"] });
  const first = transaction(undefined);
  const retry = transaction(otherDevice);
  (runTransaction as jest.Mock).mockImplementation(async (_db, callback) => {
    await callback(first);
    return callback(retry);
  });
  const local = recordIntent({ earned: ["OUT_OF_JUICE"] });
  const result = await new FirebaseAchievementTransport().merge(
    "alice",
    local,
    () => true,
  );
  expect(result.earned).toEqual(["LIGHTS_ON", "OUT_OF_JUICE"]);
  expect(retry.set).toHaveBeenCalledWith(
    "users/alice/achievementProgress/current",
    result,
  );
});
test("changed accounts and malformed cloud data never produce a write", async () => {
  for (const [remote, current] of [
    [undefined, false],
    [{ invalid: true }, true],
  ] as const) {
    const tx = transaction(remote);
    (runTransaction as jest.Mock).mockImplementation(async (_db, callback) =>
      callback(tx),
    );
    await expect(
      new FirebaseAchievementTransport().merge(
        "alice",
        emptyRecord(),
        () => current,
      ),
    ).rejects.toThrow();
    expect(tx.set).not.toHaveBeenCalled();
  }
});
