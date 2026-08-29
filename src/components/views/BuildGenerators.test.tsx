import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { GENERATORS } from "../../data/Facilities";
import { createGame } from "../../testing/Simulator";
import { GeneratorBuildItem } from "./BuildGenerators";

jest.mock("../base/ManualLink", () => () => null);

it("shows natural-gas base, per-start, and daily-start estimated O&M", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 419000000, [], []).find(
    (candidate) => candidate.name === "Natural Gas",
  );
  expect(generator).toBeDefined();

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator!}
      location={game.location}
      seed={game.seed}
      onBuild={jest.fn()}
    />,
  );

  expect(screen.getByText("Est. O&M (1 start/day)")).toBeInTheDocument();
  expect(screen.getByText("$13.4M/yr")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Show Natural Gas details" }),
  );

  expect(
    screen.getByRole("row", {
      name: /Base O&M.*45% expected output.*\$4\.93M/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Non-fuel start cost.*Per equivalent start.*\$23\.1k\/start/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Estimated O&M.*Base O&M plus one start\/day.*\$13\.4M\/yr/,
    }),
  ).toBeInTheDocument();
});

it("shows Coal's physical and representative-day start charges", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 650000000, [], []).find(
    (candidate) => candidate.name === "Coal",
  );
  expect(generator).toBeDefined();

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator!}
      location={game.location}
      seed={game.seed}
      onBuild={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show Coal details" }));

  expect(
    screen.getByRole("row", {
      name: /Non-fuel start cost.*Per equivalent start.*\$52\.7k\/start/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Representative-day charge.*365 \/ 12 equivalent starts.*\$1\.6M\/displayed start/,
    }),
  ).toBeInTheDocument();
});
