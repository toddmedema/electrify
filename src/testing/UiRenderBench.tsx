// Opt-in render benchmark, excluded from the normal Jest suites. Run with:
// npm run test:once -- --testMatch=**/src/testing/UiRenderBench.tsx --runInBand
// React Profiler measures render work in jsdom, not browser paint or end-to-end frame time.
import * as React from "react";
import { render } from "@testing-library/react";
import { createGame } from "./Simulator";
import { tickState } from "../reducers/Game";
import { GameType } from "../Types";
import { GameAppBar } from "../components/base/GameAppBar";
import MissionSummary from "../components/base/MissionSummary";
import { SIDE_LAYOUT_MEDIA, SIDE_LAYOUT_MIN_WIDTH } from "../Globals";
import { TICK_MINUTES } from "../Constants";
import { currentTick } from "../helpers/GameSelectors";
import * as missionStatus from "../helpers/MissionStatus";
import {
  projectionReady,
  readProjection,
} from "../components/base/DeferredProjection";

jest.setTimeout(120000);

it("reports app bar and mission render cost at phone and desktop widths", () => {
  const fresh = createGame({
    scenarioId: 103,
    seed: 12345,
    difficulty: "Employee",
    dollarsPerkWh: 0.035,
  });
  const developed = createGame({
    scenarioId: 103,
    seed: 12345,
    difficulty: "Employee",
    dollarsPerkWh: 0.035,
  });
  for (let i = 0; i < 96 * 239; i++) tickState(developed);
  expect(developed.monthlyHistory).toHaveLength(239);
  fresh.inGame = true;
  developed.inGame = true;
  const noop = () => undefined;
  const results: unknown[] = [];
  const originalWidth = Object.getOwnPropertyDescriptor(
    document.documentElement,
    "clientWidth",
  );
  const originalMatchMedia = window.matchMedia;
  try {
    for (const width of [390, 1440]) {
      Object.defineProperty(document.documentElement, "clientWidth", {
        configurable: true,
        value: width,
      });
      window.matchMedia = (query) => ({
        ...originalMatchMedia(query),
        matches: query === SIDE_LAYOUT_MEDIA && width >= SIDE_LAYOUT_MIN_WIDTH,
      });
      window.dispatchEvent(new Event("resize"));
      for (const [name, game] of [
        ["fresh", fresh],
        ["239-month", developed],
      ] as const) {
        // The app bar renders every tick. Also measure its mission subtree to isolate calculation
        // work from the rest of the controls. jsdom exercises responsive branches, not layout.
        for (const view of ["appbar", "mission"]) {
          const now = currentTick(game)!;
          expect(now.cash).toBeGreaterThanOrEqual(0);
          const current =
            now.minute <= game.date.minute &&
            game.date.minute - now.minute < TICK_MINUTES;
          const riskPath =
            current && now.supplyW < now.demandW ? "shortage" : "status";
          // The mature unexpanded fleet is short of power throughout its day: keep that urgent
          // path as a control, rather than attributing its timings to duplicate status work.
          expect(riskPath).toBe(name === "fresh" ? "status" : "shortage");
          // Measure ordinary play after the forecast is available. A pending forecast defers
          // risk selection and would hide repeated status calculations from this benchmark.
          readProjection(game, now);
          expect(projectionReady(game)).toBe(true);
          const samples: number[] = [];
          let collecting = false;
          const onRender: React.ProfilerOnRenderCallback = (
            _id,
            _phase,
            duration,
          ) => {
            if (collecting) samples.push(duration);
          };
          const tree = (state: GameType) => (
            <React.Profiler id="game-status" onRender={onRender}>
              {view === "mission" ? (
                <MissionSummary game={state} />
              ) : (
                <GameAppBar
                  game={state}
                  onManual={noop}
                  onNextTutorial={noop}
                  onQuit={noop}
                  onSettings={noop}
                  onSpeedChange={noop}
                />
              )}
            </React.Profiler>
          );
          const selector = jest.spyOn(missionStatus, "selectMissionRisk");
          const mounted = render(tree(game));
          try {
            selector.mockClear();
            mounted.rerender(tree({ ...game }));
            expect(selector).toHaveBeenCalledTimes(1);
          } finally {
            // The untimed probe proves the intended path; timed samples use the real function.
            selector.mockRestore();
          }
          for (let i = 0; i < 100; i++) mounted.rerender(tree({ ...game }));
          collecting = true;
          for (let i = 0; i < 500; i++) mounted.rerender(tree({ ...game }));
          mounted.unmount();
          samples.sort((a, b) => a - b);
          results.push({
            width,
            name,
            view,
            riskPath,
            renders: samples.length,
            medianMs: samples[Math.floor(samples.length / 2)],
            totalMs: samples.reduce((a, b) => a + b, 0),
          });
        }
      }
    }
  } finally {
    if (originalWidth) {
      Object.defineProperty(
        document.documentElement,
        "clientWidth",
        originalWidth,
      );
    } else {
      Reflect.deleteProperty(document.documentElement, "clientWidth");
    }
    window.matchMedia = originalMatchMedia;
    window.dispatchEvent(new Event("resize"));
  }
  console.log(JSON.stringify(results)); // eslint-disable-line no-console
});
