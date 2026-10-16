import * as React from "react";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import Navigation from "./Navigation";

function renderNavigation() {
  return render(
    <Provider store={store}>
      <Navigation />
    </Provider>,
  );
}

describe("Navigation", () => {
  it("groups the four game tools in a labeled action dock", () => {
    renderNavigation();

    expect(
      screen.getByRole("navigation", { name: "Game actions" }),
    ).toBeVisible();
    for (const name of ["Build", "Programs", "Insights", "Events"]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
    expect(screen.queryByRole("button", { name: "Facilities" })).toBeNull();
  });

  it("exposes the open panels and toggles a dock tool", () => {
    const onToggle = jest.fn();
    render(
      <Provider store={store}>
        <Navigation openTools={["INSIGHTS"]} onToggle={onToggle} />
      </Provider>,
    );
    const insights = screen.getByRole("button", { name: "Insights" });
    expect(insights).toHaveAttribute("aria-expanded", "true");
    expect(insights).toHaveAttribute("aria-controls", "tool-INSIGHTS");
    insights.click();
    expect(onToggle).toHaveBeenCalledWith("INSIGHTS");
  });
});
