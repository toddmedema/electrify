import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CityType } from "../../data/Cities";
import { WORLD_LAND_PATH } from "../../data/WorldLand";
import LocationPicker from "./LocationPicker";

const cities: CityType[] = [
  {
    id: "west",
    name: "West City",
    lat: 35,
    long: -120,
    region: "North America",
    country: "United States",
  },
  {
    id: "east",
    name: "East City",
    lat: 40,
    long: 80,
    region: "East Asia",
    country: "Exampleland",
  },
];

it("combines the selected city and search in one field on an aligned detailed map", () => {
  render(
    <LocationPicker
      locations={cities}
      value={cities[0]}
      onChange={jest.fn()}
    />,
  );

  expect(
    screen.getByRole("combobox", { name: "Search playable cities" }),
  ).toHaveValue("West City");
  expect(screen.queryByLabelText("Selected location")).not.toBeInTheDocument();
  expect(screen.queryByText(/Choose a playable city/)).not.toBeInTheDocument();
  expect(WORLD_LAND_PATH.match(/M/g)?.length).toBeGreaterThan(100);
  expect(
    screen.getByRole("button", { name: /Select West City/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const locationControls = screen
    .getAllByRole("button")
    .filter((button) => button.classList.contains("worldMapMarker"));
  expect(
    locationControls.filter((button) => button.tabIndex === 0),
  ).toHaveLength(1);
});

it("selects the same city from the map and searchable list", async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  const { rerender } = render(
    <LocationPicker locations={cities} value={cities[0]} onChange={onChange} />,
  );

  await user.click(screen.getByRole("button", { name: /Select East City/ }));
  expect(onChange).toHaveBeenLastCalledWith(cities[1]);

  rerender(
    <LocationPicker locations={cities} value={cities[1]} onChange={onChange} />,
  );
  const search = screen.getByRole("combobox", {
    name: "Search playable cities",
  });
  await user.click(search);
  fireEvent.change(search, { target: { value: "West" } });
  await user.click(await screen.findByRole("option", { name: "West City" }));
  expect(onChange).toHaveBeenLastCalledWith(cities[0]);
});

it("supports arrow navigation, Enter and Space activation, and Home", () => {
  const onChange = jest.fn();
  render(
    <LocationPicker locations={cities} value={cities[0]} onChange={onChange} />,
  );
  const west = screen.getByRole("button", { name: /Select West City/ });
  const east = screen.getByRole("button", { name: /Select East City/ });
  act(() => west.focus());
  fireEvent.keyDown(west, { key: "ArrowRight" });
  expect(east).toHaveFocus();
  fireEvent.keyDown(east, { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith(cities[1]);
  act(() => west.focus());
  fireEvent.keyDown(west, { key: " " });
  expect(onChange).toHaveBeenCalledWith(cities[0]);
  fireEvent.keyDown(east, { key: "Home" });
  expect(screen.getByText("Showing the whole world")).toBeInTheDocument();
});

it("pans with scrolling while zoomed", () => {
  render(
    <LocationPicker
      locations={cities}
      value={cities[0]}
      onChange={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  const map = screen.getByRole("group", { name: "Playable locations map" });
  const content = screen.getByTestId("world-map-content");
  const before = content.getAttribute("transform");

  fireEvent.wheel(map, { deltaX: -30, deltaY: -20 });
  expect(content).not.toHaveAttribute("transform", before);
});

it("drills into a cluster and lists unresolved cities at maximum zoom", async () => {
  const user = userEvent.setup();
  const closeCities: CityType[] = [
    cities[0],
    ...["one", "two", "three"].map((id) => ({
      id,
      name: `Close ${id}`,
      lat: 40,
      long: 80,
      region: "East Asia",
      country: "Exampleland",
    })),
  ];
  const onChange = jest.fn();
  render(
    <LocationPicker
      locations={closeCities}
      value={closeCities[0]}
      onChange={onChange}
    />,
  );

  for (let level = 0; level < 4; level += 1) {
    await user.click(
      screen.getByRole("button", { name: /Zoom to 3 locations/ }),
    );
  }
  await user.click(screen.getByRole("menuitem", { name: /Close two/ }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ id: "two", name: "Close two" }),
  );
});
