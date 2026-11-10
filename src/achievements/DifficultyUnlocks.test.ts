import { DIFFICULTY_IDS } from "../Constants";
import {
  difficultyLockReason,
  playableDifficulty,
  unlockedDifficulty,
} from "./DifficultyUnlocks";
import { emptyRecord, mergeRecords, recordIntent } from "./Progress";

it("starts with Beginner and ignores tutorial awards", () => {
  expect(unlockedDifficulty(emptyRecord())).toBe("Intern");
  expect(
    unlockedDifficulty(
      recordIntent({
        earned: [],
        completion: { scenarioId: 0, difficulty: "Intern" },
      }),
    ),
  ).toBe("Intern");
});

it("unlocks one rung per difficulty, across different scenarios and existing history", () => {
  let progress = emptyRecord();
  for (const [index, difficulty] of DIFFICULTY_IDS.entries()) {
    progress = mergeRecords(
      progress,
      recordIntent({
        earned: [],
        completion: { scenarioId: index % 2 ? 101 : 100, difficulty },
      }),
    );
    const next = DIFFICULTY_IDS[Math.min(index + 1, DIFFICULTY_IDS.length - 1)];
    expect(unlockedDifficulty(progress)).toBe(next);
    expect(playableDifficulty(next, unlockedDifficulty(progress))).toBe(next);
  }
});

it("does not skip missing rungs or advance for repeated wins at the same difficulty", () => {
  const higher = recordIntent({
    earned: [],
    completion: { scenarioId: 100, difficulty: "VP" },
  });
  expect(unlockedDifficulty(higher)).toBe("Intern");
  const beginner = recordIntent({
    earned: [],
    completion: { scenarioId: 101, difficulty: "Intern" },
  });
  expect(unlockedDifficulty(mergeRecords(higher, beginner, beginner))).toBe(
    "Employee",
  );
  expect(playableDifficulty("CEO", "Employee")).toBe("Employee");
  expect(playableDifficulty("Intern", "Employee")).toBe("Intern");
});

it("explains the preceding rung for every locked level", () => {
  expect(difficultyLockReason("Intern", "Intern")).toBeUndefined();
  expect(difficultyLockReason("Employee", "Intern")).toBe(
    "Complete a scenario on Beginner to unlock Easy.",
  );
  expect(difficultyLockReason("CEO", "Intern")).toBe(
    "Complete a scenario on Hard to unlock Expert.",
  );
  expect(difficultyLockReason("CEO", "CEO")).toBeUndefined();
});
