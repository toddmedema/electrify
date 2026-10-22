import fs from "fs";
import path from "path";
import cloneDeep from "lodash.clonedeep";
import { configureStore } from "@reduxjs/toolkit";
import { Provider, useSelector } from "react-redux";
import { fireEvent, render, screen } from "@testing-library/react";
import type { GameType, ScenarioType } from "../../Types";
import reducer from "../../reducers/Game";
import { createGame } from "../../testing/Simulator";
import LegacyWildfireProgram from "./LegacyWildfireProgram";

const reference: {
  cases: { group: number; difficulty: string; scenario: ScenarioType }[];
} = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../../testing/fixtures/FrozenLegacyArcSnapshots.json",
    ),
    "utf8",
  ),
);

test("an old detached scenario can start and stop its program through the real reducer", () => {
  const source = reference.cases.find(
    (entry) => entry.group === 1 && entry.difficulty === "Employee",
  )!.scenario;
  const game = createGame({
    scenarioId: 999,
    scenario: cloneDeep(source),
    difficulty: "Employee",
    seed: source.seed,
  });
  const originalRules = cloneDeep(game.customScenario!.mod!.rules);
  const store = configureStore({
    reducer: { game: reducer },
    preloadedState: { game },
  });
  function Program() {
    return (
      <LegacyWildfireProgram
        game={useSelector((state: { game: GameType }) => state.game)}
      />
    );
  }
  const view = render(
    <Provider store={store}>
      <Program />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Start preparedness/ }));
  const started = store.getState().game.worldEvents.occurrences.at(-1)!;
  expect(started).toMatchObject({
    key: `wildfire:${game.location.id}:preparedness:0`,
    attributes: {
      choice: "prepare",
      startEffectiveness: 0,
      cost: 0,
      upfrontGrant: 0,
      scenarioChoice: true,
    },
  });
  expect(started.attributes.annualCost).toBeGreaterThan(0);
  expect(
    screen.getByRole("progressbar", {
      name: "Wildfire preparedness effectiveness",
    }),
  ).toHaveAttribute("aria-valuenow", "0");
  fireEvent.click(
    screen.getByRole("button", { name: /^Turn off preparedness$/ }),
  );
  expect(store.getState().game.worldEvents.occurrences.at(-1)).toMatchObject({
    key: `wildfire:${game.location.id}:preparedness:1`,
    attributes: { choice: "stop", annualCost: 0, startEffectiveness: 0 },
  });
  expect(
    screen.getByRole("button", { name: /^Start preparedness/ }),
  ).toBeEnabled();
  expect(store.getState().game.customScenario!.mod!.rules).toEqual(
    originalRules,
  );
  view.unmount();
});

test("native and ordinary custom games do not show the retired control", () => {
  for (const scenarioId of [111, 999]) {
    const game = createGame({ scenarioId });
    const store = configureStore({
      reducer: { game: reducer },
      preloadedState: { game },
    });
    const view = render(
      <Provider store={store}>
        <LegacyWildfireProgram game={game} />
      </Provider>,
    );
    expect(
      screen.queryByRole("region", { name: "Wildfire preparedness" }),
    ).not.toBeInTheDocument();
    view.unmount();
  }
});
