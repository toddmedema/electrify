import catalog from "./AchievementCatalog.json";
import type { DifficultyType } from "../Types";

export { catalog };
export const TUTORIAL_IDS = [0, 1, 2, 4, 3, 5, 112];
export const OFFICIAL_IDS = catalog.flatMap((entry) =>
  entry.scenarioId !== undefined && entry.scenarioId >= 100
    ? [entry.scenarioId]
    : [],
);
const difficulties = ["Intern", "Employee", "Manager", "VP", "CEO"];
const ids = new Set(catalog.map(({ id }) => id));
const wins = new Set(
  OFFICIAL_IDS.flatMap((id) =>
    difficulties.map((difficulty) => `${id}:${difficulty}`),
  ),
);
export interface AchievementRecord {
  version: 1;
  earned: string[];
  tutorials: number[];
  wins: string[];
}
export interface AchievementIntent {
  earned: string[];
  completion?: { scenarioId: number; difficulty: DifficultyType };
}
export const emptyRecord = (): AchievementRecord => ({
  version: 1,
  earned: [],
  tutorials: [],
  wins: [],
});
const distinct = <T>(value: unknown, allowed: Set<T>): value is T[] =>
  Array.isArray(value) &&
  value.length <= allowed.size &&
  new Set(value).size === value.length &&
  value.every((item) => allowed.has(item));
export function validRecord(value: unknown): value is AchievementRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as AchievementRecord;
  return (
    Object.keys(record).every((key) =>
      ["version", "earned", "tutorials", "wins"].includes(key),
    ) &&
    record.version === 1 &&
    distinct(record.earned, ids) &&
    distinct(record.tutorials, new Set(TUTORIAL_IDS)) &&
    distinct(record.wins, wins)
  );
}
export function recordIntent(intent: AchievementIntent): AchievementRecord {
  if (!distinct(intent.earned, ids))
    throw new Error("Invalid achievement intent");
  const record = { ...emptyRecord(), earned: [...intent.earned] };
  const completion = intent.completion;
  if (completion) {
    if (!difficulties.includes(completion.difficulty))
      throw new Error("Invalid achievement difficulty");
    if (TUTORIAL_IDS.includes(completion.scenarioId))
      record.tutorials.push(completion.scenarioId);
    else if (OFFICIAL_IDS.includes(completion.scenarioId))
      record.wins.push(`${completion.scenarioId}:${completion.difficulty}`);
    else throw new Error("Invalid achievement scenario");
  }
  return mergeRecords(record);
}
/** Grow-only union: distinct completions on different devices cannot overwrite one another. */
export function mergeRecords(
  ...records: AchievementRecord[]
): AchievementRecord {
  if (records.some((record) => !validRecord(record)))
    throw new Error("Invalid achievement history");
  const earned = new Set(records.flatMap((record) => record.earned));
  const tutorials = new Set(records.flatMap((record) => record.tutorials));
  const completed = new Set(records.flatMap((record) => record.wins));
  if (tutorials.has(0)) earned.add("FIRST_SPARK");
  if (TUTORIAL_IDS.every((id) => tutorials.has(id)))
    earned.add("GRID_GRADUATE");
  for (const entry of catalog) {
    if (
      entry.scenarioId === undefined ||
      !OFFICIAL_IDS.includes(entry.scenarioId)
    )
      continue;
    if (
      difficulties.some((difficulty) =>
        completed.has(`${entry.scenarioId}:${difficulty}`),
      )
    ) {
      earned.add(entry.id);
      earned.add("STAYING_POWER");
    }
    if (completed.has(`${entry.scenarioId}:CEO`))
      earned.add("CHIEF_ELECTRICITY_OFFICER");
  }
  if (OFFICIAL_IDS.every((id) => completed.has(`${id}:CEO`)))
    earned.add("MASTER_OF_THE_GRID");
  return {
    version: 1,
    earned: catalog.map(({ id }) => id).filter((id) => earned.has(id)),
    tutorials: TUTORIAL_IDS.filter((id) => tutorials.has(id)),
    wins: [...wins].filter((win) => completed.has(win)),
  };
}
