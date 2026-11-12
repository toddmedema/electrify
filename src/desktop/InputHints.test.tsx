import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../Store";
import InputHints, { ControlsLegend } from "./InputHints";
import { dialogClose } from "../reducers/UI";
import {
  resetInputPresentation,
  updateInputPresentation,
} from "./InputPresentation";

afterEach(() => {
  delete window.electrifyCouch;
  resetInputPresentation();
  store.dispatch(dialogClose());
});

it("shows contextual hints and complete help without a layout preference", () => {
  updateInputPresentation({
    active: true,
    connected: true,
    context: "Gameplay",
    glyphs: {
      left: { label: "D-pad left" },
      down: { label: "D-pad down" },
      confirm: { label: "A" },
    },
  });
  render(
    <Provider store={store}>
      <input type="range" aria-label="Volume" />
      <InputHints />
    </Provider>,
  );
  act(() => screen.getByRole("slider").focus());
  expect(screen.getByText("Adjust value")).toBeVisible();
  expect(screen.getByText("Next control")).toBeVisible();
  expect(screen.queryByText("Previous pane")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All controls" }));
  expect(store.getState().ui.dialog).toMatchObject({
    open: true,
    title: "Controller controls",
  });
  render(
    <Provider store={store}>{store.getState().ui.dialog.message}</Provider>,
  );
  expect(screen.getByText("Previous pane")).toBeVisible();
  expect(screen.getByText("Pause / back")).toBeVisible();
  expect(screen.getAllByText("Unbound").length).toBeGreaterThan(0);
});

it("keeps connected couch hints present when pointer input becomes active", () => {
  window.electrifyCouch = {
    role: "seat",
    seatId: "local-p1",
    getGeneration: () => 1,
    ready: async () => {},
    onMessage: () => () => {},
    post: () => {},
  };
  updateInputPresentation({
    active: true,
    connected: true,
    glyphs: { confirm: { label: "Cross" } },
  });
  render(
    <Provider store={store}>
      <InputHints />
    </Provider>,
  );
  expect(screen.getByLabelText("Controller controls")).toBeVisible();
  act(() => updateInputPresentation({ active: false }));
  // Retaining the contents also retains their height: a pointer-down cannot move
  // the dock away from pointer-up while a couch controller still owns this seat.
  expect(screen.getByLabelText("Controller controls")).toBeVisible();
  expect(screen.getByText("Select")).toBeVisible();
});

it("keeps the existing solo behavior when pointer input becomes active", () => {
  updateInputPresentation({ active: false, connected: true });
  render(
    <Provider store={store}>
      <InputHints />
    </Provider>,
  );
  expect(
    screen.queryByLabelText("Controller controls"),
  ).not.toBeInTheDocument();
});

it("shows the complete shared menu legend with the requesting controller bindings", () => {
  window.electrifyCouch = {
    role: "seat",
    seatId: "local-p1",
    getGeneration: () => 1,
    ready: async () => {},
    onMessage: () => () => {},
    post: () => {},
  };
  render(
    <ControlsLegend
      glyphs={{
        confirm: { label: "Cross" },
        menu: { label: "Options" },
        speedUp: { label: "Remapped faster" },
      }}
    />,
  );
  expect(screen.getByLabelText("Controller controls")).toBeVisible();
  expect(screen.getByText("Controls")).toBeVisible();
  expect(screen.getByText("Game menu")).toBeVisible();
  expect(screen.getByRole("img", { name: "Options" })).toBeVisible();
  expect(screen.getByText("Remapped faster")).toBeVisible();
  expect(screen.getByText("Build")).toBeVisible();
  expect(screen.getByText("Previous chart")).toBeVisible();
});

it("uses origin icons for recognized bindings and retains custom binding text", () => {
  render(
    <ControlsLegend
      glyphs={{
        down: { label: "D-pad down" },
        confirm: { label: "Cross" },
        menu: { label: "Options" },
        speedDown: { label: "Right stick down" },
        speedUp: { label: "Rear paddle 4" },
        build: { label: "Right bumper" },
      }}
    />,
  );
  for (const label of [
    "D-pad down",
    "Cross",
    "Options",
    "Right stick down",
    "Right bumper",
  ]) {
    expect(screen.getByRole("img", { name: label })).toBeVisible();
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  }
  expect(screen.getByText("Rear paddle 4")).toBeVisible();
  expect(screen.getByText("Slower")).toBeVisible();
});

it("preserves Steam-provided glyphs and does not guess unknown origins from actions", () => {
  render(
    <ControlsLegend
      glyphs={{
        confirm: { label: "A", image: "data:image/png;base64,steam-glyph" },
        menu: { label: "Keyboard Start" },
        speedDown: { label: "Right bumper" },
        speedUp: { label: "A key" },
      }}
    />,
  );
  expect(screen.getByRole("img", { name: "A" })).toHaveAttribute(
    "src",
    "data:image/png;base64,steam-glyph",
  );
  expect(screen.getByRole("img", { name: "Right bumper" })).toBeVisible();
  expect(screen.queryByRole("img", { name: "Right stick down" })).toBeNull();
  expect(screen.getByText("Keyboard Start")).toBeVisible();
  expect(screen.getByText("A key")).toBeVisible();
});

it.each([
  "Left stick up",
  "Right stick right",
  "Left stick click",
  "D-pad left",
  "  RIGHT_STICK_DOWN  ",
  "Circle",
  "Triangle",
  "Square",
  "A",
  "B",
  "X",
  "Y",
  "Left bumper",
  "Right trigger",
  "L1",
  "R2",
  "L3",
  "Start",
  "View",
  "Plus",
  "-",
])("renders an accessible icon for the supplied %s origin", (label) => {
  render(<ControlsLegend glyphs={{ confirm: { label } }} />);
  expect(screen.getByRole("img", { name: label.trim() })).toBeVisible();
  expect(screen.getByText("Select")).toBeVisible();
});
