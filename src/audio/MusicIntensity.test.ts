import { createGame } from "../testing/Simulator";
import { TICK_MINUTES } from "../Constants";
import { GameType, TickPresentFutureType } from "../Types";
import { musicIntensityForGame } from "./MusicIntensity";

function grid(overrides: Partial<TickPresentFutureType> = {}): GameType {
  const game = createGame({ scenarioId: 101 });
  return {
    ...game,
    inGame: true,
    date: { ...game.date, minute: 0 },
    timeline: [
      {
        ...game.timeline[0],
        minute: 0,
        supplyW: 100,
        demandW: 100,
        reserveW: 20,
        ...overrides,
      },
    ],
  };
}

it("keeps a stable grid at the quieter baseline", () => {
  expect(musicIntensityForGame(grid())).toBe(0);
  expect(musicIntensityForGame(grid({ reserveW: 10 }))).toBe(0);
  expect(musicIntensityForGame(grid({ demandW: 0 }))).toBe(0);
});

it("builds tension as usable reserves run out before an actual blackout", () => {
  expect(musicIntensityForGame(grid({ reserveW: 5 }))).toBeCloseTo(0.25);
  expect(musicIntensityForGame(grid({ reserveW: 0 }))).toBeCloseTo(0.5);
  // Ticks without a reserve measurement use the available supply margin.
  expect(
    musicIntensityForGame(grid({ supplyW: 105, reserveW: undefined })),
  ).toBeCloseTo(0.25);
});

it("responds to live blackouts and their severity, bounded at full intensity", () => {
  const light = musicIntensityForGame(grid({ supplyW: 99 }));
  const severe = musicIntensityForGame(grid({ supplyW: 75 }));
  expect(light).toBeGreaterThan(0.7);
  expect(severe).toBeGreaterThan(light);
  expect(severe).toBe(1);
  expect(musicIntensityForGame(grid({ supplyW: 0 }))).toBe(1);
  expect(
    musicIntensityForGame({
      ...grid(),
      blackout: { startMinute: 0, unservedWh: 10 },
    }),
  ).toBe(0.7);
});

it("uses the live tick rather than a future shortage or an old blackout", () => {
  const game = grid();
  const future = { ...game.timeline[0], minute: TICK_MINUTES, supplyW: 0 };
  expect(
    musicIntensityForGame({ ...game, timeline: [...game.timeline, future] }),
  ).toBe(0);
  expect(
    musicIntensityForGame({
      ...game,
      timeline: [future, { ...future, minute: TICK_MINUTES * 2 }],
      inGame: false,
      blackout: { startMinute: 0, unservedWh: 10 },
    }),
  ).toBe(0);
});

it("handles the brief initialization window without a live sample", () => {
  const game = { ...grid(), timeline: [] };
  expect(musicIntensityForGame(game)).toBe(0);
  expect(
    musicIntensityForGame({
      ...game,
      blackout: { startMinute: 0, unservedWh: 10 },
    }),
  ).toBe(0.7);
});
