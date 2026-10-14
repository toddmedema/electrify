import {
  catalog,
  emptyRecord,
  mergeRecords,
  OFFICIAL_IDS,
  recordIntent,
  TUTORIAL_IDS,
  validRecord,
} from "./Progress";

test("different devices combine tutorial and CEO completions into aggregate achievements", () => {
  const tutorialRecords = TUTORIAL_IDS.map((scenarioId) =>
    recordIntent({
      earned: [],
      completion: { scenarioId, difficulty: "Intern" },
    }),
  );
  expect(mergeRecords(...tutorialRecords).earned).toEqual([
    "FIRST_SPARK",
    "GRID_GRADUATE",
  ]);
  const records = OFFICIAL_IDS.map((scenarioId) =>
    recordIntent({ earned: [], completion: { scenarioId, difficulty: "CEO" } }),
  );
  const first = mergeRecords(...records.slice(0, 7));
  const second = mergeRecords(...records.slice(7));
  expect(first.earned).not.toContain("MASTER_OF_THE_GRID");
  expect(second.earned).not.toContain("MASTER_OF_THE_GRID");
  const combined = mergeRecords(first, second);
  expect(combined.earned).toContain("MASTER_OF_THE_GRID");
  expect(combined.earned).toContain("CHIEF_ELECTRICITY_OFFICER");
  expect(combined.earned).toContain("STAYING_POWER");
  expect(combined.wins).toHaveLength(14);
  expect(mergeRecords(second, first, combined)).toEqual(combined);
});

test("records reject unknown, duplicate, oversized and structurally invalid evidence", () => {
  expect(validRecord(emptyRecord())).toBe(true);
  for (const patch of [
    { earned: ["INVALID"] },
    { earned: [catalog[0].id, catalog[0].id] },
    { earned: Array(100).fill(catalog[0].id) },
    { tutorials: [113] },
    { wins: ["101:Invalid"] },
    { wins: ["0:CEO"] },
    { version: 2 },
    { extra: true },
    { earned: undefined },
  ])
    expect(validRecord({ ...emptyRecord(), ...patch })).toBe(false);
  expect(() =>
    recordIntent({
      earned: [],
      completion: { scenarioId: 999, difficulty: "CEO" },
    }),
  ).toThrow();
  expect(() =>
    mergeRecords({ ...emptyRecord(), earned: ["INVALID"] }),
  ).toThrow();
});
