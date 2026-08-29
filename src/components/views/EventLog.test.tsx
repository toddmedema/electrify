import * as React from "react";
import { render, screen } from "@testing-library/react";
import EventLog from "./EventLog";

jest.mock("../base/GameCard", () => (props: { children: React.ReactNode }) => (
  <div>{props.children}</div>
));

describe("EventLog", () => {
  it("marks events read without returning the dispatched action as an effect cleanup", () => {
    const dispatchedAction = { type: "game/markEventsRead" };
    const onOpen = jest.fn(() => dispatchedAction) as unknown as () => void;
    const view = render(
      <React.StrictMode>
        <EventLog events={[]} onOpen={onOpen} onSelect={jest.fn()} />
      </React.StrictMode>,
    );

    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByText(/Blackouts, finished construction/)).toBeVisible();
    expect(() => view.unmount()).not.toThrow();
  });

  it("renders authored upcoming phases with timing and a keyboard action", () => {
    const onSelect = jest.fn();
    render(
      <EventLog
        events={[]}
        upcoming={[
          {
            key: "story:103:shale-boom:freeze",
            label: "Jan 2014",
            title: "Winter gas squeeze",
            message: "Gas prices and available output will change.",
            concept: "danger",
            importance: "CRITICAL",
            actionTarget: { card: "INSIGHTS", layer: "FUEL_PRICES" },
          },
        ]}
        onOpen={jest.fn()}
        onSelect={onSelect}
      />,
    );

    const row = screen.getByRole("button", { name: /winter gas squeeze/i });
    expect(screen.getByText("Upcoming")).toBeVisible();
    expect(screen.getByText("Jan 2014")).toBeVisible();
    row.focus();
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onSelect).toHaveBeenCalledWith({
      card: "INSIGHTS",
      layer: "FUEL_PRICES",
    });
  });
});
