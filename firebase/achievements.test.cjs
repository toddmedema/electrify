const { after, before, beforeEach, test } = require("node:test");
const { readFileSync } = require("node:fs");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  setLogLevel,
} = require("firebase/firestore");
setLogLevel("silent");
const catalog = require("../src/achievements/AchievementCatalog.json");
let environment;
const empty = () => ({ version: 1, earned: [], tutorials: [], wins: [] });
const progress = () => ({
  ...empty(),
  earned: ["FIRST_SPARK"],
  tutorials: [0],
});
const ref = (uid = "alice", owner = uid, id = "current") =>
  doc(
    (uid
      ? environment.authenticatedContext(uid)
      : environment.unauthenticatedContext()
    ).firestore(),
    "users",
    owner,
    "achievementProgress",
    id,
  );
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-electrify-achievements",
    firestore: {
      rules: readFileSync("firebase/firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 9383,
    },
  });
});
beforeEach(async () => environment.clearFirestore());
after(async () => environment?.cleanup());

test("only the signed-in owner can read or write private achievement history", async () => {
  await assertSucceeds(setDoc(ref(), progress()));
  await assertSucceeds(getDoc(ref()));
  await assertFails(getDoc(ref("bob", "alice")));
  await assertFails(getDoc(ref(null, "alice")));
  await assertFails(setDoc(ref("bob", "alice"), progress()));
  await assertFails(setDoc(ref(null, "alice"), progress()));
  await assertFails(deleteDoc(ref()));
  await assertFails(
    getDocs(
      collection(
        environment.authenticatedContext("alice").firestore(),
        "users",
        "alice",
        "achievementProgress",
      ),
    ),
  );
  await assertFails(setDoc(ref("alice", "alice", "other"), progress()));
});

test("the catalog, tutorial and scenario difficulty lists accept the full bounded history", async () => {
  const tutorials = [0, 1, 2, 4, 3, 5, 112];
  const wins = catalog
    .filter((entry) => entry.scenarioId >= 100)
    .flatMap(({ scenarioId }) =>
      ["Intern", "Employee", "Manager", "VP", "CEO"].map(
        (difficulty) => `${scenarioId}:${difficulty}`,
      ),
    );
  await assertSucceeds(
    setDoc(ref(), {
      version: 1,
      earned: catalog.map(({ id }) => id),
      tutorials,
      wins,
    }),
  );
});

test("malformed and oversized records are rejected", async () => {
  for (const patch of [
    { version: 2 },
    { earned: ["UNKNOWN"] },
    { earned: ["FIRST_SPARK", "FIRST_SPARK"] },
    { earned: Array(36).fill("FIRST_SPARK") },
    { tutorials: [113] },
    { tutorials: [0, 0] },
    { wins: ["101:Unknown"] },
    { wins: ["0:CEO"] },
    { wins: ["101:CEO", "101:CEO"] },
    { extra: true },
    { tutorials: "0" },
    { version: "1" },
  ])
    await assertFails(setDoc(ref(), { ...empty(), ...patch }));
  await assertFails(setDoc(ref(), { version: 1, earned: [] }));
});

test("updates can union new awards but cannot erase any earned evidence", async () => {
  await assertSucceeds(setDoc(ref(), { ...progress(), wins: ["101:Intern"] }));
  await assertFails(setDoc(ref(), { ...empty(), wins: ["101:Intern"] }));
  await assertFails(setDoc(ref(), progress()));
  await assertFails(
    setDoc(ref(), { ...progress(), tutorials: [], wins: ["101:Intern"] }),
  );
  await assertSucceeds(
    setDoc(ref(), {
      ...progress(),
      earned: ["FIRST_SPARK", "OUT_OF_JUICE"],
      tutorials: [0, 1],
      wins: ["101:Intern", "102:CEO"],
    }),
  );
});

test("current competitive scores require completion and the three numeric categories", async () => {
  const db = environment.authenticatedContext("alice").firestore();
  const score = {
    uid: "alice",
    scenarioId: 101,
    difficulty: "CEO",
    scoreVersion: 2,
    outcome: "completed",
    score: 95,
    scoreBreakdown: { service: 80, financial: 20, environmental: -5 },
  };
  await assertSucceeds(setDoc(doc(db, "scores", "completed"), score));
  for (const [index, patch] of [
    { extra: "unsupported metadata" },
    { outcome: "bankrupt" },
    { outcome: "fired" },
    { outcome: null },
    { scoreVersion: 3 },
    { scoreVersion: "2" },
    { score: "95" },
    { scoreBreakdown: { service: 80, financial: 20 } },
    { scoreBreakdown: { ...score.scoreBreakdown, customers: 3 } },
    { scoreBreakdown: { ...score.scoreBreakdown, financial: "20" } },
  ].entries())
    await assertFails(
      setDoc(doc(db, "scores", `invalid-${index}`), { ...score, ...patch }),
    );
  await assertFails(
    setDoc(doc(db, "scores", "no-outcome"), {
      uid: "alice",
      scoreVersion: 2,
      score: 95,
      scoreBreakdown: score.scoreBreakdown,
    }),
  );
  // Old clients keep their archived formula; the current board filters these rows out.
  await assertSucceeds(
    setDoc(doc(db, "scores", "legacy"), { uid: "alice", score: 100 }),
  );
});

test("unconfigured collections reject reads and writes", async () => {
  for (const context of [
    environment.authenticatedContext("alice"),
    environment.unauthenticatedContext(),
  ]) {
    const unsupported = doc(context.firestore(), "unsupported", "record");
    await assertFails(getDoc(unsupported));
    await assertFails(setDoc(unsupported, { uid: "alice" }));
    await assertFails(deleteDoc(unsupported));
  }
});
