import * as React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import MapStatusLayers from "./MapStatusLayers";

it("toggles facility status with a single checkbox and returns focus on Escape", async () => {
  function ControlledLayers() {
    const [value, setValue] = React.useState(true);
    return <MapStatusLayers value={value} onChange={setValue} />;
  }

  render(<ControlledLayers />);
  const trigger = screen.getByRole("button", { name: "Map layers" });
  fireEvent.click(trigger);
  const panel = screen.getByRole("dialog", { name: "Map layers" });
  const status = within(panel).getByRole("checkbox", {
    name: "Facility status",
  });
  expect(within(panel).getAllByRole("checkbox")).toHaveLength(1);
  expect(status).toBeChecked();
  fireEvent.click(status);
  expect(status).not.toBeChecked();
  fireEvent.keyDown(panel, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  expect(
    screen.getByRole("checkbox", { name: "Facility status" }),
  ).not.toBeChecked();
});
