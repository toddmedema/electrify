import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CityType } from "../../data/Cities";
import { WORLD_LAND_PATH } from "./WorldLand";
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

function firePointer(
  element: Element,
  type: string,
  init: MouseEventInit & { pointerId: number },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  fireEvent(element, event);
}

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

it("keeps a marker click out of the pan gesture after zooming", async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  render(
    <LocationPicker locations={cities} value={cities[0]} onChange={onChange} />,
  );

  await user.click(screen.getByRole("button", { name: "Zoom in" }));
  const map = screen.getByRole("group", { name: "Playable locations map" });
  const setPointerCapture = jest.fn();
  Object.defineProperty(map, "setPointerCapture", {
    configurable: true,
    value: setPointerCapture,
  });
  const east = screen.getByRole("button", { name: /Select East City/ });

  firePointer(east, "pointerdown", {
    pointerId: 1,
    button: 0,
    clientX: 300,
    clientY: 150,
  });
  expect(setPointerCapture).not.toHaveBeenCalled();
  await user.click(east);
  expect(onChange).toHaveBeenCalledWith(cities[1]);
});

it("captures wheel gestures inside the map", () => {
  render(
    <LocationPicker
      locations={cities}
      value={cities[0]}
      onChange={jest.fn()}
    />,
  );

  const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true });
  screen
    .getByRole("group", { name: "Playable locations map" })
    .dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true);
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

it("zooms in and out with the scroll wheel", () => {
  render(
    <LocationPicker
      locations={cities}
      value={cities[0]}
      onChange={jest.fn()}
    />,
  );
  const map = screen.getByRole("group", { name: "Playable locations map" });
  const content = screen.getByTestId("world-map-content");
  const before = content.getAttribute("transform");

  fireEvent.wheel(map, { deltaY: -100, clientX: 300, clientY: 150 });
  expect(content).not.toHaveAttribute("transform", before);
  expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();

  fireEvent.wheel(map, { deltaY: 100, clientX: 300, clientY: 150 });
  expect(content).toHaveAttribute("transform", before);
  expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
});

it("zooms with a two-pointer pinch gesture and restores marker clicks", async () => {
  const onChange = jest.fn();
  render(
    <LocationPicker locations={cities} value={cities[0]} onChange={onChange} />,
  );
  const map = screen.getByRole("group", { name: "Playable locations map" });
  const content = screen.getByTestId("world-map-content");
  const before = content.getAttribute("transform");

  firePointer(map, "pointerdown", {
    pointerId: 1,
    button: 0,
    clientX: 200,
    clientY: 150,
  });
  firePointer(map, "pointerdown", {
    pointerId: 2,
    button: 0,
    clientX: 400,
    clientY: 150,
  });
  firePointer(map, "pointermove", {
    pointerId: 2,
    clientX: 480,
    clientY: 150,
  });

  expect(content).not.toHaveAttribute("transform", before);
  expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();

  firePointer(map, "pointerup", {
    pointerId: 2,
    clientX: 480,
    clientY: 150,
  });
  firePointer(map, "pointerup", {
    pointerId: 1,
    clientX: 200,
    clientY: 150,
  });
  await act(() => new Promise((resolve) => window.setTimeout(resolve, 0)));
  fireEvent.click(screen.getByRole("button", { name: /Select East City/ }));
  expect(onChange).toHaveBeenCalledWith(cities[1]);
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

  for (let level = 0; level < 5; level += 1) {
    await user.click(
      screen.getByRole("button", { name: /Zoom to 3 locations/ }),
    );
  }
  await user.click(screen.getByRole("menuitem", { name: /Close two/ }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ id: "two", name: "Close two" }),
  );
});

describe("finding the nearest city", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
  let success: PositionCallback;
  let failure: PositionErrorCallback;
  let locate: jest.Mock;
  beforeEach(() => {
    locate = jest.fn((yes: PositionCallback, no: PositionErrorCallback) => {
      success = yes;
      failure = no;
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: locate },
    });
  });
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "geolocation", original);
    else Reflect.deleteProperty(navigator, "geolocation");
  });
  const result = {
    coords: { latitude: 36, longitude: -121 },
  } as GeolocationPosition;
  it("requests permission only on click and selects the closest existing city", () => {
    const onChange = jest.fn();
    render(
      <LocationPicker locations={cities} allowNearest onChange={onChange} />,
    );
    expect(locate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Find nearest city" }));
    expect(locate).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Finding your location…" }),
    ).toBeDisabled();
    act(() => success(result));
    expect(onChange).toHaveBeenCalledWith(cities[0]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Closest available city: West City",
    );
  });
  it.each([1, 2, 3])(
    "keeps manual selection usable after geolocation error %s",
    (code) => {
      const onChange = jest.fn();
      render(
        <LocationPicker
          locations={cities}
          value={cities[1]}
          allowNearest
          onChange={onChange}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Find nearest city" }),
      );
      act(() => failure({ code } as GeolocationPositionError));
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent(
        /Search for a city|search for a city/,
      );
      expect(
        screen.getByRole("button", { name: "Find nearest city" }),
      ).toBeEnabled();
      expect(screen.getByRole("combobox")).toHaveValue("East City");
    },
  );
  it("ignores a pending response after a manual choice or leaving the page", () => {
    const onChange = jest.fn();
    const view = render(
      <LocationPicker locations={cities} allowNearest onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Find nearest city" }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "East City" },
    });
    fireEvent.click(screen.getByRole("option", { name: /East City/ }));
    act(() => success(result));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(cities[1]);
    fireEvent.click(screen.getByRole("button", { name: "Find nearest city" }));
    view.unmount();
    act(() => success(result));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("handles browsers without location services and waits for the city catalog", () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });
    const view = render(
      <LocationPicker
        locations={cities}
        allowNearest
        loading
        onChange={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Find nearest city" }),
    ).toBeDisabled();
    view.rerender(
      <LocationPicker locations={cities} allowNearest onChange={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Find nearest city" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Location isn’t available",
    );
  });
});
