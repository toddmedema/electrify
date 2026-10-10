import { MAX_INTERTIE_UPGRADES } from "./Constants";
import { validScenarioResponse } from "./helpers/ScenarioChoices";
import {
  validBuildFacility,
  validRetrofitFacility,
} from "./helpers/BuildValidation";
import { validPolicyChange } from "./helpers/Policies";
import cloneDeep from "lodash.clonedeep";
import packageJson from "../package.json";
import { isValidLocation } from "./helpers/Locations";
import { isValidDifficulty } from "./helpers/Difficulty";
import { validReplayResult } from "./SaveModel";
import {
  GameType,
  MonthlyHistoryType,
  ReplayActionNameType,
  ReplayActionType,
  ReplayDocType,
  ReplayPlaybackType,
  ReplayResultType,
  ReplayType,
} from "./Types";

/**
 * Recording and re-watching a run.
 *
 * A run is fully determined by its seed plus the player's own actions: every random draw in the
 * simulation is addressed by (seed, stream, index) rather than pulled from a running generator,
 * so the weather and fuel prices a replay sees are the ones the original player saw. That leaves
 * the action list as the whole of what has to be stored -- kilobytes, against the hundreds of
 * kilobytes a full save of the same run takes.
 *
 * Recording happens in the game reducer, next to the code being recorded, so that an action
 * can't be applied without being logged. Playback happens inside tickState, for the same reason:
 * a driver sitting outside the tick loop would fall behind it at FAST speed, where a single
 * dispatch advances the simulation several ticks.
 *
 * Like SaveGame, this module deliberately imports almost nothing but types -- reducers/Game
 * imports it, and anything reaching back into the reducers from here would close a cycle that
 * reducers/ImportOrder.test.tsx guards against.
 */

/**
 * How many actions a run may record before recording is abandoned. A twenty year game is a few
 * dozen builds and a handful of rate changes, so this sits far past normal play; it's here so
 * that a pathological run can't grow the save (or the upload) without bound. Recording stops
 * rather than truncating, because half a replay would play back as a different game while
 * claiming to be the real one.
 */
export const MAX_REPLAY_ACTIONS = 2000;

/**
 * The largest replay document that will be uploaded. Firestore's hard limit is 1,048,576 bytes
 * per document; this leaves room for the field names and the rest of the metadata, and a replay
 * that somehow reaches it is dropped rather than failing the score write behind it.
 */
export const MAX_REPLAY_BYTES = 800000;

// Generous past the longest scenario, so a checkpoint list can't grow a replay without bound.
const MAX_REPLAY_MONTHS = 2400;

// Only the fields of a `delta` that change how the simulation runs. Everything else the action
// carries -- the tutorial step, the custom scenario, the difficulty picked before the game began
// -- either doesn't affect the sim or is already in the replay header.
export const RECORDED_DELTA_KEYS = ["dollarsPerkWh"] as const;

export type RecordedDeltaType = Partial<
  Pick<GameType, (typeof RECORDED_DELTA_KEYS)[number]>
>;

const REPLAY_ACTION_NAMES: ReplayActionNameType[] = [
  "beginIntertieStress",
  "chooseScenarioResponse",
  "schedulePolicy",
  "cancelPolicy",
  "buildFacility",
  "sellFacility",
  "togglePauseFacility",
  "reprioritizeFacility",
  "buildTransmissionLine",
  "upgradeTransmissionLine",
  "cancelTransmissionLine",
  "togglePauseTransmissionLine",
  "reprioritizeTransmissionLine",
  "setTradingPolicy",
  "retrofitFacility",
  "cancelRetrofit",
  "delta",
];

/**
 * The part of a delta worth recording, or null if it changed nothing the simulation reads.
 * Called on every `delta`, including the many the UI fires that have nothing to do with the run.
 */
export function recordedDelta(
  payload: Partial<GameType>,
): RecordedDeltaType | null {
  const rate = payload.dollarsPerkWh;
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0
    ? { dollarsPerkWh: rate }
    : null;
}

/**
 * Appends an action to the run's log, if the run is being recorded at all.
 *
 * Consecutive deltas within the same game minute are merged rather than appended: the rate slider
 * fires an action per pixel dragged, and since nothing reads the intermediate values until
 * the next tick, only the one the player let go on ever mattered. Merging is exact, and it's the
 * difference between a few dozen entries and a few thousand.
 */
export function recordReplayAction(
  game: GameType,
  type: ReplayActionNameType,
  payload: unknown,
) {
  const log = game.replayLog;
  if (!log) {
    return;
  }
  const last = log[log.length - 1];
  if (
    type === "delta" &&
    last &&
    last.type === "delta" &&
    last.minute === game.date.minute
  ) {
    last.payload = {
      ...(last.payload as RecordedDeltaType),
      ...(payload as RecordedDeltaType),
    };
    return;
  }
  if (log.length >= MAX_REPLAY_ACTIONS) {
    game.replayLog = undefined;
    return;
  }
  // Cloned because the same payload object is also handed to the simulation, which goes on to
  // mutate the facility it was given
  log.push({ minute: game.date.minute, type, payload: cloneDeep(payload) });
}

/**
 * The run so far as a replay, or undefined if it wasn't recorded end to end. Has to be called
 * from inside the reducer: the game slice is an Immer draft, and it's revoked the moment the
 * reducer returns.
 */
export function serializeReplay(
  game: GameType,
  result?: ReplayResultType,
): ReplayType | undefined {
  if (!game.replayLog) {
    return undefined;
  }
  return {
    // History is newest first; checkpoints read in the order playback reaches them
    monthlyCash: game.monthlyHistory
      .map((month) => cents(month.cash))
      .reverse(),
    result: cloneDeep(result),
    appVersion: packageJson.version,
    scenarioId: game.scenarioId,
    difficulty: game.difficulty,
    seed: game.seed,
    location: cloneDeep(game.location),
    actions: cloneDeep(game.replayLog),
    meaningfulDecisionGateWaived:
      game.meaningfulDecisionGateWaived || undefined,
  };
}

export function encodeReplay(replay: ReplayType): ReplayDocType {
  // Firestore rejects undefined fields outright, and an optional field left undefined would
  // otherwise drop the whole replay from the score it belongs to.
  return JSON.parse(
    JSON.stringify({ ...replay, actions: JSON.stringify(replay.actions) }),
  );
}

/** Bytes the encoded replay will occupy, for checking against Firestore's document limit. */
export function replayByteLength(doc: ReplayDocType): number {
  const json = JSON.stringify(doc);
  return typeof TextEncoder === "undefined"
    ? json.length
    : new TextEncoder().encode(json).length;
}

function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Compares the month playback just closed with the original run's. Playback re-simulates under
 * whichever build is watching, and a later change to the rules can make the same actions play out
 * differently. Returns true only at the first month that drifts, so it is reported once.
 */
export function replayDiverged(
  playback: ReplayPlaybackType,
  history: MonthlyHistoryType[],
): boolean {
  const expected = playback.monthlyCash?.[history.length - 1];
  if (playback.diverged || expected === undefined || !history.length)
    return false;
  // A cent of slack absorbs rounding at the boundary; real drift is far larger
  if (Math.abs(cents(history[0].cash) - expected) <= 1) return false;
  playback.diverged = true;
  return true;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseActions(raw: unknown): ReplayActionType[] | null {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_REPLAY_ACTIONS) {
    return null;
  }
  const actions: ReplayActionType[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const action = entry as Partial<ReplayActionType>;
    if (
      !isFiniteNumber(action.minute) ||
      action.minute < 0 ||
      !REPLAY_ACTION_NAMES.includes(action.type as ReplayActionNameType)
    ) {
      return null;
    }
    if (
      (action.type === "schedulePolicy" || action.type === "cancelPolicy") &&
      !validPolicyChange(action.payload)
    )
      return null;
    if (
      (action.type === "buildTransmissionLine" ||
        action.type === "upgradeTransmissionLine") &&
      (typeof action.payload !== "object" ||
        action.payload === null ||
        typeof (action.payload as { corridorId?: unknown }).corridorId !==
          "string")
    )
      return null;
    if (
      (action.type === "cancelTransmissionLine" ||
        action.type === "togglePauseTransmissionLine") &&
      !(Number.isSafeInteger(action.payload) && (action.payload as number) > 0)
    )
      return null;
    if (action.type === "reprioritizeTransmissionLine") {
      const move = action.payload as {
        spotInList?: unknown;
        delta?: unknown;
      } | null;
      if (
        !Number.isSafeInteger(move?.spotInList) ||
        (move!.spotInList as number) < 0 ||
        !Number.isSafeInteger(move?.delta)
      )
        return null;
    }
    if (action.type === "buildTransmissionLine") {
      const tier = (action.payload as { tier?: unknown }).tier;
      if (
        tier !== undefined &&
        (typeof tier !== "number" ||
          !Number.isInteger(tier) ||
          tier < 1 ||
          tier > MAX_INTERTIE_UPGRADES + 1)
      )
        return null;
    }
    if (
      action.type === "setTradingPolicy" &&
      !["BALANCED", "RELIABILITY_FIRST", "SURPLUS_ONLY", "CLOSED"].includes(
        action.payload as string,
      )
    )
      return null;
    if (
      action.type === "chooseScenarioResponse" &&
      !validScenarioResponse(action.payload)
    )
      return null;
    if (action.type === "beginIntertieStress" && action.payload !== null)
      return null;
    if (action.type === "buildFacility" && !validBuildFacility(action.payload))
      return null;
    if (
      action.type === "retrofitFacility" &&
      !validRetrofitFacility(action.payload)
    )
      return null;
    if (
      action.type === "cancelRetrofit" &&
      !(Number.isSafeInteger(action.payload) && (action.payload as number) >= 0)
    )
      return null;
    actions.push({
      minute: action.minute,
      type: action.type as ReplayActionNameType,
      payload: action.payload,
    });
  }
  // Applied in order against a clock that only moves forwards, so an out of order list would
  // silently drop everything after the first step backwards
  for (let i = 1; i < actions.length; i++) {
    if (actions[i].minute < actions[i - 1].minute) {
      return null;
    }
  }
  return actions;
}

/**
 * Validates an untrusted blob -- a Firestore document, most of the time -- and returns it as a
 * replay, or null if it isn't one. Playback drives the real reducer, so a malformed action would
 * otherwise crash the sim mid-tick; the payloads themselves are checked as they are applied.
 */
export function decodeReplay(raw: unknown): ReplayType | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const doc = raw as Partial<ReplayDocType>;
  if (
    !isFiniteNumber(doc.scenarioId) ||
    !isFiniteNumber(doc.seed) ||
    typeof doc.appVersion !== "string" ||
    !isValidDifficulty(doc.difficulty) ||
    (doc.meaningfulDecisionGateWaived !== undefined &&
      typeof doc.meaningfulDecisionGateWaived !== "boolean") ||
    // Checked in full rather than trusted: the location's id becomes the path of the weather file
    // the loading screen fetches, and its lat/long drive the sun model
    !isValidLocation(doc.location) ||
    (doc.monthlyCash !== undefined &&
      (!Array.isArray(doc.monthlyCash) ||
        doc.monthlyCash.length > MAX_REPLAY_MONTHS ||
        !doc.monthlyCash.every(Number.isSafeInteger))) ||
    (doc.result !== undefined && !validReplayResult(doc.result))
  ) {
    return null;
  }
  const actions = parseActions(doc.actions);
  if (!actions) {
    return null;
  }
  return {
    appVersion: doc.appVersion,
    scenarioId: doc.scenarioId,
    difficulty: doc.difficulty as ReplayType["difficulty"],
    seed: doc.seed,
    location: doc.location,
    actions,
    meaningfulDecisionGateWaived: doc.meaningfulDecisionGateWaived || undefined,
    monthlyCash: doc.monthlyCash,
    result: doc.result,
  };
}
