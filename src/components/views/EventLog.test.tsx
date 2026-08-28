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
});
