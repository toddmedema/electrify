import * as React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import MapStatusLayers from "./MapStatusLayers";

it("keeps independent layer choices and returns focus on Escape", async () => {
  function ControlledLayers() {
    const [showStatus, setShowStatus] = React.useState(true);
    const [showNames, setShowNames] = React.useState(true);
    return (
      <MapStatusLayers
        showStatus={showStatus}
        onStatusChange={setShowStatus}
        showNames={showNames}
        onNamesChange={setShowNames}
      />
    );
  }

  render(<ControlledLayers />);
  const trigger = screen.getByRole("button", { name: "Map layers" });
  fireEvent.click(trigger);
  const panel = screen.getByRole("dialog", { name: "Map layers" });
  const status = within(panel).getByRole("checkbox", {
    name: "Facility status",
  });
  const names = within(panel).getByRole("checkbox", { name: "Names" });
  expect(status).toBeChecked();
  expect(names).toBeChecked();
  fireEvent.click(status);
  expect(status).not.toBeChecked();
  expect(names).toBeChecked();
  fireEvent.click(names);
  expect(names).not.toBeChecked();
  fireEvent.keyDown(panel, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  expect(
    screen.getByRole("checkbox", { name: "Facility status" }),
  ).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Names" })).not.toBeChecked();
});
