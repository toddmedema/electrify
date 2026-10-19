// Opt-in render benchmark, excluded from the normal Jest suites. Run with:
// npm run test:once -- --testMatch=**/src/testing/UiRenderBench.tsx --runInBand
// React Profiler measures render work in jsdom, not browser paint or end-to-end frame time.
import * as React from "react";
import { render } from "@testing-library/react";
import { createGame } from "./Simulator";
import { tickState } from "../reducers/Game";
import { GameType } from "../Types";
import { GameAppBar } from "../components/base/GameAppBar";

jest.setTimeout(120000);

it("reports closed details render cost", () => {
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
  for (const [name, game] of [
    ["fresh", fresh],
    ["239-month", developed],
  ] as const) {
    // The scenario details live in a tool panel that unmounts when closed, so only the app bar
    // still renders on every tick
    for (const view of ["appbar"]) {
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
        <React.Profiler id="closed-details" onRender={onRender}>
          <GameAppBar
            game={state}
            onManual={noop}
            onNextTutorial={noop}
            onQuit={noop}
            onSettings={noop}
            onSpeedChange={noop}
          />
        </React.Profiler>
      );
      const mounted = render(tree(game));
      for (let i = 0; i < 100; i++) mounted.rerender(tree({ ...game }));
      collecting = true;
      for (let i = 0; i < 500; i++) mounted.rerender(tree({ ...game }));
      mounted.unmount();
      samples.sort((a, b) => a - b);
      results.push({
        name,
        view,
        renders: samples.length,
        medianMs: samples[Math.floor(samples.length / 2)],
        totalMs: samples.reduce((a, b) => a + b, 0),
      });
    }
  }
  console.log(JSON.stringify(results)); // eslint-disable-line no-console
});
