import { fireEvent, render, screen } from "@testing-library/react";
import { getBuildAvailability, siteCountLabel } from "./BuildAvailability";
import { LocationType } from "../../Types";

const withHydro: LocationType = {
  id: "Madrid",
  name: "Madrid, Spain",
  lat: 40.4,
  long: -3.7,
  region: "Europe",
  country: "Spain",
  resources: { hydro: true, geothermal: false },
};

const hydroOption = {
  name: "Hydro",
  description: "Hydro description",
  available: true,
  sizeBuildable: true,
  maxSizeLabel: "10GW",
};

describe("getBuildAvailability", () => {
  test("offers a use max size action when the size is too large", () => {
    const onUseMaxSize = jest.fn();
    const result = getBuildAvailability({
      ...hydroOption,
      name: "Natural Gas",
      sizeBuildable: false,
      onUseMaxSize,
    });
    render(<>{result.secondaryText}</>);
    fireEvent.click(screen.getByRole("button", { name: "Use max size" }));
    expect(onUseMaxSize).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["prohibited", "prohibited"],
    ["unavailable", "data unavailable"],
    ["empty", "No qualifying"],
    ["exhausted", "used or reserved"],
    ["too-large", "Too large"],
  ] as const)("distinguishes Hydro %s", (status, message) => {
    const result = getBuildAvailability({
      ...hydroOption,
      hydroAvailability: {
        status,
        remaining: [],
        eligible: [],
        selected: undefined,
        largest: undefined,
      },
    });
    expect(result.buildable).toBe(false);
    expect(result.secondaryText).toContain(message);
  });

  test("pumped hydro names itself in the reason", () => {
    const result = getBuildAvailability({
      ...hydroOption,
      name: "Pumped Hydro",
      available: false,
      location: withHydro,
      viableLocationsRemaining: 0,
    });
    expect(result.secondaryText).toBe(
      "No pumped hydro sites near Madrid in this game.",
    );
  });

  test("a buildable option shows its description", () => {
    const result = getBuildAvailability({
      ...hydroOption,
      location: withHydro,
      hydroAvailability: {
        status: "available",
        remaining: [],
        eligible: [],
        selected: undefined,
        largest: undefined,
      },
    });
    expect(result).toEqual({
      buildable: true,
      secondaryText: "Hydro description",
    });
  });
});

test("site counts read as remaining of total", () => {
  expect(siteCountLabel({ remaining: 2, total: 3 })).toBe("2 of 3 sites left");
  expect(siteCountLabel({ remaining: 1, total: 1 })).toBe("1 of 1 site left");
  expect(siteCountLabel({ remaining: 1, total: 3 })).toBe("Last site left");
});
