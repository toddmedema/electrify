import type {
  GameType,
  SaveFileType,
  SaveGameType,
  SaveMetadata,
  SavedRunResult,
  SaveStatus,
  VictoryType,
} from "./Types";

export type SaveErrorCode =
  "quota" | "unavailable" | "invalid" | "missing" | "conflict";

export class SaveRepositoryError extends Error {
  constructor(
    public readonly code: SaveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SaveRepositoryError";
  }
}

export const SAVE_NAME_LIMIT = 60;

// Deliberately reject C0/C1 controls and Unicode line separators in player-visible names.
// eslint-disable-next-line no-control-regex
const INVALID_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** Names count Unicode code points, so an emoji is not accidentally charged two characters. */
export function normalizeSaveName(input: string): string {
  const name = input.trim();
  if (!name || INVALID_NAME_CHARACTERS.test(input)) {
    throw new SaveRepositoryError(
      "invalid",
      "Enter a name without line breaks or control characters.",
    );
  }
  if (Array.from(name).length > SAVE_NAME_LIMIT) {
    throw new SaveRepositoryError(
      "invalid",
      `Use ${SAVE_NAME_LIMIT} characters or fewer.`,
    );
  }
  return name;
}

export function suggestedSaveName(
  scenario: string,
  location: string,
  existingNames: string[],
): string {
  const clean = `${scenario} — ${location}`
    .replace(new RegExp(INVALID_NAME_CHARACTERS.source, "g"), " ")
    .trim();
  const base = Array.from(clean || "New game")
    .slice(0, SAVE_NAME_LIMIT)
    .join("")
    .trim();
  const names = new Set(existingNames);
  if (!names.has(base)) return base;
  let suffix = 2;
  while (true) {
    const tail = ` (${suffix})`;
    const candidate = `${Array.from(base)
      .slice(0, SAVE_NAME_LIMIT - tail.length)
      .join("")}${tail}`;
    if (!names.has(candidate)) return candidate;
    suffix += 1;
  }
}

export function isResumableStatus(status: SaveStatus): boolean {
  return status === "inProgress" || status === "completed";
}

/** Autosave and rename do not change list order or the Continue target. */
export function sortSaves(entries: SaveMetadata[]): SaveMetadata[] {
  return [...entries].sort((left, right) => {
    const leftTime = left.lastPlayedAt || left.createdAt;
    const rightTime = right.lastPlayedAt || right.createdAt;
    return rightTime.localeCompare(leftTime) || left.id.localeCompare(right.id);
  });
}

export function selectContinueSave(
  entries: SaveMetadata[],
): SaveMetadata | undefined {
  const resumable = entries.filter((entry) => isResumableStatus(entry.status));
  const played = resumable.filter((entry) => entry.lastPlayedAt);
  return sortSaves(played.length ? played : resumable)[0];
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown, limit = 10000): value is string {
  return typeof value === "string" && value.length <= limit;
}

const difficulties = new Set(["Intern", "Employee", "Manager", "VP", "CEO"]);
const outcomes = new Set(["completed", "bankrupt", "fired"]);
const categories = new Set([
  "supply",
  "netWorth",
  "customers",
  "rate",
  "emissions",
  "blackouts",
]);
const fuels = new Set([
  "Coal",
  "Biomass",
  "Wind",
  "Offshore Wind",
  "Airborne Wind",
  "Sun",
  "Natural Gas",
  "Uranium",
  "Oil",
  "Geothermal",
  "Hydro",
]);
const concepts = new Set([
  "money",
  "supply",
  "demand",
  "blackout",
  "customers",
  "generator",
  "storage",
  "build",
  "buy",
  "reorder",
  "pause",
  "play",
  "time",
  "construction",
  "finances",
  "forecast",
  "rate",
  "fuel",
  "weather",
  "severeWeather",
  "danger",
  "goal",
]);
const eventKinds = new Set([
  "BLACKOUT",
  "BLACKOUT_OVER",
  "CONSTRUCTION",
  "BUILD",
  "SELL",
  "LOAN",
  "FUEL_PRICE",
  "FUEL_CROSSOVER",
  "WORLD_EVENT",
]);
const importance = new Set(["ROUTINE", "NOTABLE", "CRITICAL"]);

function validFleet(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 1000 &&
    value.every(
      (entry) =>
        object(entry) &&
        fuels.has(entry.fuel as string) &&
        finite(entry.watts) &&
        entry.watts >= 0,
    )
  );
}

/** Checks and selects presentation fields rather than retaining arbitrary imported properties. */
export function parseSavedRunResult(raw: unknown): SavedRunResult | null {
  if (
    !object(raw) ||
    !Number.isSafeInteger(raw.scenarioId) ||
    !text(raw.scenarioName, 1000) ||
    !difficulties.has(raw.difficulty as string) ||
    !finite(raw.score) ||
    !outcomes.has(raw.outcome as string) ||
    !object(raw.breakdown) ||
    Object.entries(raw.breakdown).some(
      ([key, value]) => !categories.has(key) || !finite(value),
    ) ||
    (raw.endTitle !== undefined && !text(raw.endTitle)) ||
    (raw.endMessage !== undefined && !text(raw.endMessage))
  )
    return null;
  let debrief: SavedRunResult["debrief"];
  if (raw.debrief !== undefined) {
    const summary = raw.debrief;
    if (
      !object(summary) ||
      !validFleet(summary.startingFleet) ||
      !validFleet(summary.finalFleet) ||
      ![
        summary.startingCash,
        summary.finalCash,
        summary.finalCustomers,
        summary.reliability,
        summary.unservedWh,
        summary.kgco2e,
      ].every(finite) ||
      (summary.demandWh !== undefined && !finite(summary.demandWh)) ||
      !Array.isArray(summary.highlights) ||
      summary.highlights.length > 1000 ||
      summary.highlights.some(
        (event) =>
          !object(event) ||
          !eventKinds.has(event.kind as string) ||
          !text(event.label) ||
          !text(event.message) ||
          (event.importance !== undefined &&
            !importance.has(event.importance as string)),
      ) ||
      (summary.scenarioMetrics !== undefined &&
        (!Array.isArray(summary.scenarioMetrics) ||
          summary.scenarioMetrics.length > 1000 ||
          summary.scenarioMetrics.some(
            (metric) =>
              !object(metric) ||
              !text(metric.label) ||
              !text(metric.value) ||
              !concepts.has(metric.concept as string),
          )))
    )
      return null;
    // JSON round-tripping selects plain immutable data and drops no valid optional values.
    debrief = {
      ...(summary.demandWh === undefined
        ? {}
        : { demandWh: summary.demandWh as number }),
      startingFleet: (
        summary.startingFleet as NonNullable<typeof debrief>["startingFleet"]
      ).map(({ fuel, watts }) => ({ fuel, watts })),
      finalFleet: (
        summary.finalFleet as NonNullable<typeof debrief>["finalFleet"]
      ).map(({ fuel, watts }) => ({ fuel, watts })),
      startingCash: summary.startingCash as number,
      finalCash: summary.finalCash as number,
      finalCustomers: summary.finalCustomers as number,
      reliability: summary.reliability as number,
      unservedWh: summary.unservedWh as number,
      kgco2e: summary.kgco2e as number,
      ...(summary.scenarioMetrics === undefined
        ? {}
        : {
            scenarioMetrics: (summary.scenarioMetrics as NonNullable<
              typeof debrief
            >["scenarioMetrics"])!.map(({ label, value, concept }) => ({
              label,
              value,
              concept,
            })),
          }),
      highlights: (
        summary.highlights as NonNullable<typeof debrief>["highlights"]
      ).map(({ kind, label, message, importance }) => ({
        kind,
        label,
        message,
        ...(importance === undefined ? {} : { importance }),
      })),
    };
  }
  return {
    scenarioId: raw.scenarioId as number,
    scenarioName: raw.scenarioName as string,
    difficulty: raw.difficulty as SavedRunResult["difficulty"],
    score: raw.score as number,
    breakdown: { ...raw.breakdown } as SavedRunResult["breakdown"],
    outcome: raw.outcome as SavedRunResult["outcome"],
    ...(raw.endTitle === undefined ? {} : { endTitle: raw.endTitle as string }),
    ...(raw.endMessage === undefined
      ? {}
      : { endMessage: raw.endMessage as string }),
    ...(debrief === undefined ? {} : { debrief }),
  };
}

export function savedRunResult(victory: VictoryType): SavedRunResult {
  const result = parseSavedRunResult({
    ...victory,
    outcome: victory.outcome || "completed",
  });
  if (!result)
    throw new SaveRepositoryError(
      "invalid",
      "This game's result could not be saved.",
    );
  return result;
}

export function validateStatusResult(
  status: SaveStatus,
  result: SavedRunResult | undefined,
  game: GameType,
): boolean {
  return status === "inProgress"
    ? result === undefined
    : !!result &&
        result.outcome === status &&
        result.scenarioId === game.scenarioId &&
        result.difficulty === game.difficulty;
}

export function validateSaveFileEnvelope(
  raw: unknown,
  parseSave: (value: unknown) => SaveGameType | null,
): SaveFileType {
  if (
    !object(raw) ||
    typeof raw.name !== "string" ||
    !["inProgress", "completed", "bankrupt", "fired"].includes(
      raw.status as string,
    ) ||
    !object(raw.save)
  ) {
    throw new SaveRepositoryError(
      "invalid",
      "This file uses an unsupported save format.",
    );
  }
  const name = normalizeSaveName(raw.name);
  const save = parseSave(raw.save);
  const result =
    raw.result === undefined ? undefined : parseSavedRunResult(raw.result);
  if (
    !save ||
    result === null ||
    !validateStatusResult(raw.status as SaveStatus, result, save.game)
  ) {
    throw new SaveRepositoryError(
      "invalid",
      "That file isn't a valid Electrify save game.",
    );
  }
  if (save.game.replayPlayback)
    throw new SaveRepositoryError(
      "invalid",
      "Replay playback cannot be imported as a saved game.",
    );
  return {
    name,
    status: raw.status as SaveStatus,
    save,
    ...(result === undefined ? {} : { result }),
  };
}
