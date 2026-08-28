import * as React from "react";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import { isPaneLayout } from "../../Globals";
import Navigation from "./Navigation";

jest.mock("../../Globals", () => ({
  ...jest.requireActual("../../Globals"),
  isPaneLayout: jest.fn(),
}));

const mockIsPaneLayout = isPaneLayout as jest.MockedFunction<
  typeof isPaneLayout
>;

function renderNavigation() {
  return render(
    <Provider store={store}>
      <Navigation />
    </Provider>,
  );
}

describe("Navigation", () => {
  it("shows Facilities in the single-panel layout", () => {
    mockIsPaneLayout.mockReturnValue(false);
    renderNavigation();

    expect(screen.getByRole("button", { name: "Facilities" })).toBeVisible();
  });

  it("omits Facilities when it is pinned in the two-panel layout", () => {
    mockIsPaneLayout.mockReturnValue(true);
    renderNavigation();

    expect(screen.queryByRole("button", { name: "Facilities" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
