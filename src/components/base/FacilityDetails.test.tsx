import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../../testing/Simulator";
import { formatMoneyConcise } from "../../helpers/Format";
import { HAIL_DEFINITION_ID, retrofitCost } from "../../helpers/Hazards";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { FacilityOperatingType, GameType } from "../../Types";
import FacilityDetails from "./FacilityDetails";

// Carbon Fee: a non-tutorial game in San Francisco, starting with a gas plant
function carbonFee(): GameType {
  return createGame({ scenarioId: 100 });
}

function withSolar(game: GameType, hailResistant = false) {
  const solar = {
    ...cloneDeep(game.facilities[0]),
    id: 3,
    name: "Solar",
    fuel: "Sun",
    resilience: { hailResistant },
  } as FacilityOperatingType;
  game.facilities.push(solar);
  return solar;
}

function renderDetails(
  game: GameType,
  facility: FacilityOperatingType,
  props: Partial<React.ComponentProps<typeof FacilityDetails>> = {},
) {
  const onRetrofit = jest.fn();
  render(
    <FacilityDetails
      facility={facility}
      date={game.date}
      seed={game.seed}
      location={game.location}
      game={game}
      onRetrofit={onRetrofit}
      {...props}
    />,
  );
  return onRetrofit;
}

function section() {
  return screen.getByRole("region", { name: "Weather resilience" });
}

describe("weather resilience details", () => {
  it("rates standard gas and offers the cold-weather package", () => {
    const game = carbonFee();
    const gas = game.facilities[0];
    renderDetails(game, gas);
    expect(section()).toHaveTextContent("Standard winterization");
    expect(section()).toHaveTextContent("Rated to −8°C");
    // Cold costs gas plants output rather than assets, so there is no premium to show
    expect(section()).not.toHaveTextContent("Weather insurance");
    const cost = retrofitCost(gas, game, "coldWeatherPackage")!;
    expect(
      within(section()).getByRole("button", {
        name: `Add cold-weather package · ${formatMoneyConcise(cost)}`,
      }),
    ).toBeEnabled();
  });

  it("says how much cash a retrofit still needs", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    const cost = retrofitCost(solar, game, "hailResistant")!;
    game.timeline[0].cash = cost - 1000000;
    renderDetails(game, solar);
    expect(
      within(section()).getByRole("button", { name: /^Add hail protection/ }),
    ).toBeDisabled();
    expect(section()).toHaveTextContent(
      `Needs ${formatMoneyConcise(1000000)} more cash.`,
    );
  });

  it("reports installed protection and stops offering it", () => {
    const game = carbonFee();
    const solar = withSolar(game, true);
    renderDetails(game, solar);
    expect(section()).toHaveTextContent("Hail-resistant panels");
    expect(section()).toHaveTextContent(/Weather insurance.*\/yr/);
    expect(section()).toHaveTextContent("Charged with upkeep");
    expect(within(section()).queryByRole("button")).toBeNull();
  });

  it("reports an active hail outage and when repairs finish", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    game.worldEvents.active.push({
      key: "hail:SF:0:f3",
      definitionId: HAIL_DEFINITION_ID,
      startsMinute: game.date.minute,
      endsMinute:
        game.date.minute + Math.floor((4 * MINUTES_PER_MONTH) / (365 / 12)),
      attributes: {},
      effects: { facilityOutputMultipliersById: { "3": 0.6 } },
    });
    renderDetails(game, solar);
    const operation = screen.getByRole("region", { name: "Operation" });
    expect(operation).toHaveTextContent("Hail damage");
    expect(operation).toHaveTextContent("60% available");
    expect(operation).toHaveTextContent("Repaired in 4 days");
  });

  it("hides the purchase in a replay", () => {
    const game = carbonFee();
    renderDetails(game, game.facilities[0], { readOnly: true });
    expect(section()).toHaveTextContent("Standard winterization");
    expect(within(section()).queryByRole("button")).toBeNull();
  });

  it("leaves the section out of tutorials, which have no weather hazards", () => {
    const game = createGame({ scenarioId: 1 });
    const gas = game.facilities.find((f) => f.fuel === "Natural Gas");
    renderDetails(game, gas || withSolar(game));
    expect(
      screen.queryByRole("region", { name: "Weather resilience" }),
    ).toBeNull();
  });
});
