import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(screen.getByText(/Blackouts, completed builds/)).toBeVisible();
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
    expect(screen.getByText("Upcoming events")).toBeVisible();
    expect(
      screen.queryByText(/have not happened yet/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Event history")).toBeVisible();
    expect(screen.getByText("Jan 2014")).toBeVisible();
    row.focus();
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onSelect).toHaveBeenCalledWith({
      card: "INSIGHTS",
      layer: "FUEL_PRICES",
    });
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
  });

  it("pins an ongoing emergency above upcoming events and history", () => {
    render(
      <EventLog
        events={[
          {
            id: 1,
            kind: "BUILD",
            label: "Dec 2024",
            message: "Battery project completed.",
          },
        ]}
        ongoing={[
          {
            key: "story:111:california-wildfire-2025:firestorm",
            label: "Through Feb 2025",
            title: "Wildfire emergency",
            message: "Safety shutoffs and restoration work remain active.",
            concept: "danger",
            importance: "CRITICAL",
            actionTarget: { card: "FACILITIES", view: "FLEET" },
          },
        ]}
        upcoming={[
          {
            key: "next",
            label: "Expected Mar 2025",
            message: "Restoration review.",
          },
        ]}
        onOpen={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByText("Ongoing events")).toBeVisible();
    expect(screen.getByText("Wildfire emergency")).toBeVisible();
    expect(screen.getByText("Through Feb 2025")).toBeVisible();
    expect(screen.getByText("Upcoming events")).toBeVisible();
    expect(screen.getByText("Event history")).toBeVisible();
  });

  it("keeps upcoming and past events in labeled sections", () => {
    render(
      <EventLog
        events={[
          {
            id: 1,
            kind: "BUILD",
            label: "Jan 2024",
            message: "Solar project started.",
          },
          {
            id: 2,
            kind: "CONSTRUCTION",
            label: "Feb 2024",
            message: "Solar project finished.",
          },
        ]}
        upcoming={[
          {
            key: "next",
            label: "Mar 2024",
            message: "Demand will rise.",
          },
        ]}
        onOpen={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByText("Upcoming events")).toBeVisible();
    expect(screen.getByText("Event history")).toBeVisible();
    expect(
      screen.queryByText(/recorded after they happen/i),
    ).not.toBeInTheDocument();
  });

  it("filters event history into useful event groups", async () => {
    const user = userEvent.setup();
    render(
      <EventLog
        events={[
          {
            id: 1,
            kind: "WORLD_EVENT",
            label: "Jan 2024",
            message: "A scenario event happened.",
          },
          {
            id: 2,
            kind: "BLACKOUT",
            label: "Feb 2024",
            message: "A blackout started.",
          },
          {
            id: 3,
            kind: "BUILD",
            label: "Mar 2024",
            message: "A solar project started.",
          },
          {
            id: 4,
            kind: "LOAN",
            label: "Apr 2024",
            message: "A loan was issued.",
          },
          {
            id: 5,
            kind: "FUEL_PRICE",
            label: "May 2024",
            message: "Gas became more expensive.",
          },
        ]}
        upcoming={[
          {
            key: "next",
            label: "Jun 2024",
            message: "An upcoming event remains visible.",
          },
        ]}
        onOpen={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Filter event history, All events" }),
    );
    expect(
      screen.getByRole("menuitemradio", { name: "All events" }),
    ).toBeChecked();
    await user.click(screen.getByRole("menuitemradio", { name: "Blackouts" }));

    expect(screen.getByText("A blackout started.")).toBeVisible();
    expect(screen.queryByText("A scenario event happened.")).toBeNull();
    expect(screen.queryByText("A solar project started.")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Filter event history, Blackouts",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("An upcoming event remains visible."),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: "Filter event history, Blackouts",
      }),
    );
    expect(
      screen.getByRole("menuitemradio", { name: "Blackouts" }),
    ).toBeChecked();
    await user.click(screen.getByRole("menuitemradio", { name: "All events" }));

    expect(screen.getByText("A scenario event happened.")).toBeVisible();
    expect(screen.getByText("A solar project started.")).toBeVisible();
    expect(screen.getByText("A loan was issued.")).toBeVisible();
    expect(screen.getByText("Gas became more expensive.")).toBeVisible();
  });

  it("explains when the selected event group is empty", async () => {
    const user = userEvent.setup();
    render(
      <EventLog
        events={[
          {
            id: 1,
            kind: "WORLD_EVENT",
            label: "Jan 2024",
            message: "A scenario event happened.",
          },
        ]}
        onOpen={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Filter event history, All events" }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: "Projects" }));

    expect(screen.getByText("No project events yet.")).toBeVisible();
  });
});
