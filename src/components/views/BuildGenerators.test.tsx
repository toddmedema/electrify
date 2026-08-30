import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { GENERATORS } from "../../data/Facilities";
import { createGame } from "../../testing/Simulator";
import BuildGenerators, {
  GeneratorBuildItem,
  generatorRole,
} from "./BuildGenerators";

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
  expect(screen.getByText("Flexible power")).toBeInTheDocument();
  expect(screen.getByText(/typical output/)).toBeInTheDocument();
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

  fireEvent.click(
    screen.getByRole("button", { name: "Review purchase of Natural Gas" }),
  );
  const impact = screen.getByRole("region", { name: "Expected impact" });
  expect(impact).toHaveTextContent("What changes");
  expect(impact).toHaveTextContent("Cash purchase");
  expect(impact).toHaveTextContent("Online in");
  expect(impact).toHaveTextContent("Typical supply");
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

it("shows Oil's fixed, variable, and expected-output O&M", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 100000000, [], []).find(
    (candidate) => candidate.name === "Oil",
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

  expect(
    screen.getByText("Estimated O&M (20% expected output)"),
  ).toBeInTheDocument();
  expect(screen.getByText("$7.59M/yr")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show Oil details" }));

  expect(
    screen.getByRole("row", {
      name: /Fixed O&M.*Standing annual expense.*\$3\.09M\/yr/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Variable O&M.*Per generated MWh.*\$25\.71\/MWh generated/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Estimated O&M.*20% expected output.*\$7\.59M\/yr/,
    }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Non-fuel start cost")).toBeNull();
});

it("describes clean variable generation as a strategic role", () => {
  const game = createGame({ scenarioId: 100, difficulty: "Employee" });
  const solar = GENERATORS(game, 200000000, [], []).find(
    (candidate) => candidate.name === "Solar",
  )!;
  expect(generatorRole(solar)).toEqual(
    expect.objectContaining({ label: "Clean, weather-led" }),
  );
});

it("submits a generator purchase only once on a double-click", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 419000000, [], []).find(
    (candidate) => candidate.name === "Natural Gas",
  )!;
  const onBuild = jest.fn();

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator}
      location={game.location}
      seed={game.seed}
      onBuild={onBuild}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Review purchase of Natural Gas" }),
  );
  const takeLoan = screen.getByRole("button", { name: "Take loan" });
  fireEvent.click(takeLoan);
  fireEvent.click(takeLoan);

  expect(onBuild).toHaveBeenCalledTimes(1);
});

it("pins up to three current-grid choices into a comparison tray", () => {
  const game = createGame({ scenarioId: 100, difficulty: "Employee" });
  render(
    <BuildGenerators
      game={game}
      onBack={jest.fn()}
      onBuildGenerator={jest.fn()}
    />,
  );

  const compare = screen.getAllByRole("button", { name: /^Compare / });
  fireEvent.click(compare[0]);
  fireEvent.click(compare[1]);
  expect(
    screen.getByRole("region", { name: "Generator comparison" }),
  ).toHaveTextContent("Comparing 2/3");
});
