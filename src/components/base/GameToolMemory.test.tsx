import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { GameToolMemoryContext, useToolScroll } from "./GameToolMemory";

test("opening a detail remembers a scroll that has not dispatched its scroll event yet", () => {
  function Tool() {
    const [detail, setDetail] = React.useState(false);
    const ref = useToolScroll<HTMLDivElement>(detail ? "detail" : "list");
    return (
      <div ref={ref} role="region" aria-label="Tool">
        <button onClick={() => setDetail(!detail)}>
          {detail ? "Back" : "Open detail"}
        </button>
      </div>
    );
  }
  const memory = new Map<string, unknown>();
  render(
    <GameToolMemoryContext.Provider value={memory}>
      <Tool />
    </GameToolMemoryContext.Provider>,
  );
  const body = screen.getByRole("region", { name: "Tool" });
  // Browsers dispatch scroll asynchronously, including when clicking scrolls a target into view.
  body.scrollTop = 180;
  fireEvent.click(screen.getByRole("button", { name: "Open detail" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(body.scrollTop).toBe(180);
});
