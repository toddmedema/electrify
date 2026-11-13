import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../../testing/Simulator";
import { SCENARIOS } from "../../data/Scenarios";
import { STANDARD_GAS_DESIGN_MIN_TEMP_C } from "../../data/Hazards";
import { formatMoneyConcise } from "../../helpers/Format";
import {
  COLD_DEFINITION_ID,
  HAIL_DEFINITION_ID,
  retrofitCost,
} from "../../helpers/Hazards";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { FacilityOperatingType, GameType } from "../../Types";
import userEvent from "@testing-library/user-event";
import FacilityDetails from "./FacilityDetails";
import { UnitsContext } from "./UnitsContext";

// A dam's water section links to the manual, which reads the store; these tests have none
jest.mock("./ManualLink", () => (props: { children?: React.ReactNode }) => (
  <>{props.children}</>
));

// Carbon Fee: a non-tutorial game in San Francisco, starting with a gas plant
function carbonFee(): GameType {
  return createGame({ scenarioId: 100 });
}

// Carbon Fee moved to Pittsburgh, where winters can get cold enough to offer the gas package.
// The starting plant comes packaged there, so it is reset to a standard plant to retrofit.
function coldGame(): GameType {
  const scenario = SCENARIOS.find((candidate) => candidate.id === 100)!;
  const game = createGame({
    scenario: { ...scenario, locationId: "PIT" },
    scenarioId: 100,
  });
  game.facilities[0].resilience = {
    coldWeatherPackage: false,
    designMinTempC: STANDARD_GAS_DESIGN_MIN_TEMP_C,
  };
  return game;
}

function withSolar(game: GameType) {
  const solar = {
    ...cloneDeep(game.facilities[0]),
    id: 3,
    name: "Solar",
    fuel: "Sun",
    resilience: { solarTrackers: false },
  } as FacilityOperatingType;
  game.facilities.push(solar);
  return solar;
}

function details(
  game: GameType,
  facility: FacilityOperatingType,
  onRetrofit: jest.Mock,
  props: Partial<React.ComponentProps<typeof FacilityDetails>> = {},
) {
  return (
    <FacilityDetails
      facility={facility}
      date={game.date}
      seed={game.seed}
      location={game.location}
      game={game}
      onRetrofit={onRetrofit}
      {...props}
    />
  );
}

function showDetails(
  game: GameType,
  facility: FacilityOperatingType,
  props: Partial<React.ComponentProps<typeof FacilityDetails>> = {},
) {
  const onRetrofit = jest.fn();
  const { rerender } = render(details(game, facility, onRetrofit, props));
  return {
    onRetrofit,
    rerender: (next: GameType) =>
      rerender(details(next, facility, onRetrofit, props)),
  };
}

function outage(
  game: GameType,
  facility: FacilityOperatingType,
  hail: boolean,
  availableFraction: number,
  endsMinute = game.date.minute + MINUTES_PER_MONTH,
) {
  game.worldEvents.active.push({
    key: `${hail ? "hail" : "cold"}:SF:0:f${facility.id}`,
    definitionId: hail ? HAIL_DEFINITION_ID : COLD_DEFINITION_ID,
    startsMinute: game.date.minute,
    endsMinute,
    attributes: {},
    effects: {
      facilityOutputMultipliersById: {
        [String(facility.id)]: availableFraction,
      },
    },
  });
}

function section() {
  return screen.getByRole("region", { name: "Upgrades" });
}

describe("weather resilience details", () => {
  it("rates standard gas and offers the cold-weather package", () => {
    const game = coldGame();
    const gas = game.facilities[0];
    showDetails(game, gas);
    expect(section()).not.toHaveTextContent("Standard winterization");
    expect(section()).not.toHaveTextContent("Rated to −8°C");
    const cost = retrofitCost(gas, game, "coldWeatherPackage")!;
    expect(
      within(section()).getByRole("button", {
        name: `Add cold-weather package · ${formatMoneyConcise(cost)}`,
      }),
    ).toBeEnabled();
  });

  it("says how much cash a retrofit still needs and ties it to the button", () => {
    const game = coldGame();
    const gas = game.facilities[0];
    const cost = retrofitCost(gas, game, "coldWeatherPackage")!;
    game.timeline[0].cash = cost - 1000000;
    showDetails(game, gas);
    const button = within(section()).getByRole("button", {
      name: /^Add cold-weather package/,
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      `${formatMoneyConcise(1000000)} more cash needed`,
    );
  });

  it("disables Pay when cash falls short while the dialog is open", () => {
    const game = coldGame();
    const gas = game.facilities[0];
    const cost = retrofitCost(gas, game, "coldWeatherPackage")!;
    const { onRetrofit, rerender } = showDetails(game, gas);
    fireEvent.click(
      within(section()).getByRole("button", {
        name: /^Add cold-weather package/,
      }),
    );
    const poorer = cloneDeep(game);
    poorer.timeline[0].cash = cost - 2000000;
    rerender(poorer);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      `${formatMoneyConcise(2000000)} more cash needed.`,
    );
    const pay = within(dialog).getByRole("button", { name: /^Pay / });
    expect(pay).toBeDisabled();
    fireEvent.click(pay);
    expect(onRetrofit).not.toHaveBeenCalled();
  });

  it("confirms a winterization retrofit and moves focus after paying", () => {
    const game = coldGame();
    const gas = game.facilities[0];
    const cost = retrofitCost(gas, game, "coldWeatherPackage")!;
    const { onRetrofit } = showDetails(game, gas);
    fireEvent.click(
      within(section()).getByRole("button", {
        name: `Add cold-weather package · ${formatMoneyConcise(cost)}`,
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: `Add cold-weather package to ${gas.name}?`,
    });
    // Staged work, the premium over building it in and the way out
    expect(dialog).toHaveTextContent(
      "Staged installation keeps 90% of capacity available for a month. Adding it now costs 50% more than building it in. Cancel before it's done for a full refund.",
    );
    expect(dialog).not.toHaveTextContent("cash now");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: `Pay ${formatMoneyConcise(cost)}`,
      }),
    );
    expect(onRetrofit).toHaveBeenCalledWith({
      facilityId: gas.id,
      upgrade: "coldWeatherPackage",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Upgrades" })).toHaveFocus();
  });

  it("closes on Cancel without buying anything", () => {
    const game = coldGame();
    const { onRetrofit } = showDetails(game, game.facilities[0]);
    fireEvent.click(
      within(section()).getByRole("button", {
        name: /^Add cold-weather package/,
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onRetrofit).not.toHaveBeenCalled();
  });

  it("says a current outage continues after a retrofit", async () => {
    const game = coldGame();
    const gas = game.facilities[0];
    outage(game, gas, false, 0.55);
    showDetails(game, gas);
    await userEvent.click(
      within(section()).getByRole("button", {
        name: /^Add cold-weather package/,
      }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Doesn't end this month's cold outage.",
    );
  });

  it("reports a retrofit being installed and offers no second one", () => {
    const game = coldGame();
    const gas = game.facilities[0];
    (gas as { upgradeInProgress?: object }).upgradeInProgress = {
      upgrade: "coldWeatherPackage",
      cost: 1e6,
      startsMinute: game.date.minute - MINUTES_PER_MONTH / 4,
      completesMinute: game.date.minute + (MINUTES_PER_MONTH * 3) / 4,
    };
    showDetails(game, gas);
    expect(section()).toHaveTextContent(
      "Installing cold-weather package90% capacity available · 25% installed",
    );
    expect(
      screen.queryByRole("button", { name: /^Add cold-weather package/ }),
    ).toBeNull();
  });

  it("describes tracker gain as annual energy on a tracked solar farm", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    solar.resilience = {
      solarTrackers: true,
      trackerHailDamageFactor: 0.5,
    };
    showDetails(game, solar);
    expect(section()).toHaveTextContent(
      "Solar trackersAbout 20% more energy a year, mostly in the morning and evening.",
    );
    expect(section()).toHaveTextContent(
      "About 20% more energy a year, mostly in the morning and evening.",
    );
  });

  it("offers no retrofit while a plant is under construction", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    solar.yearsToBuildLeft = 1;
    const view = render(details(game, solar, jest.fn()));
    expect(screen.queryByRole("region", { name: "Operation" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Economics" })).toBeNull();
    view.rerender(details(game, { ...solar, yearsToBuildLeft: 0 }, jest.fn()));
    expect(
      screen.getByRole("region", { name: "Operation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Economics" }),
    ).toBeInTheDocument();
    view.rerender(details(game, solar, jest.fn()));
    expect(screen.queryByRole("region", { name: "Upgrades" })).toBeNull();
  });

  it("gives design temperatures in the player's units with a true minus", async () => {
    const game = coldGame();
    const gas = game.facilities[0];
    render(
      <UnitsContext.Provider value="imperial">
        {details(game, gas, jest.fn())}
      </UnitsContext.Provider>,
    );
    // -8°C is 17.6°F, rounded to 18°F; Pittsburgh's package rating of -30°C is -22°F
    expect(section()).not.toHaveTextContent("Rated to 18°F");
    await userEvent.click(
      within(section()).getByRole("button", {
        name: /^Add cold-weather package/,
      }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Rated to \u221222°F instead of 18°F; halves remaining cold losses and deep-freeze losses.",
    );
  });

  it("reports an active hail outage and when repairs finish", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    solar.annualOutputDegradation = 0;
    outage(
      game,
      solar,
      true,
      0.6,
      game.date.minute + Math.floor((4 * MINUTES_PER_MONTH) / (365 / 12)),
    );
    showDetails(game, solar);
    const operation = screen.getByRole("region", { name: "Operation" });
    expect(operation).toHaveTextContent("Hail damage");
    expect(operation).toHaveTextContent("60% available");
    expect(operation).toHaveTextContent("4 days to repair");
    expect(operation).toHaveTextContent("Current max output");
    expect(operation).toHaveTextContent("(60%)");
  });

  it("includes an active event in the maximum output shown for an aging plant", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    solar.peakW = 300e6;
    solar.annualOutputDegradation = 0.005;
    solar.minuteOperational = game.date.minute - 0.7 * 12 * MINUTES_PER_MONTH;
    game.worldEvents.active.push({
      key: "wildfire:active",
      definitionId: "wildfire-incident",
      startsMinute: game.date.minute,
      endsMinute: game.date.minute + MINUTES_PER_MONTH,
      attributes: {},
      effects: { facilityOutputMultipliersByFuel: { Sun: 0.54 } },
    });

    showDetails(game, solar);

    const operation = screen.getByRole("region", { name: "Operation" });
    const stats = within(operation).getAllByRole("term");
    expect(stats[0]).toHaveTextContent("Capacity");
    expect(stats[1]).toHaveTextContent("Current max output");
    expect(within(operation).getAllByRole("definition")[1]).toHaveTextContent(
      "161MW (54%)",
    );
  });

  it("reports an extreme-cold outage until month end", () => {
    const game = carbonFee();
    const gas = game.facilities[0];
    gas.annualOutputDegradation = 0;
    outage(game, gas, false, 0.55);
    showDetails(game, gas);
    const operation = screen.getByRole("region", { name: "Operation" });
    expect(operation).toHaveTextContent("Extreme cold");
    expect(operation).toHaveTextContent("55% available");
    expect(operation).toHaveTextContent("Until month end");
    expect(operation).toHaveTextContent("(55%)");
  });

  it("combines age wear with hail damage in the maximum output", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    // Two per cent a year for about ten years leaves about 82%; 60% of that is about 49%
    solar.peakW = 100e6;
    solar.annualOutputDegradation = 0.02;
    solar.minuteOperational = game.date.minute - 10 * 12 * MINUTES_PER_MONTH;
    outage(game, solar, true, 0.6);
    showDetails(game, solar);
    const operation = screen.getByRole("region", { name: "Operation" });
    expect(operation).toHaveTextContent("49MW");
    expect(operation).toHaveTextContent("(49%)");
  });

  it("combines event limits by fuel and facility, including a complete outage", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    solar.peakW = 300e6;
    solar.annualOutputDegradation = 0;
    const event = {
      key: "wildfire:active",
      definitionId: "wildfire-incident",
      startsMinute: game.date.minute,
      endsMinute: game.date.minute + MINUTES_PER_MONTH,
      attributes: {},
      effects: {
        facilityOutputMultipliersByFuel: { Sun: 0.5 },
        facilityOutputMultipliersById: { [String(solar.id)]: 0.6 },
      },
    };
    game.worldEvents.active.push(event);
    const { rerender } = showDetails(game, solar);
    const operation = () => screen.getByRole("region", { name: "Operation" });
    expect(operation()).toHaveTextContent("90MW");
    expect(operation()).toHaveTextContent("(30%)");

    const outageGame = cloneDeep(game);
    outageGame.worldEvents.active.find(
      (active) => active.key === event.key,
    )!.effects.facilityOutputMultipliersById = {
      [String(solar.id)]: 0,
    };
    rerender(outageGame);
    expect(operation()).toHaveTextContent("0W");
    expect(operation()).toHaveTextContent("(0%)");
  });

  it("leaves future and expired event limits out of the maximum output", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    solar.annualOutputDegradation = 0;
    game.worldEvents.active.push(
      ...[-1, 1].map((offset) => ({
        key: `wildfire:${offset}`,
        definitionId: "wildfire-incident",
        startsMinute: game.date.minute + offset * MINUTES_PER_MONTH,
        endsMinute: game.date.minute + (offset + 1) * MINUTES_PER_MONTH,
        attributes: {},
        effects: { facilityOutputMultipliersByFuel: { Sun: 0.54 } },
      })),
    );
    showDetails(game, solar);
    expect(screen.queryByText("Current max output")).toBeNull();
  });

  it("does not round small age wear up to an unrestricted 100%", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    solar.peakW = 300e6;
    solar.annualOutputDegradation = 0.005;
    solar.minuteOperational = game.date.minute - 0.7 * 12 * MINUTES_PER_MONTH;
    showDetails(game, solar);
    const operation = screen.getByRole("region", { name: "Operation" });
    expect(operation).toHaveTextContent("299MW");
    expect(operation).toHaveTextContent("(<100%)");
  });

  it("leaves gas out where winters never get cold enough to matter", () => {
    const game = carbonFee();
    showDetails(game, game.facilities[0]);
    expect(screen.queryByRole("region", { name: "Upgrades" })).toBeNull();
  });

  it("leaves the section out of tutorials, which have no weather hazards", () => {
    const game = createGame({ scenarioId: 1 });
    const gas = game.facilities.find((f) => f.fuel === "Natural Gas");
    showDetails(game, gas || withSolar(game));
    expect(screen.queryByRole("region", { name: "Upgrades" })).toBeNull();
  });
});

describe("fixed upkeep", () => {
  // Heatwave + Drought starts with a dam, a solar farm, a wind farm and a battery: none of them
  // pays per MWh, so their annual cost is the only upkeep and was missing from the details
  it.each([
    ["Hydro", (f: FacilityOperatingType) => f.fuel === "Hydro"],
    ["Solar", (f: FacilityOperatingType) => f.fuel === "Sun"],
    ["Wind", (f: FacilityOperatingType) => f.fuel === "Wind"],
    ["Battery", (f: FacilityOperatingType) => f.name === "Battery"],
  ])("lists a %s facility's annual upkeep", (_name, matches) => {
    const game = createGame({ scenarioId: 108 });
    const facility = game.facilities.find(matches)!;
    expect(facility.variableOperatingCostPerMWh).toBeUndefined();
    expect(facility.annualOperatingCost).toBeGreaterThan(0);
    showDetails(game, facility);
    const economics = screen.getByRole("region", { name: "Economics" });
    expect(economics).toHaveTextContent(
      `Fixed upkeep${formatMoneyConcise(facility.annualOperatingCost)}/yr`,
    );
    expect(economics).not.toHaveTextContent("Variable upkeep");
    expect(economics).not.toHaveTextContent("while paused");
  });

  // The tick charges a paused facility half its fixed cost (FacilityLifetime.test.tsx pins that),
  // so the row must not present the full annual figure as what a paused plant is paying
  it("shows half the fixed upkeep, and says why, while a facility is paused", () => {
    const game = createGame({ scenarioId: 108 });
    const solar = game.facilities.find((f) => f.fuel === "Sun")!;
    solar.paused = true;
    showDetails(game, solar);
    const economics = screen.getByRole("region", { name: "Economics" });
    expect(economics).toHaveTextContent(
      `Fixed upkeep${formatMoneyConcise(solar.annualOperatingCost / 2)}/yr · half rate while paused`,
    );
    expect(economics).not.toHaveTextContent(
      `${formatMoneyConcise(solar.annualOperatingCost)}/yr`,
    );
  });

  it("still lists the variable part beside it for a fuel plant", () => {
    const game = carbonFee();
    const gas = game.facilities[0];
    expect(gas.variableOperatingCostPerMWh).toBeDefined();
    showDetails(game, gas);
    const economics = screen.getByRole("region", { name: "Economics" });
    expect(economics).toHaveTextContent(
      `Fixed upkeep${formatMoneyConcise(gas.annualOperatingCost)}/yr`,
    );
    expect(economics).toHaveTextContent("Variable upkeep");
  });
});

it("shows the monthly cleanup charge without ordinary upkeep", () => {
  const game = carbonFee();
  const facility = game.facilities[0];
  facility.paused = true;
  facility.maintenanceObligation = {
    startsMonth: 1,
    monthlyCost: 2e6,
    reason: "Cleanup and recovery",
  };
  render(
    <FacilityDetails
      facility={facility}
      date={game.date}
      seed={game.seed}
      location={game.location}
      game={game}
    />,
  );
  expect(screen.getByText("Cleanup and recovery")).toBeInTheDocument();
  expect(screen.getByText("$2M/mo", { exact: false })).toBeInTheDocument();
  expect(screen.queryByText("Fixed upkeep")).not.toBeInTheDocument();
});

it("dates a cleanup charge before it begins", () => {
  const game = createGame({ scenarioId: 126 });
  const unit = game.facilities.find(
    (facility) => facility.startingAssetId === "chernobyl-unit-4",
  )!;
  showDetails(game, unit);
  expect(
    screen.getByText("$250M/mo · $3B/yr from Apr 1986", { exact: false }),
  ).toBeInTheDocument();
});

it("hides retrofit actions after permanent shutdown", () => {
  const game = coldGame();
  const facility = game.facilities[0];
  facility.permanentShutdownMonth = 1;
  facility.paused = true;
  showDetails(game, facility);
  expect(
    screen.queryByRole("region", { name: "Upgrades" }),
  ).not.toBeInTheDocument();
});
