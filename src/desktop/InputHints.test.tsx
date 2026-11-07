import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../Store";
import InputHints from "./InputHints";
import {
  resetInputPresentation,
  updateInputPresentation,
} from "./InputPresentation";

afterEach(() => {
  delete window.electrifyCouch;
  resetInputPresentation();
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
