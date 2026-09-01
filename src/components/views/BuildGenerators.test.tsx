import * as React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { GENERATORS } from "../../data/Facilities";
import { createGame } from "../../testing/Simulator";
import BuildGenerators, { GeneratorBuildItem } from "./BuildGenerators";

jest.mock("../base/ManualLink", () => () => null);

it("shows natural-gas base, per-start, and daily-start estimated O&M", async () => {
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

  expect(
    screen.queryByText("Est. operations & maintenance"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("$13.4M/yr")).not.toBeInTheDocument();
  expect(screen.queryByText("Flexible power")).toBeNull();
  expect(screen.getByText(/typical output/)).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Show Natural Gas details" }),
  );

  expect(
    screen.getByRole("row", {
      name: /Base operations & maintenance.*45% expected output.*\$4\.93M/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Non-fuel start cost.*Per equivalent start.*\$23\.1k\/start/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Estimated operations & maintenance.*Base operating cost plus one start per simulated day.*\$13\.4M\/yr/,
    }),
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Review purchase of Natural Gas" }),
  );
  const impact = screen.getByRole("region", { name: "Expected impact" });
  expect(impact).toHaveTextContent("What changes");
  expect(impact).toHaveTextContent("Cash purchase");
  expect(impact).toHaveTextContent("Online in");
  expect(impact).toHaveTextContent("Estimated average output");
  expect(impact).not.toHaveTextContent("Loan:");
  expect(
    screen.queryByRole("table", { name: "Financing terms" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Cash cost")).not.toBeInTheDocument();
  expect(screen.queryByText("Time to build")).not.toBeInTheDocument();

  const showFinancing = screen.getByRole("button", {
    name: "Show financing terms",
  });
  expect(showFinancing).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(showFinancing);

  const financingTerms = screen.getByRole("table", {
    name: "Financing terms",
  });
  expect(
    screen.getByRole("row", { name: /Downpayment \$[\d.]+[kMB]?/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", { name: /Interest rate.*\d+\.\d+%/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", { name: /Monthly payments \$[\d.]+[kMB]?\/mo/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Loan duration Construction \+ \d+ years/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Hide financing terms" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(financingTerms).not.toHaveTextContent("Cash cost");
  expect(financingTerms).not.toHaveTextContent("Time to build");

  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "close" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(
    screen.getByRole("button", { name: "Review purchase of Natural Gas" }),
  );
  expect(
    screen.getByRole("button", { name: "Show financing terms" }),
  ).toHaveAttribute("aria-expanded", "false");
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
    screen.queryByText("Est. operations & maintenance"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("$7.59M/yr")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show Oil details" }));

  expect(
    screen.getByRole("row", {
      name: /Fixed operations & maintenance.*Standing annual expense.*\$3\.09M\/yr/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Variable operations & maintenance.*Per generated MWh.*\$25\.71\/MWh generated/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Estimated operations & maintenance.*20% expected output.*\$7\.59M\/yr/,
    }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Non-fuel start cost")).toBeNull();
});

it("keeps primary generator metrics visible and discloses secondary details", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 419000000, [], []).find(
    (candidate) => candidate.name === "Natural Gas",
  )!;

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator}
      location={game.location}
      seed={game.seed}
      forecastGapW={generator.peakW}
      advantages={["Fastest online", "Lowest lifetime cost"]}
      onBuild={jest.fn()}
    />,
  );

  expect(screen.getByText("Natural Gas")).toBeInTheDocument();
  expect(screen.getByText(/typical output/)).toBeInTheDocument();
  expect(screen.getByText(/largest forecast shortage/)).toBeInTheDocument();
  expect(screen.getByText("Build cost")).toBeInTheDocument();
  expect(screen.getByText("Build time")).toBeInTheDocument();
  expect(screen.queryByText("Fastest online")).not.toBeInTheDocument();
  expect(screen.queryByText("Lifetime cost / MWh")).not.toBeInTheDocument();
  expect(screen.queryByText("Emissions")).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Show Natural Gas details" }),
  );

  expect(
    screen.getByRole("group", { name: "Generator advantages" }),
  ).toHaveTextContent("Fastest online");
  expect(screen.getByText("Estimated lifetime cost per MWh")).toBeVisible();
  expect(screen.getByText("Direct greenhouse gas emissions")).toBeVisible();
});

it("keeps the active lifetime-cost sort metric visible on collapsed cards", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 419000000, [], []).find(
    (candidate) => candidate.name === "Natural Gas",
  )!;

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator}
      location={game.location}
      seed={game.seed}
      secondaryMetric="lcWh"
      onBuild={jest.fn()}
    />,
  );

  expect(screen.getByText("Lifetime cost / MWh")).toBeVisible();
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

it("explains affordability and hides comparison when a build is disabled", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  const generator = GENERATORS(game, 419000000, [], []).find(
    (candidate) => candidate.name === "Natural Gas",
  )!;

  render(
    <GeneratorBuildItem
      cash={0}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator}
      location={game.location}
      seed={game.seed}
      onCompare={jest.fn()}
      onBuild={jest.fn()}
    />,
  );

  expect(screen.getByText(/Can't afford the loan down payment/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Compare Natural Gas/ }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Review purchase of Natural Gas" }),
  ).toBeDisabled();
});

it("explains unavailable technologies and hides their comparison button", () => {
  const game = createGame({ scenarioId: 100, difficulty: "CEO" });
  const availableGenerator = GENERATORS(game, 1000000, [], [500]).find(
    (candidate) => candidate.name === "Solar",
  )!;
  const generator = {
    ...availableGenerator,
    name: "Unavailable Solar",
    available: false,
  };

  render(
    <GeneratorBuildItem
      cash={1000000000}
      date={game.date}
      interestRate={game.interestRate}
      generator={generator}
      location={game.location}
      seed={game.seed}
      onCompare={jest.fn()}
      onBuild={jest.fn()}
    />,
  );

  expect(
    screen.getByText("Not available at this location or point in time."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Compare Unavailable Solar/ }),
  ).toBeNull();
  expect(
    screen.getByRole("button", {
      name: "Review purchase of Unavailable Solar",
    }),
  ).toBeDisabled();
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
