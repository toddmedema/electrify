import { getHydroAvailability, HYDRO_SITES } from "../../data/HydroSites";
import { LOCATIONS } from "../../Constants";
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
import * as ExpectedOutput from "../../helpers/ExpectedOutput";
import { SCENARIOS } from "../../data/Scenarios";
import { formatMoneyConcise } from "../../helpers/Format";
import {
  resilienceBuildOption,
  withResilienceOption,
} from "../../helpers/Hazards";
import { DOWNPAYMENT_PERCENT } from "../../Constants";
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
  expect(screen.queryByText(/Typical output/)).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Show Natural Gas details" }),
  );

  expect(
    screen.getByRole("row", {
      name: /Base O&M.*\$4\.93M/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Non-fuel start cost.*\$23\.1k\/start/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Estimated annual O&M.*\$13\.4M\/yr/,
    }),
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Review purchase of Natural Gas" }),
  );
  const impact = screen.getByRole("region", { name: "Expected impact" });
  expect(impact).not.toHaveTextContent("What changes");
  expect(impact).toHaveTextContent("Cash purchase");
  expect(impact).toHaveTextContent(/Loan option.*now \+.*\/mo/);
  expect(impact).toHaveTextContent("Estimated upkeep");
  expect(impact).toHaveTextContent("Online in");
  expect(impact).toHaveTextContent("Typical output");
  expect(impact).toHaveTextContent("weather may limit it");
  expect(impact).not.toHaveTextContent("largest forecast shortage");
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
}, 15000);

it("shows Coal's start charge without the representative-day breakdown", () => {
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
      name: /Non-fuel start cost.*\$52\.7k\/start/,
    }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Representative-day charge/)).toBeNull();
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
      name: /Fixed O&M.*\$3\.09M\/yr/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Variable O&M.*\$25\.71\/MWh/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", {
      name: /Estimated annual O&M.*\$7\.59M\/yr/,
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
  expect(screen.getByText("On demand")).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Available on demand." }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/largest forecast shortage/),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Build cost")).toBeInTheDocument();
  expect(screen.getByText("Build time")).toBeInTheDocument();
  expect(screen.queryByText("Fastest online")).not.toBeInTheDocument();
  expect(screen.queryByText("Cost per MWh")).not.toBeInTheDocument();
  expect(screen.queryByText("Emissions")).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Show Natural Gas details" }),
  );

  expect(
    screen.getByRole("group", { name: "Generator advantages" }),
  ).toHaveTextContent("Fastest online");
  expect(screen.getByText("Lifetime cost")).toBeVisible();
  expect(screen.getByText("Direct emissions")).toBeVisible();
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

  expect(screen.getByText("Cost per MWh")).toBeVisible();
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

  expect(
    screen.getByText(/cash needed to afford loan downpayment/),
  ).toBeVisible();
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

  expect(screen.getByText("Not available here yet.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Compare Unavailable Solar/ }),
  ).toBeNull();
  expect(
    screen.getByRole("button", {
      name: "Review purchase of Unavailable Solar",
    }),
  ).toBeDisabled();
});

it("draws each generator's typical year against one shared scale", () => {
  const game = createGame({ scenarioId: 100, difficulty: "Employee" });
  const monthly = jest.spyOn(ExpectedOutput, "expectedMonthlyOutputShape");
  render(
    <BuildGenerators
      game={game}
      onBack={jest.fn()}
      onBuildGenerator={jest.fn()}
    />,
  );

  const cards = screen.getAllByRole("button", {
    name: /^Review purchase of/,
  });
  // Once per generator in the list, not again inside each card
  expect(monthly).toHaveBeenCalledTimes(cards.length);
  monthly.mockRestore();

  expect(
    screen.getAllByRole("img", { name: /^Typical year|on demand/ }),
  ).toHaveLength(cards.length);
  expect(
    screen.getAllByRole("img", { name: /^Typical year: .*lowest in/ }).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText(/^Low [A-Z][a-z]{2} \d+%$/).length,
  ).toBeGreaterThan(0);
  expect(screen.getAllByText("On demand").length).toBeGreaterThan(0);
  expect(screen.getByText(/^Low [A-Z][a-z]{2} \d+% water in$/)).toBeVisible();
  expect(
    screen.getByRole("img", { name: /^Typical year of water inflow: / }),
  ).toBeInTheDocument();
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

it("keeps expanded details with their generator when tutorial choices expand", () => {
  const game = createGame({ scenarioId: 1 });
  game.tutorialStep = 1;
  const callbacks = { onBack: jest.fn(), onBuildGenerator: jest.fn() };
  const { rerender } = render(<BuildGenerators game={game} {...callbacks} />);
  expect(
    screen.getAllByRole("button", { name: /^Review purchase of/ }),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Show Wind details" }));
  rerender(
    <BuildGenerators game={{ ...game, tutorialStep: 2 }} {...callbacks} />,
  );
  expect(
    screen.getByRole("button", { name: "Hide Wind details" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.getAllByRole("button", { name: /^Hide .* details/ }),
  ).toHaveLength(1);
  expect(
    screen.getAllByRole("button", { name: /^Review purchase of/ }).length,
  ).toBeGreaterThan(3);
});

it("quotes a Hydro site maximum and updates the shared slider", () => {
  const game = createGame({ scenarioId: 104, difficulty: "CEO" });
  game.location = LOCATIONS.PIT;
  game.facilities = [];
  game.commissionedHydroSiteIds = [];
  const remaining = getHydroAvailability(game, 1000000).remaining;
  const site =
    remaining.find((site) => site.maxPeakW === 24000000) || remaining[0];
  expect(site).toBeDefined();
  game.commissionedHydroSiteIds = remaining
    .filter((candidate) => candidate.id !== site.id)
    .map((candidate) => candidate.id);
  game.timeline[0].cash = 1e12;
  const onBuild = jest.fn();
  render(
    <BuildGenerators
      game={game}
      onBack={jest.fn()}
      onBuildGenerator={onBuild}
    />,
  );
  const slider = screen.getByRole("slider");
  const before = slider.getAttribute("aria-valuenow");
  expect(
    screen.getByRole("button", { name: "Review purchase of Hydro" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Use site maximum" }));
  expect(slider).not.toHaveAttribute("aria-valuenow", before!);
  expect(
    screen.getByText(new RegExp("Site: " + HYDRO_SITES[site.id].name)),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Review purchase of Hydro" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Only cancelling before completion frees it",
  );
  fireEvent.click(screen.getByRole("button", { name: "Pay cash" }));
  expect(onBuild).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Hydro", peakW: site.maxPeakW }),
    false,
  );
});

it("updates fit counts and distinguishes exhausted and unavailable Hydro inventories", () => {
  const game = createGame({ scenarioId: 103 });
  game.facilities = [];
  game.commissionedHydroSiteIds = [];
  const onBuild = jest.fn();
  const { rerender } = render(
    <BuildGenerators
      game={game}
      onBack={jest.fn()}
      onBuildGenerator={onBuild}
    />,
  );
  const sites = getHydroAvailability(game, 1000000).remaining;
  expect(sites.length).toBeGreaterThan(0);
  game.commissionedHydroSiteIds = sites.map((site) => site.id);
  rerender(
    <BuildGenerators
      game={{ ...game }}
      onBack={jest.fn()}
      onBuildGenerator={onBuild}
    />,
  );
  expect(screen.getByText(/0 sites left · 0 fit/)).toBeInTheDocument();
  expect(
    screen.getByText(/All Hydro sites are used or reserved/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Review purchase of Hydro" }),
  ).toBeDisabled();
  game.location = { ...game.location, lat: game.location.lat + 1 };
  rerender(
    <BuildGenerators
      game={{ ...game }}
      onBack={jest.fn()}
      onBuildGenerator={onBuild}
    />,
  );
  expect(screen.getByText(/Hydro site data unavailable/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Review purchase of Hydro" }),
  ).toBeDisabled();
});

describe("weather hardening in the purchase dialog", () => {
  // Carbon Fee moved to Pittsburgh: a cold climate that also sees some hail
  function coldGame() {
    const scenario = SCENARIOS.find((candidate) => candidate.id === 100)!;
    const game = createGame({
      scenario: { ...scenario, locationId: "PIT" },
      scenarioId: 100,
    });
    game.timeline[0].cash = 1e12;
    return game;
  }

  function showBuildList(onBuild = jest.fn()) {
    render(
      <BuildGenerators
        game={coldGame()}
        onBack={jest.fn()}
        onBuildGenerator={onBuild}
      />,
    );
    return onBuild;
  }

  it("prices the default cold-weather package and builds without it when cleared", () => {
    const onBuild = showBuildList();
    fireEvent.click(
      screen.getByRole("button", { name: "Review purchase of Natural Gas" }),
    );
    const dialog = screen.getByRole("dialog");
    const option = within(dialog).getByRole("checkbox", {
      name: /^Cold-weather package \+\$/,
    });
    expect(option).toBeChecked();
    expect(option).toHaveAccessibleDescription(
      "Rated to \u221230°C instead of \u22128°C; halves losses below that. Recommended here: winters often drop below \u22128°C.",
    );
    const impact = within(dialog).getByRole("region", {
      name: "Expected impact",
    });
    const withPackage = impact.textContent;
    fireEvent.click(option);
    expect(impact.textContent).not.toEqual(withPackage);
    fireEvent.click(within(dialog).getByRole("button", { name: "Pay cash" }));
    const [quote, financed] = onBuild.mock.calls[0];
    expect(financed).toBe(false);
    expect(quote.fuel).toBe("Natural Gas");
    expect(quote.resilience).toEqual({
      coldWeatherPackage: false,
      designMinTempC: -8,
    });
    expect(quote.resilienceExtraBuildCost).toBeUndefined();
  });

  it("offers no cold-weather package where winters never get cold enough", () => {
    const game = createGame({ scenarioId: 100 });
    game.timeline[0].cash = 1e12;
    render(
      <BuildGenerators
        game={game}
        onBack={jest.fn()}
        onBuildGenerator={jest.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review purchase of Natural Gas" }),
    );
    expect(
      within(screen.getByRole("dialog")).queryByRole("checkbox", {
        name: /^Cold-weather package/,
      }),
    ).toBeNull();
  });

  it("offers hail-resistant solar as an opt-in that follows the quoted price", () => {
    const onBuild = showBuildList();
    fireEvent.click(
      screen.getByRole("button", { name: "Review purchase of Solar" }),
    );
    const dialog = screen.getByRole("dialog");
    const option = within(dialog).getByRole("checkbox", {
      name: /^Hail-resistant panels \+\$/,
    });
    expect(option).not.toBeChecked();
    fireEvent.click(option);
    fireEvent.click(within(dialog).getByRole("button", { name: "Pay cash" }));
    const [quote] = onBuild.mock.calls[0];
    expect(quote.resilience).toEqual({ hailResistant: true });
    expect(quote.resilienceExtraBuildCost).toBeGreaterThan(0);
    expect(option).toHaveAccessibleName(
      `Hail-resistant panels +${formatMoneyConcise(quote.resilienceExtraBuildCost)}`,
    );
  });

  it("describes hail-resistant panels' effect", () => {
    showBuildList();
    fireEvent.click(
      screen.getByRole("button", { name: "Review purchase of Solar" }),
    );
    const dialog = screen.getByRole("dialog");
    const option = within(dialog).getByRole("checkbox", {
      name: /^Hail-resistant panels \+\$/,
    });
    expect(option).toHaveAccessibleDescription("Less hail damage.");
  });

  function gasItem(cash: number, onBuild = jest.fn()) {
    const game = coldGame();
    const quote = GENERATORS(game, 419000000, [], []).find(
      (candidate) => candidate.name === "Natural Gas",
    )!;
    const option = resilienceBuildOption(quote, game)!;
    render(
      <GeneratorBuildItem
        cash={cash}
        date={game.date}
        interestRate={game.interestRate}
        generator={quote}
        location={game.location}
        seed={game.seed}
        resilienceOption={option}
        withResilience={(selected) =>
          withResilienceOption(quote, game, selected)
        }
        onBuild={onBuild}
      />,
    );
    return {
      packaged: withResilienceOption(quote, game, true),
      plain: withResilienceOption(quote, game, false),
      onBuild,
    };
  }

  it("keeps the card buyable when only the default package is unaffordable", () => {
    const game = coldGame();
    const quote = GENERATORS(game, 419000000, [], []).find(
      (candidate) => candidate.name === "Natural Gas",
    )!;
    const plainDownpayment =
      DOWNPAYMENT_PERCENT * withResilienceOption(quote, game, false).buildCost;
    const packagedDownpayment = DOWNPAYMENT_PERCENT * quote.buildCost;
    const cash = (plainDownpayment + packagedDownpayment) / 2;
    const { onBuild } = gasItem(cash);

    expect(screen.getByText("Incl. cold-weather package")).toBeVisible();
    const review = screen.getByRole("button", {
      name: "Review purchase of Natural Gas",
    });
    expect(review).toBeEnabled();
    fireEvent.click(review);
    const dialog = screen.getByRole("dialog");
    const option = within(dialog).getByRole("checkbox", {
      name: /^Cold-weather package/,
    });
    expect(option).toBeChecked();
    expect(option).toHaveAccessibleDescription(
      /Uncheck to afford the downpayment\.$/,
    );
    expect(
      within(dialog).getByText("Uncheck to afford the downpayment."),
    ).toHaveClass("resilienceBuildOptionWarning");
    expect(
      within(dialog).getByRole("button", { name: "Take loan" }),
    ).toBeDisabled();
    fireEvent.click(option);
    fireEvent.click(within(dialog).getByRole("button", { name: "Take loan" }));
    expect(onBuild).toHaveBeenCalledWith(true, false);
  });

  it("prices cash, downpayment and loan from the selected quote", () => {
    const cash = 1e12;
    const { packaged, plain, onBuild } = gasItem(cash);
    fireEvent.click(
      screen.getByRole("button", { name: "Review purchase of Natural Gas" }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show financing terms" }),
    );
    const downpayment = () =>
      within(
        within(dialog).getByRole("row", { name: /^Downpayment/ }),
      ).getAllByRole("cell")[1];
    const impact = within(dialog).getByRole("region", {
      name: "Expected impact",
    });
    expect(downpayment()).toHaveTextContent(
      formatMoneyConcise(DOWNPAYMENT_PERCENT * packaged.buildCost),
    );
    expect(impact).toHaveTextContent(
      `→ ${formatMoneyConcise(cash - packaged.buildCost)}`,
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /^Cold-weather package/ }),
    );
    expect(downpayment()).toHaveTextContent(
      formatMoneyConcise(DOWNPAYMENT_PERCENT * plain.buildCost),
    );
    expect(impact).toHaveTextContent(
      `→ ${formatMoneyConcise(cash - plain.buildCost)}`,
    );
    expect(impact).toHaveTextContent(
      `${formatMoneyConcise(DOWNPAYMENT_PERCENT * plain.buildCost)} now`,
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Take loan" }));
    expect(onBuild).toHaveBeenCalledWith(true, false);
  });

  it("offers no hardening for technologies without a modelled hazard", () => {
    showBuildList();
    fireEvent.click(
      screen.getByRole("button", { name: "Review purchase of Wind" }),
    );
    expect(
      within(screen.getByRole("dialog")).queryByRole("checkbox"),
    ).toBeNull();
  });
});
