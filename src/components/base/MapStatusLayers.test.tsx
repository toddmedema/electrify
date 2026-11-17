import * as React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import MapStatusLayers, {
  DEFAULT_MAP_STATUS_LAYERS,
  showsMapStatus,
} from "./MapStatusLayers";

it("toggles each facility status layer independently and returns focus on Escape", async () => {
  const changed = jest.fn();
  function ControlledLayers() {
    const [value, setValue] = React.useState(DEFAULT_MAP_STATUS_LAYERS);
    return (
      <MapStatusLayers
        value={value}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  render(<ControlledLayers />);
  const trigger = screen.getByRole("button", { name: "Map layers" });
  fireEvent.click(trigger);
  const panel = screen.getByRole("dialog", { name: "Facility status" });
  const producing = within(panel).getByRole("checkbox", {
    name: "Producing and charging",
  });
  const inactive = within(panel).getByRole("checkbox", {
    name: "Idle and paused",
  });
  const construction = within(panel).getByRole("checkbox", {
    name: "Construction",
  });
  expect(producing).toBeChecked();
  expect(inactive).toBeChecked();
  expect(construction).toBeChecked();
  fireEvent.click(producing);
  expect(changed).toHaveBeenLastCalledWith({
    producing: false,
    inactive: true,
    construction: true,
  });
  fireEvent.click(construction);
  expect(inactive).toBeChecked();
  expect(changed).toHaveBeenLastCalledWith({
    producing: false,
    inactive: true,
    construction: false,
  });
  fireEvent.keyDown(panel, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  expect(
    screen.getByRole("checkbox", { name: "Producing and charging" }),
  ).not.toBeChecked();
});

it("groups charging with production, pause with idle, and keeps unknown operation undisclosed", () => {
  const layers = { producing: false, inactive: true, construction: false };
  expect(showsMapStatus("producing", layers)).toBe(false);
  expect(showsMapStatus("charging", layers)).toBe(false);
  expect(showsMapStatus("idle", layers)).toBe(true);
  expect(showsMapStatus("paused", layers)).toBe(true);
  expect(showsMapStatus("construction", layers)).toBe(false);
  expect(showsMapStatus("unknown", DEFAULT_MAP_STATUS_LAYERS)).toBe(false);
});
