import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import {
  transmissionRatingW,
  intertieOfferLimits,
  intertieContextForGame,
} from "../helpers/Transmission";
import { generateNewTimeline } from "./Game";
import { validWorldEvent } from "../helpers/WorldEventValidation";
import { parseSave, serializeSave } from "../SaveGame";
import { combineStoryEffects } from "../data/WorldEvents";

function atMonth(month: number) {
  const game = createGame({ scenarioId: 111, seed: 12345 });
  game.date = getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear);
  return game;
}

test("starts with an operating, debt-free northern intertie and live imports", () => {
  const game = createGame({ scenarioId: 111, seed: 12345 });
  expect(game.transmission!.lines).toHaveLength(1);
  expect(game.transmission!.lines[0]).toMatchObject({
    corridorId: "california-north",
    capacityW: 40e6,
    yearsToBuildLeft: 0,
    loanAmountLeft: 0,
  });
  expect(game.timeline.some((tick) => tick.importedW! > 0)).toBe(true);
  expect(parseSave(serializeSave(game))).not.toBeNull();
});

test("the real forecast restricts the northern route through the outage and restores it afterward", () => {
  for (const month of [35, 36, 37, 38]) {
    const game = atMonth(month);
    const timeline = generateNewTimeline(
      game,
      1e9,
      game.timeline[0].customers,
      96,
    );
    const line = game.transmission!.lines[0];
    const restricted = month === 36 || month === 37;
    for (const tick of timeline) {
      const normal = transmissionRatingW(line, {
        ...tick,
        transmissionCapacityLimitsWByCorridor: undefined,
      });
      expect(tick.transmissionCapacityW).toBeCloseTo(
        normal * (restricted ? 0.1 : 1),
        -1,
      );
      expect(tick.importedW).toBeLessThanOrEqual(tick.transmissionCapacityW!);
    }
    expect(timeline.some((tick) => tick.supplyW < tick.demandW)).toBe(
      restricted,
    );
    const control = { ...game, storyEffectsDisabled: true };
    const noFire = generateNewTimeline(
      control,
      1e9,
      game.timeline[0].customers,
      96,
    );
    expect(timeline.map((tick) => tick.demandW)).toEqual(
      noFire.map((tick) => tick.demandW),
    );
    expect(game.facilities).toEqual(control.facilities);
  }
});

test("dispatch and previews constrain both trade directions, preserve independent routes, and permit a complete outage", () => {
  const game = atMonth(36);
  const context = intertieContextForGame(game);
  const normal = { temperatureC: 20, solarIrradianceWM2: 0 };
  const fire = {
    ...normal,
    transmissionCapacityLimitsWByCorridor: { "california-north": 4e6 },
  };
  const north = game.transmission!.lines[0];
  const south = { ...north, corridorId: "california-south", capacityW: 15e6 };
  expect(transmissionRatingW(north, fire)).toBe(4e6);
  expect(transmissionRatingW(south, fire)).toBe(
    transmissionRatingW(south, normal),
  );
  for (const capacityW of [40e6, 60e6, 90e6, 135e6]) {
    const limits = intertieOfferLimits(
      { ...north, capacityW },
      context,
      game.date.minute,
      fire,
    );
    expect(limits.importLimitW).toBeLessThanOrEqual(4e6);
    expect(limits.exportLimitW).toBeLessThanOrEqual(4e6);
  }
  expect(
    transmissionRatingW(north, {
      ...fire,
      transmissionCapacityLimitsWByCorridor: { "california-north": 0 },
    }),
  ).toBe(0);
  expect(transmissionRatingW({ ...north, paused: true }, fire)).toBe(0);
});

test("composes route restrictions and rejects corrupt saved capacity limits", () => {
  const effects = {
    transmissionCapacityLimitsWByCorridor: { "california-north": 4e6 },
  };
  expect(
    combineStoryEffects([{ effects }, { effects }])
      .transmissionCapacityLimitsWByCorridor!["california-north"],
  ).toBe(4e6);
  const event = {
    key: "route",
    definitionId: "route",
    startsMinute: 0,
    endsMinute: 1,
    attributes: {},
    effects,
  };
  expect(validWorldEvent(event)).toBe(true);
  for (const ratio of [-1, NaN, Infinity])
    expect(
      validWorldEvent({
        ...event,
        effects: {
          transmissionCapacityLimitsWByCorridor: {
            "california-north": ratio,
          },
        },
      }),
    ).toBe(false);
  const game = createGame({ scenarioId: 111, seed: 12345 });
  const active = {
    ...event,
    startsMinute: game.date.minute,
    endsMinute: game.date.minute + MINUTES_PER_MONTH,
  };
  game.worldEvents.active.push(active);
  game.worldEvents.occurrences.push(cloneDeep(active));
  const restored = parseSave(serializeSave(game))!;
  expect(restored).not.toBeNull();
  expect(restored.game.worldEvents.active).toEqual(game.worldEvents.active);
});

test("rejects corrupt route limits in a saved forecast tick", () => {
  const game = createGame({ scenarioId: 111, seed: 7 });
  for (const limitW of [-1, NaN, Infinity]) {
    const save = serializeSave(game);
    save.game.timeline[0].transmissionCapacityLimitsWByCorridor = {
      "california-north": limitW,
    };
    expect(parseSave(save)).toBeNull();
  }
});
