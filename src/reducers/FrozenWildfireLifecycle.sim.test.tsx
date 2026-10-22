import "../Store";
import fs from "fs";
import path from "path";
import cloneDeep from "lodash.clonedeep";
import type { GameType, SaveGameType, ScenarioType } from "../Types";
import { decodeReplay } from "../Replay";
import { parseSave, serializeSave } from "../SaveGame";
import { currentTick } from "../helpers/GameSelectors";
import { getScenarioLocation } from "../helpers/Locations";
import {
  runFailure,
  validGameObjectiveProgress,
} from "../helpers/ObjectiveRules";
import { validScenarioMod } from "../helpers/ScenarioMod";
import {
  optionalScenarioChoice,
  pendingScenarioChoice,
} from "../helpers/ScenarioChoices";
import { validScenarioRuleState } from "../helpers/ScenarioRuleValidation";
import { checkMonth, InvariantCollector } from "../testing/Invariants";
import {
  canonicalOfficialWorld,
  officialWorldHash,
} from "../testing/OfficialWorldRoutes";
import { loadSimData } from "../testing/SimData";
import {
  createGame,
  createGameFromReplay,
  type SimOptionsType,
} from "../testing/Simulator";
import reducer, { tickState } from "./Game";
import { chooseScenarioResponse } from "./GameActions";

interface LifecycleCheckpoint {
  stage: string;
  saveAccepted: boolean;
  month: number;
  gameHash: string;
  monthlyHash: string;
  facilitiesHash: string;
  occurrences: unknown;
}
interface LifecycleCase {
  config: { id: string; declared: string; program: boolean; stopAt?: number };
  options: SimOptionsType;
  monthlyHistoryHash: string;
  finalFacilitiesHash: string;
  finalGameHash: string;
  occurrences: unknown;
  checkpoints: LifecycleCheckpoint[];
  observations: unknown;
  pendingSave?: unknown;
  pendingReplay?: unknown;
  activeProgramSave?: unknown;
}
const reference: {
  baselineCommit: string;
  significantDigits: number;
  cases: LifecycleCase[];
} = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../testing/fixtures/FrozenWildfireLifecycleReference.json",
    ),
    "utf8",
  ),
);

jest.setTimeout(120000);
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function choose(game: GameType, id: string, optionId: string): GameType {
  return cloneDeep(
    reducer(game, chooseScenarioResponse({ decisionId: id, optionId })),
  );
}
function requireOptionalOffer(game: GameType, optionId: string) {
  const offer = optionalScenarioChoice(game);
  expect(offer).toBeDefined();
  expect(offer!.options.map((option) => option.id)).toContain(optionId);
  return offer!;
}
function requireFirstDecision(answered: boolean) {
  expect(answered).toBe(false);
}
function requireViableMonth(game: GameType, scenario: ScenarioType) {
  expect(
    runFailure(game, scenario, game.monthlyHistory, currentTick(game)!, false),
  ).toBeUndefined();
}

test("the literal old111 lifecycle oracle includes paid preparation, start, stop and restoration", () => {
  expect(reference.baselineCommit).toBe(
    "2fc5d50ebedd5d3695b9db7d75ca5b54c0912779",
  );
  expect(reference.significantDigits).toBe(10);
  expect(reference.cases.map((item) => item.config.id)).toEqual([
    "declared-standard",
    "declared-prepare",
    "ongoing-prepare",
    "ongoing-stop",
  ]);
  for (const item of reference.cases) {
    expect(item.options.scenario!.locationId).toBe("Paris");
    expect(item.options.scenario!.durationMonths).toBe(60);
    expect(
      item.checkpoints
        .filter((checkpoint) => !checkpoint.saveAccepted)
        .map((checkpoint) => checkpoint.stage),
    ).toEqual(["month-38", "month-60"]);
  }
});

for (const expected of reference.cases)
  test(`literal old ${expected.config.id} preserves every physical fact through 60 months and accepts restored saves`, () => {
    const options = cloneDeep(expected.options);
    const scenario = options.scenario!;
    loadSimData(getScenarioLocation(scenario)!);
    let game = createGame(options);
    const originalScenario = JSON.stringify(scenario);
    expect(
      validScenarioMod(game.customScenario!.mod, game.customScenario!),
    ).toBe(true);
    expect(game.facilities).toContainEqual(
      expect.objectContaining({ name: "Natural Gas Peaker", peakW: 500e6 }),
    );
    const checkpoints: Omit<LifecycleCheckpoint, "saveAccepted">[] = [];
    const observations: unknown[] = [];
    const checkpoint = (stage: string) => {
      expect(validGameObjectiveProgress(game)).toBe(true);
      expect({ stage, valid: validScenarioRuleState(game) }).toEqual({
        stage,
        valid: true,
      });
      const saved = JSON.parse(JSON.stringify(serializeSave(game)));
      const restored = parseSave(saved);
      // The original parser incorrectly rejected its own completed restoration
      // at months 38/60. Keep that old finding in the immutable oracle, compare
      // every original physical field, and require the corrected parser here.
      expect(restored).not.toBeNull();
      expect(restored!.game.customScenario).toEqual(game.customScenario);
      expect(restored!.game.monthlyHistory).toEqual(game.monthlyHistory);
      expect(restored!.game.worldEvents).toEqual(game.worldEvents);
      checkpoints.push({
        stage,
        month: game.date.monthsElapsed,
        gameHash: officialWorldHash(game),
        monthlyHash: officialWorldHash(game.monthlyHistory),
        facilitiesHash: officialWorldHash(game.facilities),
        occurrences: canonicalOfficialWorld(game.worldEvents.occurrences),
      });
    };
    let programStarted = false;
    let programStopped = false;
    let answered = false;
    let lastMonth = -1;
    const collector = new InvariantCollector();
    while (game.date.monthsElapsed < 60) {
      const month = game.date.monthsElapsed;
      if (expected.config.program && !programStarted) {
        const offer = requireOptionalOffer(game, "prepare");
        game = choose(game, offer.id, "prepare");
        programStarted = true;
        checkpoint("program-started");
      }
      if (expected.config.stopAt === month && !programStopped) {
        const offer = requireOptionalOffer(game, "stop");
        game = choose(game, offer.id, "stop");
        programStopped = true;
        checkpoint("program-stopped");
      }
      const pending = pendingScenarioChoice(game);
      if (pending) {
        requireFirstDecision(answered);
        checkpoint("declared-pending");
        game = choose(game, pending.id, expected.config.declared);
        answered = true;
        checkpoint("declared-answered");
      }
      tickState(game);
      if (game.date.monthsElapsed !== lastMonth) {
        lastMonth = game.date.monthsElapsed;
        if (game.monthlyHistory.length) {
          checkMonth(collector, game.monthlyHistory[0], String(lastMonth));
        }
        requireViableMonth(game, scenario);
        if ([35, 36, 37, 38, 60].includes(lastMonth)) {
          checkpoint(`month-${lastMonth}`);
          observations.push({
            month: lastMonth,
            active: canonicalOfficialWorld(game.worldEvents.active),
            occurrences: canonicalOfficialWorld(game.worldEvents.occurrences),
            history: canonicalOfficialWorld(game.monthlyHistory.slice(0, 2)),
          });
        }
      }
    }
    expect(game.monthlyHistory).toHaveLength(60);
    expect(answered).toBe(true);
    expect(programStarted).toBe(expected.config.program);
    expect(programStopped).toBe(expected.config.stopAt !== undefined);
    expect(collector.getViolations()).toEqual([]);
    expect(checkpoints).toEqual(
      expected.checkpoints.map(
        ({ saveAccepted: _sourceParserVerdict, ...physical }) => physical,
      ),
    );
    expect(officialWorldHash([...game.monthlyHistory].reverse())).toBe(
      expected.monthlyHistoryHash,
    );
    expect(officialWorldHash(game.facilities)).toBe(
      expected.finalFacilitiesHash,
    );
    expect(officialWorldHash(game)).toBe(expected.finalGameHash);
    expect(canonicalOfficialWorld(game.worldEvents.occurrences)).toEqual(
      expected.occurrences,
    );
    expect(observations).toEqual(expected.observations);
    expect(JSON.stringify(scenario)).toBe(originalScenario);
  });

test("actual old pending and active-program documents retain detached rules and their precise offers", () => {
  const source = reference.cases.find(
    (item) => item.config.id === "ongoing-prepare",
  )!;
  loadSimData(getScenarioLocation(source.options.scenario)!);
  const pending = parseSave(cloneDeep(source.pendingSave));
  const active = parseSave(cloneDeep(source.activeProgramSave));
  const replay = decodeReplay(cloneDeep(source.pendingReplay));
  expect(pending).not.toBeNull();
  expect(active).not.toBeNull();
  expect(replay).not.toBeNull();
  for (const saved of [pending!, active!]) {
    expect(saved.game.scenarioRuleHistoryStartMinute).toBeUndefined();
    expect(saved.game.customScenario).toEqual(source.options.scenario);
    expect(saved.game.customScenario!.eventScenarioIds).toContain(111);
    expect(
      validScenarioMod(
        saved.game.customScenario!.mod,
        saved.game.customScenario!,
      ),
    ).toBe(true);
    expect(
      optionalScenarioChoice(saved.game)!.options.map((option) => option.id),
    ).toContain("stop");
    expect(parseSave(serializeSave(saved.game))).not.toBeNull();
  }
  expect(
    pendingScenarioChoice(pending!.game)?.options.map((option) => option.id),
  ).toEqual(["prepare", "standard"]);
  expect(pendingScenarioChoice(active!.game)).toBeUndefined();
  expect(replay!.customScenario).toEqual(source.options.scenario);
  const playback = createGameFromReplay(replay!);
  while (playback.date.minute < pending!.game.date.minute) tickState(playback);
  expect(playback.date).toEqual(pending!.game.date);
  expect(playback.monthlyHistory).toEqual(pending!.game.monthlyHistory);
  expect(playback.worldEvents).toEqual(pending!.game.worldEvents);
  const describeChoice = (game: GameType) => {
    const choice = pendingScenarioChoice(game)!;
    return {
      ...choice,
      options: choice.options.map((option) => ({
        ...option,
        cost: option.cost(game.difficulty),
        upfrontGrant: option.upfrontGrant?.(game.difficulty),
      })),
    };
  };
  expect(describeChoice(playback)).toEqual(describeChoice(pending!.game));
  let serializedQuotes = 0;
  const replayFacilities = playback.facilities.map((facility, index) => {
    if (pending!.game.facilities[index].lcWh !== null) return facility;
    expect(["Sun", "Wind"]).toContain(facility.fuel);
    expect(facility.lcWh).toBe(Infinity);
    serializedQuotes++;
    return { ...facility, lcWh: null };
  });
  expect(serializedQuotes).toBe(2);
  expect(replayFacilities).toEqual(pending!.game.facilities);
  const hostile = cloneDeep(source.pendingSave) as SaveGameType;
  hostile.game.customScenario!.mod!.rules.arcChoices![0].options[0].cost! += 1;
  expect(parseSave(hostile)).toBeNull();
  expect(parseSave(cloneDeep(source.pendingSave))).not.toBeNull();
});
