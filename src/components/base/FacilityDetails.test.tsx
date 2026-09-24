import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../../testing/Simulator";
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
  return screen.getByRole("region", { name: "Weather resilience" });
}

describe("weather resilience details", () => {
  it("rates standard gas and offers the cold-weather package", () => {
    const game = carbonFee();
    const gas = game.facilities[0];
    showDetails(game, gas);
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

  it("says how much cash a retrofit still needs and ties it to the button", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    const cost = retrofitCost(solar, game, "hailResistant")!;
    game.timeline[0].cash = cost - 1000000;
    showDetails(game, solar);
    const button = within(section()).getByRole("button", {
      name: /^Add hail-resistant panels/,
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      `${formatMoneyConcise(1000000)} more cash needed`,
    );
  });

  it("disables Pay when cash falls short while the dialog is open", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    const cost = retrofitCost(solar, game, "hailResistant")!;
    const { onRetrofit, rerender } = showDetails(game, solar);
    fireEvent.click(
      within(section()).getByRole("button", {
        name: /^Add hail-resistant panels/,
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

  it("confirms a hail retrofit with the insurance change and moves focus after paying", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    const cost = retrofitCost(solar, game, "hailResistant")!;
    const { onRetrofit } = showDetails(game, solar);
    fireEvent.click(
      within(section()).getByRole("button", {
        name: `Add hail-resistant panels · ${formatMoneyConcise(cost)}`,
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Add hail-resistant panels to Solar?",
    });
    expect(dialog).toHaveTextContent("Future hail breaks less of the array.");
    expect(dialog).toHaveTextContent(/Weather insurance \$.+ → \$.+\/yr/);
    expect(dialog).not.toHaveTextContent("cash now");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: `Pay ${formatMoneyConcise(cost)}`,
      }),
    );
    expect(onRetrofit).toHaveBeenCalledWith({
      facilityId: solar.id,
      upgrade: "hailResistant",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Weather resilience" }),
    ).toHaveFocus();
  });

  it("closes on Cancel without buying anything", () => {
    const game = carbonFee();
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
    const game = carbonFee();
    const gas = game.facilities[0];
    outage(game, gas, false, 0.55);
    showDetails(game, gas);
    await userEvent.click(
      within(section()).getByRole("button", {
        name: /^Add cold-weather package/,
      }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "This month's cold outage continues.",
    );
  });

  it("says current hail damage is still repaired on schedule", async () => {
    const game = carbonFee();
    const solar = withSolar(game);
    outage(game, solar, true, 0.7);
    showDetails(game, solar);
    await userEvent.click(
      within(section()).getByRole("button", {
        name: /^Add hail-resistant panels/,
      }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Current damage is still repaired on schedule.",
    );
  });

  it("offers no retrofit while a plant is under construction", () => {
    const game = carbonFee();
    const solar = withSolar(game);
    solar.yearsToBuildLeft = 1;
    showDetails(game, solar);
    expect(
      screen.queryByRole("button", { name: /^Add hail-resistant panels/ }),
    ).toBeNull();
  });

  it("gives design temperatures in the player's units with a true minus", async () => {
    const game = carbonFee();
    const gas = game.facilities[0];
    render(
      <UnitsContext.Provider value="imperial">
        {details(game, gas, jest.fn())}
      </UnitsContext.Provider>,
    );
    // -8°C is 17.6°F, rounded to 18°F; the package's -25°C is -13°F
    expect(section()).toHaveTextContent("Rated to 18°F");
    await userEvent.click(
      within(section()).getByRole("button", {
        name: /^Add cold-weather package/,
      }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Runs down to \u221213°F instead of 18°F.",
    );
  });

  it("reports installed protection and stops offering it", () => {
    const game = carbonFee();
    const solar = withSolar(game, true);
    showDetails(game, solar);
    expect(section()).toHaveTextContent("Hail-resistant panels");
    expect(section()).toHaveTextContent(/Weather insurance.*\/yr/);
    expect(section()).toHaveTextContent("Charged with upkeep");
    expect(within(section()).queryByRole("button")).toBeNull();
  });

  it("reports an active hail outage and when repairs finish", () => {
    const game = carbonFee();
    const solar = withSolar(game);
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
  });

  it("reports an extreme-cold outage until month end", () => {
    const game = carbonFee();
    const gas = game.facilities[0];
    outage(game, gas, false, 0.55);
    showDetails(game, gas);
    const operation = screen.getByRole("region", { name: "Operation" });
    expect(operation).toHaveTextContent("Extreme cold");
    expect(operation).toHaveTextContent("55% available");
    expect(operation).toHaveTextContent("Until month end");
  });

  it("hides the purchase in a replay", () => {
    const game = carbonFee();
    showDetails(game, game.facilities[0], { readOnly: true });
    expect(section()).toHaveTextContent("Standard winterization");
    expect(within(section()).queryByRole("button")).toBeNull();
  });

  it("leaves the section out of tutorials, which have no weather hazards", () => {
    const game = createGame({ scenarioId: 1 });
    const gas = game.facilities.find((f) => f.fuel === "Natural Gas");
    showDetails(game, gas || withSolar(game));
    expect(
      screen.queryByRole("region", { name: "Weather resilience" }),
    ).toBeNull();
  });
});
